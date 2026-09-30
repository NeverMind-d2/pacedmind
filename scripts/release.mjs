// Builds PacedMind for the system it runs on and puts it on pacedmind.com, where the site's download
// buttons point (/download/windows and /download/mac, deploy/Caddyfile):
//
//   npm run release -- pacedmind               build, package and upload (an ssh alias, deploy/README.md)
//   npm run release -- ubuntu@<server>         the same, with the server's address
//   npm run release -- --no-upload             build and package only, into dist/release
//   npm run release -- --store                 signed Windows Store EXE and immutable filename; never uploads
//
// An upload replaces the download everyone gets, so it refuses a checkout that doesn't contain master or has
// uncommitted changes (landed.mjs); --allow-unlanded skips that, for a test.
//
// Windows: PacedMind-Windows.exe, an installer that electron-builder makes from the app that
// scripts/build-desktop.mjs packages. It installs for the current user into %LOCALAPPDATA%\Programs\Organizer,
// like `npm run desktop`, closes a running PacedMind first and never touches the data. Ordinary downloads
// remain unsigned; --store requires a trusted certificate and signs before preparing a Store artifact.
// macOS: PacedMind-macOS.dmg, one app for Apple silicon and Intel, signed with your Developer ID and
// notarized, and the disk image too. The one-time keychain setup is in deploy/README.md.
//
// The upload goes to /srv/pacedmind/download on the server, with the SSH key deploy/deploy.sh uses
// (PACEDMIND_KEY, by default ~/.ssh/pacedmind_vps when it exists, else whatever ssh's own config gives the
// host). The previous file stays as <name>.old.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { assertLanded } from "./landed.mjs";
import { signWindowsFiles, stageWindowsStoreInstaller, windowsExecutables, windowsSigningConfig } from "./windows-store.mjs";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "dist", "release");
const args = process.argv.slice(2);
const store = args.includes("--store");
const upload = !store && !args.includes("--no-upload");
const server = args.find((a) => !a.startsWith("--"));
const defaultKey = path.join(os.homedir(), ".ssh", "pacedmind_vps");
// Without that key, ssh's own config (an alias's IdentityFile) picks one.
const key = process.env.PACEDMIND_KEY || (fs.existsSync(defaultKey) ? defaultKey : null);
const notaryProfile = process.env.PACEDMIND_NOTARY_PROFILE || "PacedMind";
const mac = process.platform === "darwin";
// The names deploy/Caddyfile sends /download/windows and /download/mac to.
const FILE = mac ? "PacedMind-macOS.dmg" : "PacedMind-Windows.exe";
const DOWNLOADS = "/srv/pacedmind/download";

const step = (text) => console.log(`\n> ${text}`);
const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: "inherit", ...opts });

if (!["win32", "darwin"].includes(process.platform)) throw new Error("Releases are built on Windows or macOS.");
if (store && process.platform !== "win32") throw new Error("--store prepares the Windows EXE submission. macOS uses Developer ID distribution; see stores/README.md.");
const windowsSigner = store ? windowsSigningConfig() : null;
if (upload && !server) {
  console.error("Usage: npm run release -- pacedmind (an ssh alias) or user@server, or npm run release -- --no-upload");
  process.exit(1);
}
if (upload && key && !fs.existsSync(key)) throw new Error(`There's no SSH key at ${key}. Set PACEDMIND_KEY to its path.`);
if ((upload || store) && !args.includes("--allow-unlanded")) assertLanded(root, { committed: true, skip: "--allow-unlanded" });

/** The Developer ID Application certificate to sign with: PACEDMIND_SIGN_IDENTITY, or the keychain's only one. */
function signingIdentity() {
  if (process.env.PACEDMIND_SIGN_IDENTITY) return process.env.PACEDMIND_SIGN_IDENTITY;
  const found = [...new Set(execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" })
    .split("\n").map((line) => line.match(/"(Developer ID Application: [^"]+)"/)?.[1]).filter(Boolean))];
  if (found.length === 0) throw new Error("Your keychain has no Developer ID Application certificate. See deploy/README.md.");
  if (found.length > 1) throw new Error(`Your keychain has several Developer ID certificates; pick one with PACEDMIND_SIGN_IDENTITY:\n  ${found.join("\n  ")}`);
  return found[0];
}

/** electron-builder, pinned, fetched into dist/tools the first time rather than kept in package.json. */
function electronBuilder() {
  const tools = path.join(root, "dist", "tools");
  const builder = path.join(tools, "node_modules", "electron-builder");
  if (!fs.existsSync(builder)) {
    fs.mkdirSync(tools, { recursive: true });
    fs.writeFileSync(path.join(tools, "package.json"), '{ "private": true }\n');
    // npm's own script when this runs through `npm run`, so Windows needs no shell for npm.cmd.
    const npm = process.env.npm_execpath ? [process.execPath, [process.env.npm_execpath]] : ["npm", []];
    run(npm[0], [...npm[1], "install", "--no-audit", "--no-fund", "--no-package-lock", "electron-builder@26.15.3"], {
      cwd: tools, shell: !process.env.npm_execpath && process.platform === "win32",
    });
  }
  return createRequire(path.join(tools, "package.json"))("electron-builder");
}

async function windowsInstaller() {
  step("Making the installer");
  const { build, Platform, Arch } = electronBuilder();
  await build({
    projectDir: root,
    prepackaged: path.join(root, "dist", "package", "Organizer-win32-x64"),
    targets: Platform.WINDOWS.createTarget("nsis", Arch.x64),
    publish: "never",
    config: {
      appId: "Organizer.Desktop", // The app's Windows identity (desktop/main.mjs), kept for the uninstall entry.
      productName: "PacedMind",
      executableName: "Organizer",
      // The publisher and description Windows shows for the installer and under Installed apps.
      extraMetadata: { author: { name: "PacedMind" }, description: "Tasks, time blocks and agent sessions" },
      directories: { output: out },
      // build-desktop.mjs already gave the exe its icon and details.
      win: {
        icon: path.join(root, "desktop", "icon.ico"), signAndEditExecutable: false,
        // NSIS creates an uninstaller during packaging; sign it too, before it is embedded in the installer.
        ...(windowsSigner && { signtoolOptions: {
          signingHashAlgorithms: ["sha256"],
          sign: async ({ path: file }) => signWindowsFiles([file], windowsSigner),
        } }),
      },
      nsis: {
        oneClick: true,
        perMachine: false,
        runAfterFinish: true,
        // The app writes its own shortcuts, with the icon and ID its notifications need (desktop/installer.nsh).
        createDesktopShortcut: false,
        createStartMenuShortcut: false,
        include: path.join(root, "desktop", "installer.nsh"),
        uninstallDisplayName: "PacedMind",
        artifactName: "PacedMind-Windows.${ext}",
      },
    },
  });
  return path.join(out, FILE);
}

function macDiskImage(identity) {
  const app = path.join(root, "dist", "package", "PacedMind-darwin-universal", "PacedMind.app");
  step("Checking the app's signature and notarization");
  run("codesign", ["--verify", "--deep", "--strict", app]);
  run("spctl", ["--assess", "--type", "execute", "--verbose", app]);

  step("Making the disk image");
  // The app beside a link to Applications, so the window that opens says: drag it there.
  const folder = path.join(root, "dist", "dmg");
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  run("ditto", [app, path.join(folder, "PacedMind.app")]);
  fs.symlinkSync("/Applications", path.join(folder, "Applications"));
  const dmg = path.join(out, FILE);
  run("hdiutil", ["create", "-volname", "PacedMind", "-srcfolder", folder, "-fs", "HFS+", "-format", "UDZO", "-ov", dmg]);

  step("Signing and notarizing the disk image");
  run("codesign", ["--sign", identity, "--timestamp", dmg]);
  run("xcrun", ["notarytool", "submit", dmg, "--keychain-profile", notaryProfile, "--wait"]);
  run("xcrun", ["stapler", "staple", dmg]);
  run("spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose", dmg]);
  return dmg;
}

/**
 * Runs a command on the server, with the file as its input when given. A computer's first connection
 * accepts the server's host key (a Mac may never have connected before); a changed key is still refused.
 */
function remote(command, input) {
  const ssh = [...(key ? ["-i", key] : []), "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", server, command];
  if (!input) return execFileSync("ssh", ssh, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const fd = fs.openSync(input, "r");
  try {
    const r = spawnSync("ssh", ssh, { stdio: [fd, "inherit", "inherit"] });
    if (r.status !== 0) throw new Error(`The upload failed (ssh exited with ${r.status ?? r.signal}).`);
  } finally {
    fs.closeSync(fd);
  }
}

function uploadToServer(file) {
  step(`Uploading ${FILE} to ${server}`);
  remote(`sudo install -d -o pacedmind -g pacedmind ${DOWNLOADS}`);
  // Into a temporary name first, checked, then swapped in: a download never gets half a file.
  const part = `${DOWNLOADS}/.${FILE}.part`;
  remote(`sudo -u pacedmind sh -c 'cat > ${part}'`, file);
  const sent = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (remote(`sha256sum ${part}`).split(" ")[0] !== sent) throw new Error("The upload arrived damaged. Run the release again.");
  remote(`sudo -u pacedmind sh -c 'cd ${DOWNLOADS} && { [ ! -f ${FILE} ] || mv -f ${FILE} ${FILE}.old; } && mv -f .${FILE}.part ${FILE}'`);
  console.log(`  https://pacedmind.com/download/${mac ? "mac" : "windows"}`);
}

// Checks that fail in seconds, before a build that takes minutes.
let identity = null;
if (mac) {
  step("Checking the signing certificate and the notarization profile");
  identity = signingIdentity();
  console.log(`  ${identity}`);
  try {
    execFileSync("xcrun", ["notarytool", "history", "--keychain-profile", notaryProfile], { stdio: "ignore" });
  } catch {
    throw new Error(`The keychain has no notarytool profile "${notaryProfile}". Store it once with: xcrun notarytool store-credentials ${notaryProfile} (README.md)`);
  }
}
if (upload) remote("true");

step("Building the app");
run(process.execPath, [path.join(root, "scripts", "build-desktop.mjs"), "--no-install", "--release"], {
  env: { ...process.env, ...(identity && { PACEDMIND_SIGN_IDENTITY: identity }) },
});
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
if (windowsSigner) {
  step("Signing every Windows executable, library and native module");
  signWindowsFiles(windowsExecutables(path.join(root, "dist", "package", "Organizer-win32-x64")), windowsSigner);
}
const file = mac ? macDiskImage(identity) : await windowsInstaller();
if (windowsSigner) {
  step("Signing the installer and preparing its immutable Store artifact");
  signWindowsFiles([file], windowsSigner);
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  console.log(`  ${stageWindowsStoreInstaller(file, version)}`);
}
console.log(`\n  ${file} (${(fs.statSync(file).size / 1e6).toFixed(0)} MB)`);

if (upload) uploadToServer(file);
console.log("\nDone.");
