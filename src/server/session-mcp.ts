import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as repo from "./repo";
import { mcpStatusText, type McpProblem } from "@/lib/dates";
import { AGENT_LABEL, MCP_NAME, OLD_MCP_NAME, isLiveSession, type Session } from "@/lib/types";

/*
 * What a Claude Code session PacedMind started in a terminal has from its MCP servers, as Claude Code itself records
 * it in the session's transcript (~/.claude/projects/<folder>/<conversation>.jsonl), read-only like other-sessions.ts:
 * each time its tools change it writes a `deferred_tools_delta` record with the tools it gained and lost, and the
 * servers still connecting, the ones that failed (with an error code) and the ones waiting for you to sign in. That's
 * what the session really has, which its agent's own account of it (start_task's environment) isn't always: an agent
 * told a server failed can still list it. Only names and error codes leave here, never an error's text (it can hold
 * paths), a server's command or its address. Claude Code writes those records while it defers MCP tools (tool search,
 * its default); without them there's nothing to read, and the session shows what its agent says. Codex's session
 * records don't say how its MCP servers are.
 */

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** A server's name as the session's records have it: plain characters, and short. */
const NAME = /^[\w.@:+ -]{1,60}$/;
const CODE = /^[A-Za-z0-9_-]{1,40}$/;
const CONVERSATION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A transcript this long is left unread when it's read whole (at start_task, a session's is short). */
const MAX_BYTES = 32 * 1024 * 1024;
/** How much of its end a later look reads: the servers' latest state is in its latest record. */
const TAIL_BYTES = 512 * 1024;

export interface SessionMcp {
  /** The servers it has tools from, as its tools name them (mcp__<server>__…), PacedMind's left out. */
  servers: string[];
  /** Servers that failed to start, with the error code Claude Code gave (ENOENT…) when it had one. */
  failed: { name: string; code: string | null }[];
  /** Servers that wait for you to sign in to them (/mcp in its terminal). */
  needsAuth: string[];
  /** Servers still connecting. */
  pending: string[];
}

const projectsDir = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");

/** The transcript of Claude Code conversation `cli` in `folder`: in its folder's directory, else wherever it is. */
function transcriptOf(folder: string, cli: string): string | null {
  if (!CONVERSATION.test(cli)) return null;
  const dir = projectsDir();
  const guess = path.join(/*turbopackIgnore: true*/ dir, folder.replace(/[^A-Za-z0-9-]/g, "-"), `${cli}.jsonl`);
  if (fs.existsSync(guess)) return guess;
  try {
    // Long folder names get shortened in newer versions: look for the conversation itself.
    for (const d of fs.readdirSync(/*turbopackIgnore: true*/ dir)) {
      const f = path.join(/*turbopackIgnore: true*/ dir, d, `${cli}.jsonl`);
      if (fs.existsSync(f)) return f;
    }
  } catch {
    // No transcripts here.
  }
  return null;
}

/** The text of `file`, whole, or its last `tail` bytes (from the first full line in them). */
function read(file: string, tail: number | null): string | null {
  try {
    const size = fs.statSync(/*turbopackIgnore: true*/ file).size;
    if (tail === null) return size > MAX_BYTES ? null : fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8");
    const fd = fs.openSync(/*turbopackIgnore: true*/ file, "r");
    try {
      const n = Math.min(size, tail);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, size - n);
      const text = buf.toString("utf8");
      return n < size ? text.slice(text.indexOf("\n") + 1) : text;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * What Claude Code conversation `cli` in `folder` has from its MCP servers, from its transcript: the whole of it
 * (`whole`), for the tools it gained and lost since it started, or its end, for the servers' latest state alone
 * (servers is then empty). Null when there's no such record to read.
 */
export function sessionMcp(folder: string, cli: string, whole = true): SessionMcp | null {
  const file = transcriptOf(folder, cli);
  const text = file ? read(file, whole ? null : TAIL_BYTES) : null;
  if (!text) return null;
  const tools = new Set<string>();
  let last: Json | null = null;
  for (const line of text.split("\n")) {
    if (!line.includes('"deferred_tools_delta"')) continue;
    let a: unknown;
    try {
      a = (JSON.parse(line) as Json).attachment;
    } catch {
      continue;
    }
    if (!isObject(a) || a.type !== "deferred_tools_delta") continue;
    for (const n of [...strings(a.addedNames), ...strings(a.readdedNames)]) tools.add(n);
    for (const n of strings(a.removedNames)) tools.delete(n);
    last = a;
  }
  if (!last) return null;
  const mine = (n: string) => NAME.test(n) && n !== MCP_NAME && n !== OLD_MCP_NAME;
  const servers = [...new Set([...tools].flatMap((t) => /^mcp__(.+?)__/.exec(t)?.[1] ?? []))].filter(mine).sort();
  const failed = (Array.isArray(last.failedMcpServers) ? last.failedMcpServers : []).flatMap((f) => {
    if (!isObject(f) || typeof f.name !== "string" || !mine(f.name)) return [];
    return [{ name: f.name, code: typeof f.errorCode === "string" && CODE.test(f.errorCode) ? f.errorCode : null }];
  });
  return {
    servers: whole ? servers.slice(0, 40) : [],
    failed: failed.slice(0, 20),
    needsAuth: strings(last.needsAuthMcpServers).filter(mine).slice(0, 20),
    pending: strings(last.pendingMcpServers).filter(mine).slice(0, 20),
  };
}

const g = globalThis as unknown as { __pacedmindMcpWatch?: Map<string, string> };
/** Sessions whose MCP servers weren't all there when last looked at, with what the last mcp_status event said ("" for none). */
const watched = () => (g.__pacedmindMcpWatch ??= new Map());

/** How long after start_task a server still connecting then is looked at again. */
const CONNECTING_MS = 30_000;

/**
 * Records what `state` (sessionMcp) says the session is missing, as an mcp_status event, when that changed: a server
 * that waits for you to sign in or didn't start, and `later` one still connecting. Once everything's there after
 * something was missing, it says so. While something's missing or connecting, the session is looked at again: 30
 * seconds after it started for one still connecting, and whenever its turn ends (recheckSessionMcp), so signing in
 * through /mcp clears it.
 */
export async function noteSessionMcp(s: Session, state: SessionMcp | null, later: boolean) {
  if (!state) return;
  const problems: McpProblem[] = [
    ...state.needsAuth.map((name) => ({ name, why: "auth" as const })),
    ...state.failed.map((f) => ({ name: f.name, why: "failed" as const, code: f.code })),
    ...(later ? state.pending.map((name) => ({ name, why: "connecting" as const })) : []),
  ];
  const before = watched().get(s.id) ?? "";
  const text = mcpStatusText(AGENT_LABEL[s.agent], problems);
  if (problems.length) {
    if (text !== before) await repo.addSessionEvent(s.id, "mcp_status", text);
    watched().set(s.id, text);
  } else {
    if (before) await repo.addSessionEvent(s.id, "mcp_status", text);
    if (state.pending.length) watched().set(s.id, "");
    else watched().delete(s.id);
  }
  if (!later && state.pending.length) {
    setTimeout(() => void recheckSessionMcp(s.id).catch(() => {}), CONNECTING_MS).unref?.();
  }
}

/** Whether a session's MCP servers are looked at again when its turn ends. */
export const watchesMcp = (sessionId: string) => watched().has(sessionId);

/** Looks at a watched session's MCP servers again, from the end of its transcript (noteSessionMcp). */
export async function recheckSessionMcp(sessionId: string) {
  if (!watched().has(sessionId)) return;
  const s = await repo.getSession(sessionId);
  if (!s || !isLiveSession(s) || !s.folder || !s.cliSessionId) {
    watched().delete(sessionId);
    return;
  }
  await noteSessionMcp(s, sessionMcp(s.folder, s.cliSessionId, false), true);
}
