// Used only by `npm run release -- --store`. No upload, install or certificate import.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function windowsSigningConfig(env = process.env) {
  const certificate = env.PACEDMIND_WINDOWS_CERT_SHA1?.replace(/\s/g, "");
  if (!certificate || !/^[a-f\d]{40}$/i.test(certificate)) {
    throw new Error("Set PACEDMIND_WINDOWS_CERT_SHA1 to the thumbprint of your trusted code-signing certificate in the current user's certificate store.");
  }
  return { certificate, tool: env.PACEDMIND_SIGNTOOL || "signtool.exe" };
}

export function signWindowsFiles(files, config = windowsSigningConfig()) {
  if (process.platform !== "win32") throw new Error("Windows Store installers must be signed on Windows.");
  for (const file of files) {
    execFileSync(config.tool, ["sign", "/sha1", config.certificate, "/fd", "SHA256", "/tr", "http://timestamp.digicert.com", "/td", "SHA256", file], { stdio: "inherit" });
    execFileSync(config.tool, ["verify", "/pa", "/all", "/v", file], { stdio: "inherit" });
  }
}

export function windowsExecutables(directory) {
  const files = [];
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`A Store build must not contain symbolic links: ${file}`);
      if (entry.isDirectory()) walk(file);
      else if (/\.(exe|dll|node)$/i.test(entry.name)) files.push(file);
    }
  }
  walk(directory);
  if (!files.length) throw new Error(`No Windows executables found in ${directory}.`);
  return files;
}

/** Content-addressed artifacts cannot silently replace the installer submitted to Partner Center. */
export function stageWindowsStoreInstaller(installer, version) {
  if (!/^\d+\.\d+\.\d+(?:-[a-z\d.-]+)?$/i.test(version)) throw new Error("Invalid Store installer version.");
  const data = fs.readFileSync(installer);
  const sha256 = createHash("sha256").update(data).digest("hex");
  const file = `PacedMind-Windows-${version}-${sha256.slice(0, 16)}.exe`;
  const target = path.join(path.dirname(installer), file);
  if (fs.existsSync(target) && !fs.readFileSync(target).equals(data)) throw new Error(`Refusing to replace ${target}.`);
  fs.writeFileSync(target, data);
  fs.writeFileSync(`${target}.json`, `${JSON.stringify({
    productName: "PacedMind", appId: "Organizer.Desktop", version, file, sha256,
    architecture: "x64", installScope: "user", silentInstall: "/S", silentUninstall: "/S",
    // Upload this exact immutable artifact to HTTPS; /download/windows is a mutable URL and is unsuitable.
    installerUrl: null,
  }, null, 2)}\n`);
  return target;
}
