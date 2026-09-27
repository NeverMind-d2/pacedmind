import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/*
 * The desktop app's window key. The server answers on 127.0.0.1, where every program on the computer can
 * reach it: agents in their terminals, other Windows users, a page doing DNS rebinding. Only the app's own
 * window may use its pages and Server Actions, which can start sessions and change what runs here. The
 * desktop app makes a new key each time it starts (ORGANIZER_UI_SECRET, which agent terminals never get)
 * and gives it to its window as an HttpOnly cookie; its main process sends it as a header.
 *
 * `npm run dev` has no window of its own: it keeps a key in data/ui-key and prints a link that sets the
 * cookie in your browser (see src/instrumentation.ts).
 *
 * Imported by proxy.ts, so no "server-only" here.
 */

export const UI_COOKIE = "pm_ui";
export const UI_HEADER = "x-pacedmind-ui";

const devKeyFile = () =>
  path.join(process.env.ORGANIZER_DB ? path.dirname(process.env.ORGANIZER_DB) : path.join(/*turbopackIgnore: true*/ process.cwd(), "data"), "ui-key");

export function uiKey(): string {
  const fromApp = process.env.ORGANIZER_UI_SECRET;
  if (fromApp && fromApp.length >= 32) return fromApp;
  const file = devKeyFile();
  try {
    const saved = fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8").trim();
    if (saved.length >= 32) return saved;
  } catch {
    // First start: make one.
  }
  const key = crypto.randomBytes(32).toString("base64url");
  fs.mkdirSync(path.dirname(/*turbopackIgnore: true*/ file), { recursive: true });
  fs.writeFileSync(/*turbopackIgnore: true*/ file, key, { mode: 0o600 });
  return key;
}

/** Whether `given` is the window key, compared in constant time. */
export function isUiKey(given: string | null | undefined): boolean {
  if (!given) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(uiKey()).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Whether this server was started by the desktop app (which holds the key) rather than `npm run dev`. */
export const startedByApp = () => (process.env.ORGANIZER_UI_SECRET ?? "").length >= 32;
