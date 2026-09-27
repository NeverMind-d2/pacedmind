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
 * PacedMind only reads that, to tell you the question is coming (views.ts, session-list.ts, the launcher's messages).
 * It never answers for you: a yes also lets Claude Code use the folder's own settings, hooks and MCP servers.
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
