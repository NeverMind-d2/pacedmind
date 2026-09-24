// Organizer desktop app. Runs the built Next.js server (server/server.js) with Electron's own Node,
// shows it in a window and keeps running in the tray, so agents can still report back after the
// window is closed. Built and installed by scripts/build-desktop.mjs.
import { app, BrowserWindow, Menu, Notification, Tray, dialog, screen, session, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const PORT = 4319;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const APP_ID = "Organizer.Desktop";
const ICON = path.join(import.meta.dirname, "icon.ico");
const ICON_PNG = path.join(import.meta.dirname, "icon.png");
const SERVER_DIR = path.join(import.meta.dirname, "server");
const BACKGROUND = "#010101";

let win = null;
let tray = null;
let server = null;
let quitting = false;
let serverReady = false;
const notifications = new Set();

const dataDir = () => path.join(app.getPath("userData"), "data");
const logFile = () => path.join(app.getPath("logs"), "server.log");
const stateFile = () => path.join(app.getPath("userData"), "window-state.json");
const loginArgs = { path: process.execPath, args: ["--hidden"] };

/* ---------- small helpers ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(pathname) {
  return new Promise((resolve) => {
    const req = http.get(`${ORIGIN}${pathname}`, { timeout: 1500 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(res.statusCode === 200 ? JSON.parse(body) : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeState(patch) {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ ...readState(), ...patch }, null, 2));
  } catch {
    // Not worth failing over.
  }
}

function openOutside(url) {
  if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
}

const page = (text) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><title>Organizer</title><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:${BACKGROUND};color:#6e6e76;font:13px 'Segoe UI',system-ui,sans-serif">${text}</body>`,
  )}`;

/* ---------- the server ---------- */

async function startServer() {
  // Already answering, e.g. a server left behind by a crash: use it.
  if (await getJson("/api/state")) return;

  fs.mkdirSync(dataDir(), { recursive: true });
  fs.mkdirSync(path.dirname(logFile()), { recursive: true });
  try {
    if (fs.statSync(logFile()).size > 5_000_000) fs.rmSync(logFile());
  } catch {
    // No log yet.
  }
  const log = fs.openSync(logFile(), "a");
  fs.writeSync(log, `\n--- ${new Date().toISOString()} starting Organizer ${app.getVersion()}\n`);

  const child = spawn(process.execPath, [path.join(SERVER_DIR, "server.js")], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      ORGANIZER_DB: path.join(dataDir(), "organizer.db"),
      ORGANIZER_SEED: "empty",
      ORGANIZER_EXIT_WITH_PARENT: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    // stdin stays open as a lifeline: the server exits when it closes (see src/instrumentation.ts).
    stdio: ["pipe", log, log],
    windowsHide: true,
  });
  fs.closeSync(log);
  server = child;
  let exited = false;
  child.on("exit", (code) => {
    exited = true;
    if (server === child) server = null;
    if (!quitting && serverReady) serverDied(code);
  });

  for (let i = 0; i < 300 && !exited; i++) {
    if (await getJson("/api/state")) return;
    await sleep(100);
  }
  throw new Error(exited ? "The server stopped while starting." : "The server did not answer within 30 seconds.");
}

function stopServer() {
  if (server) server.kill();
  server = null;
}

async function serverDied(code) {
  serverReady = false;
  const { response } = await dialog.showMessageBox({
    type: "error",
    title: "Organizer",
    message: "Organizer's server stopped.",
    detail: `Exit code ${code}. Details are in ${logFile()}`,
    buttons: ["Restart", "Open log", "Quit"],
    defaultId: 0,
  });
  if (response === 1) shell.openPath(logFile());
  if (response === 2) return quit();
  boot();
}

/* ---------- window ---------- */

function visibleBounds(b) {
  if (!b || typeof b.x !== "number") return undefined;
  const area = screen.getDisplayMatching(b).workArea;
  const overlaps = b.x < area.x + area.width - 80 && b.x + b.width > area.x + 80 && b.y < area.y + area.height - 60 && b.y >= area.y - 10;
  return overlaps ? b : undefined;
}

function createWindow() {
  const saved = readState();
  const bounds = visibleBounds(saved.bounds);
  win = new BrowserWindow({
    width: bounds?.width ?? 1440,
    height: bounds?.height ?? 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 960,
    minHeight: 600,
    title: "Organizer",
    icon: ICON,
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true },
  });
  win.setMenuBarVisibility(false);
  // maximize() also shows the window, so wait until it should appear (not at all with --hidden).
  win.once("show", () => saved.maximized && win.maximize());
  win.once("ready-to-show", () => {
    if (!process.argv.includes("--hidden")) win.show();
  });
  win.on("close", (e) => {
    writeState({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!readState().trayHintShown) {
      writeState({ trayHintShown: true });
      tray?.displayBalloon({
        iconType: "info",
        title: "Organizer is still running",
        content: "It stays in the tray so agents can report back. Right-click the icon to quit.",
      });
    }
  });
  win.on("closed", () => (win = null));
  // Windows is shutting down or signing out: let the window close.
  win.on("session-end", () => {
    quitting = true;
    stopServer();
  });
  // Mouse back and forward buttons.
  win.on("app-command", (_e, cmd) => {
    const nav = win.webContents.navigationHistory;
    if (cmd === "browser-backward" && nav.canGoBack()) nav.goBack();
    if (cmd === "browser-forward" && nav.canGoForward()) nav.goForward();
  });

  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGIN) && !url.startsWith("data:")) {
      e.preventDefault();
      openOutside(url);
    }
  });

  win.loadURL(serverReady ? `${ORIGIN}/today` : page("Starting Organizer…"));
}

function showWindow(url) {
  if (!win) createWindow();
  if (url && serverReady) win.loadURL(url);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/* ---------- tray, menu, notifications ---------- */

function trayMenu() {
  const startsWithWindows = app.getLoginItemSettings(loginArgs).openAtLogin;
  return Menu.buildFromTemplate([
    { label: "Open Organizer", click: () => showWindow() },
    { type: "separator" },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: startsWithWindows,
      click: (item) => {
        app.setLoginItemSettings({ ...loginArgs, openAtLogin: item.checked });
        tray.setContextMenu(trayMenu());
      },
    },
    { label: "Open data folder", click: () => shell.openPath(dataDir()) },
    { label: "Open server log", click: () => shell.openPath(logFile()) },
    { type: "separator" },
    { label: "Quit Organizer", click: quit },
  ]);
}

function createTray() {
  tray = new Tray(ICON);
  tray.setToolTip("Organizer");
  tray.setContextMenu(trayMenu());
  tray.on("click", () => showWindow());
}

function appMenu() {
  // Hidden menu bar; it only provides the keyboard shortcuts.
  const nav = () => win?.webContents.navigationHistory;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Organizer",
        submenu: [
          { label: "Close window", accelerator: "CmdOrCtrl+W", click: () => win?.close() },
          { label: "Quit Organizer", accelerator: "CmdOrCtrl+Q", click: quit },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
          { label: "Back", accelerator: "Alt+Left", click: () => nav()?.canGoBack() && nav().goBack() },
          { label: "Forward", accelerator: "Alt+Right", click: () => nav()?.canGoForward() && nav().goForward() },
        ],
      },
    ]),
  );
}

/** Watches for sessions that finished, tells you with a notification and keeps the tray tooltip current. */
function watchSessions() {
  let known = null;
  const check = async () => {
    if (!serverReady) return;
    const state = await getJson("/api/state");
    if (!state) return;
    const waiting = state.waiting ?? [];
    if (known) for (const s of waiting) if (!known.has(s.id)) notify(s);
    known = new Set(waiting.map((s) => s.id));
    tray?.setToolTip(waiting.length ? `Organizer · ${waiting.length} waiting for you` : "Organizer");
  };
  check();
  setInterval(check, 5000);
}

function notify(s) {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: `${s.key ?? "A session"} is finished`,
    body: [s.title, s.note].filter(Boolean).join("\n"),
    icon: ICON_PNG,
  });
  notifications.add(n); // Keep a reference, or the click handler can be garbage collected.
  n.on("click", () => showWindow(`${ORIGIN}/sessions?s=${encodeURIComponent(s.id)}`));
  n.on("close", () => notifications.delete(n));
  n.show();
}

/* ---------- start and stop ---------- */

async function boot() {
  try {
    await startServer();
    serverReady = true;
    if (win) win.loadURL(`${ORIGIN}/today`);
  } catch (e) {
    const { response } = await dialog.showMessageBox({
      type: "error",
      title: "Organizer",
      message: "Organizer could not start.",
      detail: `${e.message}\n\nIs something else using port ${PORT}? Details are in ${logFile()}`,
      buttons: ["Try again", "Open log", "Quit"],
      defaultId: 0,
    });
    if (response === 0) return boot();
    if (response === 1) shell.openPath(logFile());
    quit();
  }
}

function quit() {
  quitting = true;
  stopServer();
  app.quit();
}

function writeShortcuts() {
  const options = {
    target: process.execPath,
    cwd: path.dirname(process.execPath),
    description: "Tasks, time blocks and agent sessions",
    icon: process.execPath,
    iconIndex: 0,
    appUserModelId: APP_ID, // Needed for Windows notifications.
  };
  const programs = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
  shell.writeShortcutLink(path.join(programs, "Organizer.lnk"), "create", options);
  shell.writeShortcutLink(path.join(app.getPath("desktop"), "Organizer.lnk"), "create", options);
}

function removeShortcuts() {
  const programs = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
  for (const file of [path.join(programs, "Organizer.lnk"), path.join(app.getPath("desktop"), "Organizer.lnk")]) {
    fs.rmSync(file, { force: true });
  }
  app.setLoginItemSettings({ ...loginArgs, openAtLogin: false });
}

app.setAppUserModelId(APP_ID);

if (process.argv.includes("--install")) {
  writeShortcuts();
  app.exit(0);
} else if (process.argv.includes("--uninstall")) {
  removeShortcuts();
  app.exit(0);
} else if (!app.requestSingleInstanceLock()) {
  // Organizer is already running: it gets our arguments through "second-instance".
  app.exit(0);
} else if (process.argv.includes("--quit")) {
  // Asked to quit, but nothing was running.
  app.exit(0);
} else {
  app.on("second-instance", (_e, argv) => (argv.includes("--quit") ? quit() : showWindow()));
  app.on("window-all-closed", () => {
    // Stay in the tray.
  });
  app.on("before-quit", () => {
    quitting = true;
    stopServer();
  });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === "clipboard-sanitized-write"));
    appMenu();
    createTray();
    createWindow();
    boot().then(watchSessions);
  });
}
