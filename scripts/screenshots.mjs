// Takes the screenshots for the docs (docs/public/screenshots) and the website's hero (site/screens).
//
//   npm run screenshots             both
//   npm run screenshots -- docs     only the docs'
//   npm run screenshots -- site     only the website's
//
// It starts its own development server on the sample data, in a new folder with an empty home, so nothing of this
// computer shows: no sessions or folders of Claude Code and Codex, no settings, no sign-in. Its clock (and the pages')
// reads 10:40 today whenever it runs (screenshots-clock.cjs). Electron opens each page at a fixed size and saves it
// (screenshots-capture.mjs). The website's screens come in light and dark, as WebP.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const only = process.argv[2];
const PORT = 4360;
const base = `http://127.0.0.1:${PORT}`;

// The timeline opens four days back, where the sample tasks were made, so the labels of the ones without dates show
// whole rather than cut at the edge.
const back = new Date();
back.setDate(back.getDate() - 4);
const TIMELINE = `/timeline?at=${back.getFullYear()}-${String(back.getMonth() + 1).padStart(2, "0")}-${String(back.getDate()).padStart(2, "0")}`;

/** A page to take: where, at what size in CSS pixels and zoom (the image is that times the zoom), which theme. */
const DOCS = [
  ["today", "/today"],
  ["upcoming", "/upcoming"],
  ["calendar-month", "/calendar"],
  ["calendar-week", "/calendar/week"],
  ["timeline", TIMELINE],
  ["projects", "/projects"],
  ["roadmap", "/roadmap"],
  ["sessions", "/sessions"],
  ["preferences", "/settings/preferences"],
].map(([name, url]) => ({ name, url, width: 1280, height: 800, zoom: 1.5, theme: "dark", out: path.join(root, "docs/public/screenshots", `${name}.png`) }));
// The details panel needs the room of a wider window.
DOCS.push({ name: "task-details", url: "/today?task=WRK-31", width: 1440, height: 900, zoom: 4 / 3, theme: "dark", out: path.join(root, "docs/public/screenshots/task-details.png") });

// The hero's screens: the deck's shape (SCREEN in site/components/screens/parts.tsx), with room for a week's names and
// times. The timeline closes the areas above Dev, whose tasks the agents work on, for a few seconds: fetching more
// days can draw it anew, open again. The script's answer is logged.
const CLOSE_AREAS = `(async () => {
  const names = ["Work", "Personal", "Health", "Learning"];
  let clicks = 0;
  for (let i = 0; i < 6; i++) {
    const open = [...document.querySelectorAll('section[aria-label="Timeline"] button[aria-expanded="true"]')]
      .filter((b) => names.includes(b.textContent.trim()));
    open.forEach((b) => b.click());
    clicks += open.length;
    await new Promise((r) => setTimeout(r, 700));
  }
  return "closed areas " + clicks + " times";
})()`;
const SITE = [
  ["today", "/today"],
  ["week", "/calendar/week"],
  ["timeline", TIMELINE, CLOSE_AREAS],
].flatMap(([name, url, script]) => ["light", "dark"].map((theme) => ({
  name: `${name}-${theme}`, url, script, width: 1408, height: 853, zoom: 1.5, theme,
  out: path.join(os.tmpdir(), `pacedmind-site-${name}-${theme}.png`), webp: path.join(root, "site/screens", `${name}-${theme}.webp`),
})));

const shots = [...(only !== "site" ? DOCS : []), ...(only !== "docs" ? SITE : [])];

// The same morning every time: 10:40 today, as the server and the pages see it.
const morning = new Date();
morning.setHours(10, 40, 0, 0);
const clock = String(morning.getTime() - Date.now());

/* ---------- a development server of its own ---------- */

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pacedmind-shots-"));
const dirs = Object.fromEntries(["data", "home", "appdata", "claude", "codex", "electron"].map((d) => [d, path.join(temp, d)]));
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
// Past the sign-in screen and the first-start import offer, with a plain name for this computer.
fs.writeFileSync(path.join(dirs.data, "device.json"), JSON.stringify({ name: "Studio", withoutAccount: true, importOffered: true }));

const server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
  cwd: root,
  env: {
    ...process.env,
    ORGANIZER_DB: path.join(dirs.data, "organizer.db"),
    USERPROFILE: dirs.home, HOME: dirs.home, APPDATA: dirs.appdata, CLAUDE_CONFIG_DIR: dirs.claude, CODEX_HOME: dirs.codex,
    NEXT_TELEMETRY_DISABLED: "1",
    PACEDMIND_CLOCK_OFFSET: clock,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require ${JSON.stringify(path.join(root, "scripts/screenshots-clock.cjs"))}`].filter(Boolean).join(" "),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (b) => { log += b; });
server.stderr.on("data", (b) => { log += b; });

function stop() {
  if (server.exitCode === null) {
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
      else server.kill();
    } catch { /* gone already */ }
  }
}

async function ready() {
  const keyFile = path.join(dirs.data, "ui-key");
  for (let i = 0; i < 240; i++) {
    if (server.exitCode !== null) throw new Error(`The development server stopped:\n${log}`);
    if (fs.existsSync(keyFile)) {
      const key = fs.readFileSync(keyFile, "utf8").trim();
      const ok = await fetch(`${base}/today`, { headers: { cookie: `pm_ui=${key}` }, redirect: "manual" }).then((r) => r.status === 200, () => false);
      if (ok) return key;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`The development server didn't answer:\n${log}`);
}

try {
  const key = await ready();
  console.log(`Development server on ${base}, sample data in ${dirs.data}`);
  const { default: electron } = await import("electron");
  const env = { ...process.env, PACEDMIND_CLOCK_OFFSET: clock, PACEDMIND_SHOTS: JSON.stringify({ base, key, userData: dirs.electron, shots }) };
  delete env.ELECTRON_RUN_AS_NODE;
  const code = await new Promise((resolve) => {
    const child = spawn(electron, [path.join(root, "scripts/screenshots-capture.mjs")], { env, stdio: "inherit" });
    child.on("exit", resolve);
  });
  if (code !== 0) throw new Error(`Taking the screenshots failed (${code})`);

  // The website's: WebP, a fraction of the PNG's size.
  for (const s of shots.filter((x) => x.webp)) {
    fs.mkdirSync(path.dirname(s.webp), { recursive: true });
    await sharp(s.out).webp({ quality: 82, effort: 6 }).toFile(s.webp);
    fs.rmSync(s.out, { force: true });
    console.log(`  ${path.relative(root, s.webp)}`);
  }
} finally {
  stop();
  // The server may hold its files a moment after it stops.
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(temp, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
