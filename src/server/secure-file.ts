import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/*
 * JSON files with secrets on this computer: the desktop app's sign-in session and its device settings (MCP
 * tokens, agent commands, project folders). The desktop app keeps a random key in the OS keychain (Electron
 * safeStorage: DPAPI on Windows, Keychain on macOS) and hands it to the server at start in
 * ORGANIZER_DATA_KEY, so these files are encrypted at rest (AES-256-GCM, bound to their file name).
 * `npm run dev` has no keychain and writes plain JSON into the repo's data/ folder, which is for development
 * only.
 */

const PREFIX = "pacedmind-encrypted-v1:";

function dataKey(): Buffer | null {
  const raw = process.env.ORGANIZER_DATA_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

/** Whether files are encrypted, i.e. the server was started by the desktop app. */
export const encryptedAtRest = () => dataKey() !== null;

export function readSecureJson<T>(file: string): T | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const key = dataKey();
  if (!text.startsWith(PREFIX)) {
    if (!key) return JSON.parse(text) as T;
    // The desktop app only ever writes these encrypted: a plain one was put there by something else.
    fs.renameSync(file, `${file}.unencrypted-${Date.now()}`);
    return null;
  }
  if (!key) throw new Error(`${path.basename(file)} is encrypted and only the PacedMind desktop app can open it.`);
  try {
    const raw = Buffer.from(text.slice(PREFIX.length), "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(path.basename(file)));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as T;
  } catch {
    // Written with another key (the keychain changed) or tampered with: set it aside and start over, which
    // means signing in again and setting up this computer again. Nothing in it is trusted.
    fs.renameSync(file, `${file}.unreadable-${Date.now()}`);
    return null;
  }
}

/** Writes the whole file at once (a crash never leaves half a file), readable only by this user on macOS and Linux. */
export function writeSecureJson(file: string, value: unknown) {
  const json = JSON.stringify(value);
  const key = dataKey();
  let out = json;
  if (key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(path.basename(file)));
    const body = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
    out = PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, out, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function removeFile(file: string) {
  fs.rmSync(file, { force: true });
}
