import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoIdentity } from "./git-remote";
import { claudeAppDir } from "./import";
import { OTHER_SESSIONS_MAX, oneLine } from "./store/shared";
import type { Harness, OtherSession, OtherSessionState, Project } from "@/lib/types";

/*
 * The Claude Code and Codex sessions on this computer that PacedMind didn't start, from the records the tools keep for
 * themselves, read-only like import.ts: Claude Code's transcripts (~/.claude/projects), the Claude app's Code sessions,
 * and Codex's (~/.codex/sessions, their names in session_index.jsonl). Only the first and last part of a transcript is
 * read, and only what the Sessions page shows goes further: a title, the folder's name, the project, the state and two
 * times, never the conversation or a path.
 */

const home = os.homedir();
/** Sessions active in the last three days. */
const WINDOW = 3 * 86_400_000;
/** Written to in the last two minutes, in the middle of a turn: at work. */
const WORKING_MS = 2 * 60_000;
/** Nothing for six hours: idle. */
const IDLE_MS = 6 * 3_600_000;
/** The first message of a session PacedMind started, with or without the task title (launcher.ts). */
const PACEDMIND = /^(?:Task title: .{1,200}\. Use the task title as the session name\. )?PacedMind task [A-Z][A-Z0-9]{1,7}-\d+, session [0-9a-f]{16}/;

const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || home;
const codexHome = () => process.env.CODEX_HOME || path.join(home, ".codex");

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function entries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Files under `dir`, `depth` folders down, that pass `test` and changed since `since`. */
function recent(dir: string, depth: number, test: (name: string) => boolean, since: number): { file: string; mtime: number; size: number }[] {
  const out: { file: string; mtime: number; size: number }[] = [];
  for (const e of entries(dir)) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0) out.push(...recent(p, depth - 1, test, since));
    else if (e.isFile() && test(e.name)) {
      try {
        const st = fs.statSync(p);
        if (st.mtimeMs >= since) out.push({ file: p, mtime: st.mtimeMs, size: st.size });
      } catch {
        // Gone meanwhile.
      }
    }
  }
  return out;
}

/** The JSON lines of a transcript's first and last 64 KB: its first message and its latest state, never all of it. */
function ends(file: string, size: number): { head: Json[]; tail: Json[] } {
  const SPAN = 65_536;
  const parse = (text: string, from: "start" | "cut") =>
    text.split("\n").slice(from === "cut" ? 1 : 0).flatMap((l) => {
      try {
        const j: unknown = JSON.parse(l);
        return isObject(j) ? [j] : [];
      } catch {
        return [];
      }
    });
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return { head: [], tail: [] };
  }
  try {
    const read = (at: number, n: number) => {
      const b = Buffer.alloc(n);
      return b.subarray(0, fs.readSync(fd, b, 0, n, at)).toString("utf8");
    };
    const head = parse(read(0, Math.min(SPAN, size)), "start");
    return { head, tail: size > SPAN ? parse(read(size - SPAN, SPAN), "cut") : head };
  } finally {
    fs.closeSync(fd);
  }
}

/** A message someone typed, not the tools' own wrapping around one (slash commands, reminders, instructions, context). */
function typed(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  return t && !t.startsWith("<") && !t.startsWith("Caveat:") && !t.startsWith("# AGENTS.md") ? t : null;
}

/** The text of a Claude Code message you typed; null for tool results. */
function claudeText(content: unknown): string | null {
  if (typeof content === "string") return typed(content);
  if (!Array.isArray(content) || content.some((c) => isObject(c) && c.type === "tool_result")) return null;
  for (const c of content) {
    const t = isObject(c) && c.type === "text" ? typed(c.text) : null;
    if (t) return t;
  }
  return null;
}

/** A finished turn waits for you; one in the middle is at work when written to just now, else waiting too (for a permission, say). */
function stateOf(ended: boolean, activeAt: number, now: number): OtherSessionState {
  if (now - activeAt > IDLE_MS) return "idle";
  return !ended && now - activeAt < WORKING_MS ? "working" : "waiting";
}

type Found = { harness: Harness; ref: string; cli?: string; title: string; folder: string; ended: boolean; startedAt: number; activeAt: number };

/**
 * Whether a transcript is a conversation someone had in a terminal or an editor, going by its first message: not the
 * Claude app's (listed from the app's own records), and not one a program ran through Claude Code, such as a summary
 * or a check, which has no entry point, came in through the SDK, or wasn't typed by a person.
 */
function typedHere(j: Json): boolean {
  const entry = typeof j.entrypoint === "string" ? j.entrypoint : "";
  if (!entry || entry === "claude-desktop" || entry.startsWith("sdk") || j.turnOrigin === "sdk") return false;
  return !isObject(j.origin) || j.origin.kind === "human";
}

/** What a Claude Code transcript tells: its folder, first message, title and whether its last turn ended. */
function readClaude(file: string, size: number, mtime: number) {
  const { head, tail } = ends(file, size);
  let folder: string | null = null;
  let started: number | null = null;
  let opening: Json | null = null;
  let first: string | null = null;
  let title: string | null = null;
  for (const j of [...head, ...tail]) {
    if (!folder && typeof j.cwd === "string") folder = j.cwd;
    if (started === null && typeof j.timestamp === "string" && !Number.isNaN(Date.parse(j.timestamp))) started = Date.parse(j.timestamp);
    if (!first && j.type === "user" && !j.isSidechain && !j.isMeta && isObject(j.message)) {
      opening ??= j;
      first = claudeText(j.message.content);
    }
    if (j.type === "custom-title" && typeof j.customTitle === "string" && j.customTitle.trim()) title = j.customTitle;
  }
  const turn = [...tail].reverse().find((j) => (j.type === "user" || j.type === "assistant") && !j.isSidechain);
  const ended = turn?.type === "assistant" && isObject(turn.message) && turn.message.stop_reason === "end_turn";
  return { folder, first, title, ended, startedAt: started ?? mtime, typed: !!opening && typedHere(opening) };
}

function claudeSessions(since: number): Found[] {
  const transcripts = new Map(
    recent(path.join(claudeDir(), ".claude", "projects"), 1, (f) => f.endsWith(".jsonl") && !f.startsWith("agent-"), since)
      .map((t) => [path.basename(t.file, ".jsonl"), t]),
  );
  const out: Found[] = [];
  // The Claude app runs Claude Code: its sessions have a transcript too, which is theirs, not a terminal's.
  for (const { file, mtime } of recent(path.join(claudeAppDir(), "claude-code-sessions"), 2, (f) => f.startsWith("local_") && f.endsWith(".json"), since)) {
    let s: unknown;
    try {
      s = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (!isObject(s) || s.isArchived === true || typeof s.sessionId !== "string") continue;
    const cli = typeof s.cliSessionId === "string" ? s.cliSessionId : null;
    const t = cli ? transcripts.get(cli) : undefined;
    if (cli) transcripts.delete(cli);
    const read = t ? readClaude(t.file, t.size, t.mtime) : null;
    const folder = typeof s.originCwd === "string" ? s.originCwd : typeof s.cwd === "string" ? s.cwd : read?.folder;
    if (!folder || (read?.first && PACEDMIND.test(read.first)) || (typeof s.title === "string" && PACEDMIND.test(s.title))) continue;
    const activeAt = Math.max(typeof s.lastActivityAt === "number" ? s.lastActivityAt : 0, t?.mtime ?? 0, read ? 0 : mtime);
    out.push({
      harness: "claude-app", ref: s.sessionId, ...(cli ? { cli } : {}), folder, ended: read?.ended ?? true,
      title: (typeof s.title === "string" && s.title) || read?.title || read?.first || "",
      startedAt: typeof s.createdAt === "number" ? s.createdAt : read?.startedAt ?? activeAt, activeAt,
    });
  }
  for (const [ref, t] of transcripts) {
    const read = readClaude(t.file, t.size, t.mtime);
    if (!read.typed || !read.folder || !read.first || PACEDMIND.test(read.first)) continue;
    out.push({ harness: "claude-cli", ref, folder: read.folder, ended: read.ended, title: read.title || read.first, startedAt: read.startedAt, activeAt: t.mtime });
  }
  return out;
}

/** Codex's names for its threads, the latest one each. */
function codexNames(): Map<string, string> {
  const names = new Map<string, string>();
  let text = "";
  try {
    text = fs.readFileSync(path.join(codexHome(), "session_index.jsonl"), "utf8");
  } catch {
    return names;
  }
  for (const l of text.split("\n")) {
    try {
      const j: unknown = JSON.parse(l);
      if (isObject(j) && typeof j.id === "string" && typeof j.thread_name === "string" && j.thread_name.trim()) names.set(j.id, j.thread_name);
    } catch {
      // A line being written.
    }
  }
  return names;
}

function codexSessions(since: number): Found[] {
  const names = codexNames();
  const out: Found[] = [];
  for (const t of recent(path.join(codexHome(), "sessions"), 3, (f) => f.startsWith("rollout-") && f.endsWith(".jsonl"), since)) {
    const { head, tail } = ends(t.file, t.size);
    const meta = head.find((j) => j.type === "session_meta");
    const m = isObject(meta?.payload) ? meta.payload : null;
    // Only conversations you had: not `codex exec` runs that scripts start, nor subagents (as import.ts).
    if (!m || typeof m.id !== "string" || typeof m.cwd !== "string" || m.source === "exec" || isObject(m.source)) continue;
    let first: string | null = null;
    for (const j of head) {
      const p = isObject(j.payload) ? j.payload : null;
      if (j.type !== "response_item" || p?.type !== "message" || p.role !== "user" || !Array.isArray(p.content)) continue;
      for (const c of p.content) first ??= isObject(c) ? typed(c.text) : null;
      if (first) break;
    }
    if (!first || PACEDMIND.test(first)) continue;
    const turn = [...tail].reverse().find((j) => j.type === "event_msg" && isObject(j.payload)
      && ["task_started", "task_complete", "turn_aborted"].includes(String(j.payload.type)));
    out.push({
      harness: m.originator === "Codex Desktop" ? "codex-app" : "codex-cli", ref: m.id, folder: m.cwd,
      ended: !turn || (isObject(turn.payload) && turn.payload.type !== "task_started"), title: names.get(m.id) ?? first,
      startedAt: typeof m.timestamp === "string" && !Number.isNaN(Date.parse(m.timestamp)) ? Date.parse(m.timestamp) : t.mtime, activeAt: t.mtime,
    });
  }
  return out;
}

const keyOf = (folder: string) => {
  const p = path.resolve(folder).replace(/[\\/]+$/, "");
  return process.platform === "linux" ? p : p.toLowerCase();
};

const g = globalThis as unknown as { __pacedmindOthers?: { at: number; projects: string; list: OtherSession[] } };

const clean = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);

/**
 * This computer's sessions that PacedMind didn't start, active in the last three days, the latest first. Each gets the
 * project whose folder here holds its folder, else the project of its repository (a worktree kept elsewhere, say).
 * `attached`: the conversations PacedMind's sessions have (Session.cliSessionId), so one attached to a task is
 * PacedMind's now and leaves this list. Looked for again after 20 seconds at the most.
 */
export function scanOtherSessions(projects: Project[], attached: Set<string>, now = Date.now()): OtherSession[] {
  const signature = `${projects.map((p) => `${p.id}:${p.folder ?? ""}:${p.repo ?? ""}`).join("|")}#${[...attached].sort().join(",")}`;
  const cached = g.__pacedmindOthers;
  if (cached && now - cached.at < 20_000 && cached.projects === signature) return cached.list;
  const since = now - WINDOW;
  const found = [...claudeSessions(since), ...codexSessions(since)]
    .filter((f) => f.activeAt >= since && !attached.has(clean(f.ref)) && !(f.cli && attached.has(clean(f.cli))))
    .sort((a, b) => b.activeAt - a.activeAt).slice(0, OTHER_SESSIONS_MAX);
  const byFolder = projects.flatMap((p) => (p.folder ? [{ id: p.id, key: keyOf(p.folder) }] : [])).sort((a, b) => b.key.length - a.key.length);
  const repos = new Map<string, string | null>();
  const projectOf = (folder: string): string | null => {
    const key = keyOf(folder);
    const held = byFolder.find((p) => key === p.key || key.startsWith(p.key + path.sep));
    if (held) return held.id;
    if (!repos.has(key)) repos.set(key, repoIdentity(folder)?.split("#")[0] ?? null);
    const repo = repos.get(key);
    return (repo && projects.find((p) => p.repo?.split("#")[0] === repo)?.id) || null;
  };
  const list = found.map((f): OtherSession => ({
    harness: f.harness, ref: clean(f.ref), ...(f.cli && clean(f.cli) ? { cli: clean(f.cli) } : {}), title: oneLine(f.title, 100),
    place: oneLine(path.basename(f.folder), 80),
    projectId: projectOf(f.folder), state: stateOf(f.ended, f.activeAt, now),
    startedAt: new Date(Math.min(f.startedAt, f.activeAt)).toISOString(), activeAt: new Date(f.activeAt).toISOString(),
  })).filter((s) => s.ref);
  g.__pacedmindOthers = { at: now, projects: signature, list };
  return list;
}

/**
 * One of this computer's sessions that PacedMind didn't start, with its folder, to attach it to a task (attach.ts):
 * looked for again now, among those of the last three days. Null when it isn't there (any more).
 */
export function otherSessionHere(harness: Harness, ref: string, now = Date.now()): { session: OtherSession; folder: string } | null {
  const since = now - WINDOW;
  const f = (harness.startsWith("claude") ? claudeSessions(since) : codexSessions(since)).find((x) => x.harness === harness && clean(x.ref) === ref);
  if (!f) return null;
  return {
    folder: f.folder,
    session: {
      harness: f.harness, ref: clean(f.ref), ...(f.cli && clean(f.cli) ? { cli: clean(f.cli) } : {}), title: oneLine(f.title, 100),
      place: oneLine(path.basename(f.folder), 80), projectId: null, state: stateOf(f.ended, f.activeAt, now),
      startedAt: new Date(Math.min(f.startedAt, f.activeAt)).toISOString(), activeAt: new Date(f.activeAt).toISOString(),
    },
  };
}

const CONVERSATION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The folder a Claude Code transcript started in: its first line that names one. Its first lines can be file snapshots
 * only, so it reads on, 64 KB at a time, up to 4 MB; later lines name the folder of each resume, wherever that ran.
 */
function firstFolder(file: string): string | null {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(65_536);
    let rest = "";
    for (let pos = 0; pos < 4 << 20; ) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (!n) break;
      pos += n;
      const lines = (rest + buf.toString("utf8", 0, n)).split("\n");
      rest = lines.pop() ?? "";
      for (const l of lines) {
        if (!l.includes('"cwd"')) continue;
        try {
          const j: unknown = JSON.parse(l);
          if (isObject(j) && typeof j.cwd === "string") return j.cwd;
        } catch {
          // Not a whole line.
        }
      }
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The folder a Claude Code or Codex conversation on this computer ran in, from the agent's own record of it: where a
 * resume has to run, since Claude Code finds a conversation only from its own folder. Null when this computer has no
 * record of it. Read-only, like the rest of this file.
 */
export function conversationFolder(agent: "claude" | "codex", id: string): string | null {
  if (!CONVERSATION.test(id)) return null;
  if (agent === "claude") {
    const projects = path.join(claudeDir(), ".claude", "projects");
    for (const d of entries(projects)) {
      if (!d.isDirectory()) continue;
      const file = path.join(projects, d.name, `${id}.jsonl`);
      if (fs.existsSync(file)) return firstFolder(file);
    }
    return null;
  }
  for (const t of recent(path.join(codexHome(), "sessions"), 3, (f) => f.startsWith("rollout-") && f.endsWith(`${id}.jsonl`), 0)) {
    const meta = ends(t.file, t.size).head.find((j) => j.type === "session_meta");
    const m = isObject(meta?.payload) ? meta.payload : null;
    if (m && m.id === id && typeof m.cwd === "string") return m.cwd;
  }
  return null;
}
