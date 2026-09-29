// For `npm run screenshots`: runs in each capture window before the page's own scripts (without context isolation, so
// it reaches the page's window). Sets the app's theme (src/lib/theme.ts) and moves the page's clock with the server's.
const theme = process.argv.find((a) => a.startsWith("--pm-theme="))?.slice("--pm-theme=".length);
if (theme === "light" || theme === "dark") {
  try {
    localStorage.setItem("pacedmind-theme", theme);
  } catch {
    // No storage: the app's default theme.
  }
}

// PACEDMIND_CLOCK_OFFSET reaches the window's process as it did Electron's.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- a preload that must run before the page is CommonJS
require("./screenshots-clock.cjs");

// Every animation at its end at once, such as the wordmark's, so no screenshot catches one halfway.
window.addEventListener("DOMContentLoaded", () => {
  const style = document.createElement("style");
  style.textContent = "*, *::before, *::after { animation-delay: 0s !important; animation-duration: 0s !important; }";
  document.head.append(style);
});
