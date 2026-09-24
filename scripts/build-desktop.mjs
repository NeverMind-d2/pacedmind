// Builds the PacedMind desktop app and updates the existing Organizer installation in place.
//
//   npm run desktop                 build, package, install to %LOCALAPPDATA%\Programs\Organizer and start it
//   npm run desktop -- --no-install build and package only (output in dist/package)
//
// The app keeps its data in %APPDATA%\Organizer, so reinstalling never touches it.
import { execFileSync, execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { packager } from "@electron/packager";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const stage = path.join(dist, "app");
const flags = new Set(process.argv.slice(2));
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const pkg = readJson(path.join(root, "package.json"));
const electronVersion = readJson(path.join(root, "node_modules", "electron", "package.json")).version;
const installDir = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Organizer");
const installedExe = path.join(installDir, "Organizer.exe");

const step = (text) => console.log(`\n> ${text}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Number of Organizer processes running from the install folder (the app and its server). */
function runningFromInstall() {
  const dir = installDir.replace(/'/g, "''");
  const out = execFileSync("powershell.exe", [
    "-NoProfile", "-Command",
    `@(Get-Process -Name Organizer -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${dir}\\*' }).Count`,
  ], { encoding: "utf8" });
  return Number(out.trim()) || 0;
}

// Validate every recursive-delete target before touching a previous build or installation.
function assertChildPath(target, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe output path: ${target}`);
  }
}
assertChildPath(stage, root);
assertChildPath(path.join(dist, "package"), root);
if (process.platform === "win32") {
  if (!process.env.LOCALAPPDATA || !path.isAbsolute(process.env.LOCALAPPDATA)) {
    throw new Error("LOCALAPPDATA must identify the current user's app directory.");
  }
  assertChildPath(installDir, path.join(process.env.LOCALAPPDATA, "Programs"));
}

step("Generating PacedMind icons");
execFileSync(process.execPath, [path.join(root, "scripts", "make-icons.mjs")], { cwd: root, stdio: "inherit" });

step("Building the Next.js app");
fs.rmSync(stage, { recursive: true, force: true }); // An old copy would end up in the build's file tracing.
execSync("npm run build", { cwd: root, stdio: "inherit" });

step("Collecting the app files");
const server = path.join(stage, "server");
const standalone = path.join(root, ".next", "standalone");
// Build tracing follows the database path and copies data/ (your local database and session
// scripts) into the standalone folder. The app keeps its own data in %APPDATA%, so leave it out.
const skip = ["data", "dist"].map((dir) => path.join(standalone, dir));
fs.cpSync(standalone, server, {
  recursive: true,
  filter: (src) => !skip.some((dir) => src === dir || src.startsWith(dir + path.sep)),
});
fs.cpSync(path.join(root, ".next", "static"), path.join(server, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public"), path.join(server, "public"), { recursive: true });
for (const leftover of ["data", "dist"]) {
  if (fs.existsSync(path.join(server, leftover))) throw new Error(`The build unexpectedly contains ${leftover}/. Check outputFileTracingExcludes.`);
}
for (const file of ["main.mjs", "preload.cjs", "icon.ico", "icon.png"]) fs.copyFileSync(path.join(root, "desktop", file), path.join(stage, file));
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({
  name: "organizer",
  productName: "PacedMind",
  version: pkg.version,
  description: "Tasks, time blocks and agent sessions",
  main: "main.mjs",
}, null, 2));

step(`Packaging with Electron ${electronVersion}`);
const [packaged] = await packager({
  dir: stage,
  out: path.join(dist, "package"),
  overwrite: true,
  platform: process.platform,
  arch: process.arch,
  electronVersion,
  name: "Organizer",
  executableName: "Organizer",
  appVersion: pkg.version,
  icon: path.join(root, "desktop", "icon.ico"),
  asar: false, // The server runs from plain files with Electron's own Node.
  prune: false, // server/node_modules is already exactly what the server needs.
  quiet: true,
  win32metadata: { CompanyName: "PacedMind", FileDescription: "PacedMind", ProductName: "PacedMind", InternalName: "Organizer" },
});
console.log(`  ${packaged}`);

if (flags.has("--no-install") || process.platform !== "win32") {
  console.log("\nDone. Run the app from the folder above.");
  process.exit(0);
}

step(`Installing to ${installDir}`);
if (fs.existsSync(installedExe) && runningFromInstall()) {
  console.log("  Closing the running app…");
  spawn(installedExe, ["--quit"], { stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 50 && runningFromInstall(); i++) await sleep(200);
  if (runningFromInstall()) throw new Error("Organizer is still running. Quit it from the tray icon and run this again.");
}
fs.rmSync(installDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
fs.cpSync(packaged, installDir, { recursive: true });
execFileSync(installedExe, ["--install"], { windowsHide: true }); // Start Menu and desktop shortcuts.
console.log("  Added PacedMind to the Start Menu and the desktop.");

if (!flags.has("--no-launch")) {
  spawn(installedExe, [], { detached: true, stdio: "ignore" }).unref();
  console.log("  Started PacedMind.");
}
console.log(`\nDone. Your data lives in ${path.join(process.env.APPDATA ?? "", "Organizer")}.`);
