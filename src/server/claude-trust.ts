import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot } from "./folders";

/*
 * The first time Claude Code starts in a folder, it asks whether you trust it ("Accessing workspace") and waits for
 * the answer before it reads its first message, so a session PacedMind started there waits for you in its terminal.
 * Only "Yes, I trust this folder" is kept: in Claude Code's config (~/.claude.json), as
 * projects[folder].hasTrustDialogAccepted. A folder counts as trusted when it or a folder above it was, up to the root
 * of the repository it's in.
 *
 * With this computer's "Trust session folders" on (device.ts, the default), the launcher gives that answer before it
 * starts a session (trustForClaude): for the session's folder only, and nothing else in the file. A yes also lets
 * Claude Code use the folder's own settings, hooks and MCP servers, so with it off PacedMind only reads the file, to
 * tell you the question is coming (views.ts, session-list.ts, the launcher's messages).
 */

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Claude Code's config, where devices.ts reads its MCP servers. */
const configFile = () => path.join(/*turbopackIgnore: true*/ process.env.CLAUDE_CONFIG_DIR || os.homedir(), ".claude.json");

/** How a name compares: Windows paths ignore case. */
const fold = (name: string) => (process.platform === "win32" ? name.toLowerCase() : name).normalize("NFC");

/**
 * A folder under the name Claude Code keeps it by: with forward slashes on Windows. Older versions wrote backslashes,
 * and Claude Code doesn't look those up anymore, so they don't count.
 */
const nameOf = (folder: string) => fold(process.platform === "win32" ? folder.replace(/\\/g, "/") : folder);

/**
 * Reads Claude Code's config once and returns whether it will ask about each folder given, as many as needed (a page's
 * tasks, say). Null when there's no config to read: Claude Code then sets itself up the first time it runs.
 */
export function trustCheck(): ((folder: string) => boolean) | null {
  let config: unknown;
  try {
    config = JSON.parse(fs.readFileSync(configFile(), "utf8"));
  } catch {
    return null;
  }
  const projects = isObject(config) && isObject(config.projects) ? config.projects : {};
  const trusted = new Set(
    Object.entries(projects).filter(([, p]) => isObject(p) && p.hasTrustDialogAccepted === true).map(([name]) => fold(name)),
  );
  // Tasks share their project's folders, and the folders above theirs.
  const git = new Map<string, boolean>();
  const hasGit = (dir: string) => git.get(dir) ?? git.set(dir, fs.existsSync(path.join(dir, ".git"))).get(dir)!;
  const asks = new Map<string, boolean>();
  return (folder) => {
    const start = path.resolve(folder);
    let answer = asks.get(start);
    if (answer === undefined) {
      const root = repoRoot(start, hasGit);
      answer = true;
      for (let dir = start; ; dir = path.dirname(dir)) {
        if (trusted.has(nameOf(dir))) {
          answer = false;
          break;
        }
        if (dir === root || path.dirname(dir) === dir) break;
      }
      asks.set(start, answer);
    }
    return answer;
  };
}

/** The names Claude Code may keep a folder by: as the session's terminal changes into it, and as the disk spells it. */
function namesOf(folder: string): string[] {
  const slashes = (p: string) => (process.platform === "win32" ? p.replace(/\\/g, "/") : p);
  let real = folder;
  try {
    real = fs.realpathSync.native(folder);
  } catch {
    // A folder that's gone gets no session anyway.
  }
  return [...new Set([slashes(path.resolve(folder)), slashes(real)])];
}

/**
 * Answers "Yes, I trust this folder" for `folder` before a session starts there, as the question itself would. Only
 * when Claude Code has a config here (it has run) and doesn't trust the folder yet. The file is written next to itself
 * and moved over, so Claude Code never reads half of it, and written again from a fresh read if it changed meanwhile.
 * Returns whether it answered.
 */
export function trustForClaude(folder: string): boolean {
  if (!trustCheck()?.(folder)) return false;
  let file: string;
  try {
    // A config linked from elsewhere (a dotfiles folder, say) stays a link.
    file = fs.realpathSync(configFile());
  } catch {
    return false;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    let text: string;
    let before: number;
    try {
      before = fs.statSync(file).mtimeMs;
      text = fs.readFileSync(file, "utf8");
    } catch {
      return false;
    }
    let config: unknown;
    try {
      config = JSON.parse(text);
    } catch {
      return false;
    }
    if (!isObject(config)) return false;
    const projects: Json = isObject(config.projects) ? config.projects : {};
    for (const name of namesOf(folder)) projects[name] = { ...(isObject(projects[name]) ? projects[name] : {}), hasTrustDialogAccepted: true };
    config.projects = projects;
    const indent = text.match(/^\{\r?\n([ \t]+)"/)?.[1] ?? 2;
    const temp = `${file}.pacedmind-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temp, JSON.stringify(config, null, indent) + (text.endsWith("\n") ? "\n" : ""), { mode: fs.statSync(file).mode & 0o777 });
    if (fs.statSync(file).mtimeMs !== before) {
      fs.rmSync(temp, { force: true });
      continue;
    }
    fs.renameSync(temp, file);
    return true;
  }
  return false;
}
