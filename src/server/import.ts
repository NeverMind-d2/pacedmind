import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataDir } from "./device";
import { thisDeviceId } from "./devices";
import { folderProblem } from "./folders";
import * as repo from "./repo";
import type { AgentId, Project } from "@/lib/types";

/*
 * Finds the folders you work in with Claude Code and Codex on this computer, so they can become PacedMind
 * projects in one go. It only reads what the tools keep for themselves:
 *   - Claude app: its Code sessions (claude-code-sessions/…/local_*.json, the folder each one ran in);
 *   - Claude Code CLI: the projects in ~/.claude.json, and their transcripts in ~/.claude/projects;
 *   - Codex app: its projects (~/.codex/.codex-global-state.json);
 *   - Codex CLI and app threads: ~/.codex/config.toml trusted projects and ~/.codex/sessions transcripts.
 * The same folder found by both tools becomes one project that both agents worked in.
 */

export type ImportSource = "claude-app" | "claude-cli" | "codex-app" | "codex-cli";

export interface FoundProject {
  /** The folder, spelled the way the file system does. */
  folder: string;
  name: string;
  sources: ImportSource[];
  /** When each agent last worked there, as epoch ms (0 when only known, not when). */
  used: Partial<Record<AgentId, number>>;
  /** The PacedMind project that already has this folder. */
  projectId: string | null;
  /** Worth importing without asking: used in the last months, still there, and not a folder that holds other projects. */
  suggested: boolean;
  /** Why it can't become a project's folder, e.g. it was deleted. */
  problem: string | null;
}

const home = os.homedir();
const DAY = 86_400_000;
const RECENT = 120 * DAY;

/** Comparable form of a folder: resolved, no trailing separator, letter case ignored where the file system does. */
function keyOf(folder: string): string {
  const p = path.resolve(folder).replace(/[\\/]+$/, "");
  return process.platform === "linux" ? p : p.toLowerCase();
}

/**
 * The project a folder belongs to. Sessions in a git worktree belong to the repository it was made from, and a
 * session in a subfolder to the repository around it (the nearest folder up with a .git, below your home folder).
 */
function mainFolder(folder: string): string {
  const m = folder.match(/^(.*?)[\\/]\.(?:claude|codex)[\\/]worktrees[\\/]/i);
  const start = m ? m[1] : folder;
  const stop = keyOf(home);
  for (let dir = start, i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir || keyOf(up) === stop) break;
    dir = up;
  }
  return start;
}

const inside = (key: string, parent: string) => key.startsWith(parent + path.sep);

/** Folders that aren't projects: your home and its standard folders, temporary and scratch folders, the tools' own. */
function isScratch(folder: string): boolean {
  const key = keyOf(folder);
  const plain = [home, path.join(home, "Documents"), path.join(home, "Desktop"), path.join(home, "Downloads"), path.parse(path.resolve(folder)).root];
  if (plain.some((d) => key === keyOf(d))) return true;
  const scratch = [
    os.tmpdir(), path.join(home, ".claude"), path.join(home, ".codex"), path.join(home, "Documents", "Codex"),
    path.join(dataDir(), "workspaces"),
  ];
  return scratch.some((d) => key === keyOf(d) || inside(key, keyOf(d))) || /[\\/]claude[\\/]scratch-workspaces[\\/]/i.test(folder);
}

/** Parses the inside of a JSON (or TOML basic) string, or null. */
function unquote(inner: string): string | null {
  try {
    return JSON.parse(`"${inner}"`) as string;
  } catch {
    return null;
  }
}

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const stamp = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

const files = (dir: string, test: (name: string) => boolean): string[] => {
  try {
    return fs.readdirSync(dir).filter(test).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
};

const subdirs = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
};

const mtime = (file: string) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

/** Where the Claude desktop app keeps its data. */
function claudeAppDir(): string {
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Claude");
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "Claude");
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "Claude");
}

const codexHome = () => process.env.CODEX_HOME || path.join(home, ".codex");
const claudeConfigDir = () => process.env.CLAUDE_CONFIG_DIR || home;

type Hit = { folder: string; source: ImportSource; at: number; name?: string };

function claudeAppHits(): Hit[] {
  const hits: Hit[] = [];
  const root = path.join(claudeAppDir(), "claude-code-sessions");
  for (const account of subdirs(root)) {
    for (const org of subdirs(account)) {
      for (const file of files(org, (f) => f.startsWith("local_") && f.endsWith(".json"))) {
        const s = readJson(file) as { originCwd?: string; cwd?: string; lastActivityAt?: unknown; createdAt?: unknown } | null;
        const folder = s?.originCwd || s?.cwd;
        if (folder) hits.push({ folder, source: "claude-app", at: stamp(s?.lastActivityAt) || stamp(s?.createdAt) });
      }
    }
  }
  return hits;
}

function claudeCliHits(): Hit[] {
  const config = readJson(path.join(claudeConfigDir(), ".claude.json")) as { projects?: Record<string, unknown> } | null;
  const transcripts = path.join(/*turbopackIgnore: true*/ claudeConfigDir(), ".claude", "projects");
  return Object.keys(config?.projects ?? {}).map((folder) => {
    // Claude Code names a project's transcript folder after its path, with every other character as "-".
    const dir = path.join(transcripts, folder.replace(/[^a-zA-Z0-9]/g, "-"));
    const at = Math.max(0, ...files(dir, (f) => f.endsWith(".jsonl")).map(mtime));
    return { folder, source: "claude-cli" as const, at };
  });
}

function codexAppHits(): Hit[] {
  const state = readJson(path.join(codexHome(), ".codex-global-state.json")) as {
    "local-projects"?: Record<string, { name?: string; rootPaths?: string[]; updatedAt?: unknown }>;
  } | null;
  return Object.values(state?.["local-projects"] ?? {}).flatMap((p) =>
    (p.rootPaths ?? []).slice(0, 1).map((folder) => ({ folder, source: "codex-app" as const, at: stamp(p.updatedAt), name: p.name })));
}

function codexCliHits(): Hit[] {
  const hits: Hit[] = [];
  try {
    const toml = fs.readFileSync(path.join(/*turbopackIgnore: true*/ codexHome(), "config.toml"), "utf8");
    for (const m of toml.matchAll(/^\[projects\.(?:'([^']+)'|"((?:[^"\\]|\\.)+)")\]/gm)) {
      const folder = m[1] ?? unquote(m[2]);
      if (folder) hits.push({ folder, source: "codex-cli", at: 0 });
    }
  } catch {
    // No config yet.
  }
  // Each transcript starts with a line that names the folder it ran in.
  const walk = (dir: string, depth: number): string[] =>
    depth ? subdirs(dir).flatMap((d) => walk(d, depth - 1)) : files(dir, (f) => f.startsWith("rollout-") && f.endsWith(".jsonl"));
  for (const file of walk(path.join(/*turbopackIgnore: true*/ codexHome(), "sessions"), 3)) {
    let head = "";
    try {
      const fd = fs.openSync(file, "r");
      const buf = Buffer.alloc(4096);
      head = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString("utf8");
      fs.closeSync(fd);
    } catch {
      continue;
    }
    // Only conversations you had: not `codex exec` runs that scripts start, nor subagents.
    if (/"source":(?:"exec"|\{)/.test(head)) continue;
    const cwd = unquote(head.match(/"cwd":"((?:[^"\\]|\\.)*)"/)?.[1] ?? "");
    if (!cwd) continue;
    const source: ImportSource = /"originator":"Codex Desktop"/.test(head) ? "codex-app" : "codex-cli";
    hits.push({ folder: cwd, source, at: mtime(file) });
  }
  return hits;
}

/** The spelling the file system uses for a folder that exists (Windows paths keep the case they were typed in). */
function realFolder(folder: string): string {
  try {
    return fs.realpathSync.native(folder);
  } catch {
    return path.normalize(folder);
  }
}

/** Projects worth bringing over from Claude Code and Codex on this computer, most recently used first. */
export async function findProjects(): Promise<FoundProject[]> {
  const hits = [...codexAppHits(), ...claudeAppHits(), ...claudeCliHits(), ...codexCliHits()];
  const byKey = new Map<string, { folder: string; name?: string; sources: Set<ImportSource>; used: Partial<Record<AgentId, number>> }>();
  for (const h of hits) {
    // Folders that were moved or deleted since can't become projects.
    if (!path.isAbsolute(h.folder.trim()) || !fs.existsSync(h.folder.trim())) continue;
    const folder = mainFolder(h.folder.trim());
    if (isScratch(folder)) continue;
    const key = keyOf(folder);
    const entry = byKey.get(key) ?? { folder, sources: new Set<ImportSource>(), used: {} };
    const agent: AgentId = h.source.startsWith("claude") ? "claude" : "codex";
    entry.sources.add(h.source);
    entry.used[agent] = Math.max(entry.used[agent] ?? 0, h.at);
    // A name you gave the project in the Codex app beats the folder's name.
    if (h.name && !entry.name) entry.name = h.name;
    byKey.set(key, entry);
  }

  const projects = await repo.listProjects();
  const keys = [...byKey.keys()];
  const now = Date.now();
  const found = [...byKey.entries()].map(([key, e]): FoundProject => {
    const folder = realFolder(e.folder);
    const problem = folderProblem(folder);
    const projectId = projects.find((p) => p.folder && keyOf(p.folder) === key)?.id ?? null;
    const last = Math.max(0, ...Object.values(e.used).map((v) => v ?? 0));
    // A folder that holds two or more of the others (like a "Projects" folder) isn't a project itself.
    const holds = keys.filter((k) => inside(k, key)).length;
    return {
      folder,
      name: e.name?.trim() || path.basename(folder),
      sources: [...e.sources].sort(),
      used: e.used,
      projectId,
      suggested: !problem && !projectId && holds < 2 && now - last < RECENT,
      problem,
    };
  });
  const lastOf = (f: FoundProject) => Math.max(0, ...Object.values(f.used).map((v) => v ?? 0));
  return found.sort((a, b) => lastOf(b) - lastOf(a) || a.name.localeCompare(b.name));
}

export interface ImportItem {
  folder: string;
  name: string;
  agent: AgentId | null;
}

/** Makes projects from found folders, in one area, on this computer (their folders are this computer's). Folders that already are a project here are skipped. */
export async function importProjects(items: ImportItem[], areaId: string): Promise<{ created: Project[]; skipped: string[] }> {
  const created: Project[] = [];
  const skipped: string[] = [];
  const taken = new Set((await repo.listProjects()).flatMap((p) => (p.folder ? [keyOf(p.folder)] : [])));
  const deviceId = thisDeviceId();
  for (const item of items) {
    const folder = item.folder.trim();
    const key = keyOf(folder);
    if (taken.has(key) || folderProblem(folder) || !item.name.trim()) {
      skipped.push(item.name || folder);
      continue;
    }
    taken.add(key);
    created.push(await repo.createProject({ name: item.name.trim(), areaId, folder, deviceId, agent: item.agent }));
  }
  return { created, skipped };
}
