// Electron's part of `npm run screenshots` (scripts/screenshots.mjs, which passes the job in PACEDMIND_SHOTS): opens
// each page in a hidden window at its size and zoom, in its theme, and saves what it shows as a PNG.
import { app, BrowserWindow, session } from "electron";
import fs from "node:fs";
import path from "node:path";

const job = JSON.parse(process.env.PACEDMIND_SHOTS ?? "{}");

// The same pixels on every computer, whatever its display's scaling: the zoom decides the image's size.
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.commandLine.appendSwitch("hide-scrollbars");
app.setPath("userData", job.userData);
// One window at a time: closing one mustn't end the app before the next opens.
app.on("window-all-closed", () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Loads the page and waits until it has painted: its fonts, and a moment for what moves in. The development server
 * compiles a page the first time it's asked for, and a refresh can cut a load short, so it tries again.
 */
async function settle(win, url, zoom) {
  for (let attempt = 1; ; attempt++) {
    try {
      await win.loadURL(url);
      break;
    } catch (e) {
      if (attempt >= 4) throw e;
      await sleep(1500);
    }
  }
  // Chromium keeps one zoom for all the pages of a host, the first window's: each page sets its own.
  win.webContents.setZoomFactor(zoom);
  await win.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
  await sleep(2000);
}

app.whenReady().then(async () => {
  try {
    // The window key the development server asks every page for (src/server/ui-key.ts).
    await session.defaultSession.cookies.set({ url: job.base, name: "pm_ui", value: job.key, httpOnly: true, sameSite: "strict" });
    for (const s of job.shots) {
      const width = Math.round(s.width * s.zoom);
      const height = Math.round(s.height * s.zoom);
      const win = new BrowserWindow({
        show: false, width, height, useContentSize: true, paintWhenInitiallyHidden: true, backgroundColor: s.theme === "dark" ? "#000000" : "#ffffff",
        webPreferences: {
          // No isolation: the preload sets the theme and moves the clock in the page's own window.
          zoomFactor: s.zoom, backgroundThrottling: false, sandbox: false, contextIsolation: false,
          preload: path.join(import.meta.dirname, "screenshots-preload.cjs"), additionalArguments: [`--pm-theme=${s.theme}`],
        },
      });
      win.setContentSize(width, height);
      await settle(win, `${job.base}${s.url}`, s.zoom);
      // What the shot sets up on the page first, such as closing groups (screenshots.mjs), and what it says it did.
      if (s.script) {
        const did = await win.webContents.executeJavaScript(s.script);
        if (did !== undefined) console.log(`  ${s.name}: ${did}`);
        await sleep(800);
      }
      const image = await win.webContents.capturePage();
      const size = image.getSize();
      fs.mkdirSync(path.dirname(s.out), { recursive: true });
      fs.writeFileSync(s.out, image.toPNG());
      console.log(`  ${s.name}: ${size.width} × ${size.height}`);
      win.destroy();
    }
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
