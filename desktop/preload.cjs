// Sandboxed Electron preloads use CommonJS, with no general Node access.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pacedMindDesktop", {
  initialTheme: process.argv.includes("--pacedmind-theme=light") ? "light" : "dark",
  setTheme(theme) {
    if (theme === "dark" || theme === "light") ipcRenderer.send("pacedmind:set-theme", theme);
  },
});
