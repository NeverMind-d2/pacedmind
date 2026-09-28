import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sessionIssue, type RuntimeObservation } from "@/lib/session-health";

type Json = Record<string, unknown>;
const object = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ROLLOUT = new RegExp(`^rollout-.+-(${UUID})\\.jsonl$`);
const SPAN = 512 * 1024;

function lines(text: string): Json[] {
  return text.split("\n").flatMap((line) => {
    try { const value: unknown = JSON.parse(line); return object(value) ? [value] : []; } catch { return []; }
  });
}

/** Bounded reads, no symlinks or paths taken from a session row. Incomplete lines wait for the next poll. */
function readEnd(file: string, tail: boolean): Json[] {
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile()) return [];
      const size = stat.size;
      const start = tail ? Math.max(0, size - SPAN) : 0;
      const buf = Buffer.alloc(Math.min(SPAN, size));
      const n = fs.readSync(fd, buf, 0, buf.length, start);
      let text = buf.toString("utf8", 0, n);
      if (start) text = text.slice(text.indexOf("\n") + 1);
      text = text.slice(0, text.lastIndexOf("\n") + 1);
      return lines(text);
    } finally { fs.closeSync(fd); }
  } catch { return []; }
}

/** The last lifecycle signal, not arbitrary error-looking words in messages, prompts or tool output. */
export function codexObservation(records: Json[], cli: string): RuntimeObservation | null {
  let latest: RuntimeObservation | null = null;
  for (const row of records) {
    if (row.type !== "event_msg" || !object(row.payload)) continue;
    const p = row.payload;
    if (typeof p.thread_id === "string" && p.thread_id !== cli) continue;
    const at = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : NaN;
    if (!Number.isFinite(at)) continue;
    let kind: RuntimeObservation["kind"];
    if (p.type === "task_started") kind = "working";
    else if (p.type === "task_complete") {
      kind = object(p.error) ? sessionIssue(p.error.codex_error_info, p.error.message) : p.error ? "error" : "waiting";
    } else if (p.type === "turn_aborted") kind = "waiting";
    else continue;
    if (!latest || latest.at <= at) latest = { at, kind };
  }
  return latest;
}

interface Target { id: string; cliSessionId: string | null; since: number }
interface Found { cli: string; observation: RuntimeObservation | null }

/**
 * Resolve only PacedMind's live Codex sessions. Before hooks are trusted, associate the launch's exact kickoff
 * message with its local rollout. Never resume or take control of the conversation to inspect it.
 */
export function readCodexRuntime(targets: Target[]): Map<string, Found> {
  const out = new Map<string, Found>();
  if (!targets.length) return out;
  const known = new Map(targets.filter((s) => s.cliSessionId).map((s) => [s.cliSessionId, s]));
  const unknown = new Map(targets.filter((s) => !s.cliSessionId).map((s) => [s.id, s]));
  const earliest = Math.min(...targets.map((s) => s.since));
  const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions");
  // Directory and file names only until a known conversation or a recent candidate matches.
  let remaining = 20_000;
  let candidates = 32;
  const visit = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => b.name.localeCompare(a.name))) {
      if (--remaining < 0) return;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && depth > 0) { visit(file, depth - 1); continue; }
      if (!entry.isFile()) continue;
      const cli = ROLLOUT.exec(entry.name)?.[1];
      if (!cli) continue;
      let target = known.get(cli);
      if (!target) {
        if (!unknown.size) continue;
        try { if (fs.statSync(file).mtimeMs < earliest) continue; } catch { continue; }
        if (--candidates < 0) continue;
        const head = readEnd(file, false);
        const meta = head.find((row) => row.type === "session_meta")?.payload;
        if (!object(meta) || meta.id !== cli || meta.source !== "cli") continue;
        for (const row of head) {
          const p = row.payload;
          if (row.type !== "response_item" || !object(p) || p.type !== "message" || p.role !== "user" || !Array.isArray(p.content)) continue;
          for (const c of p.content) {
            if (!object(c) || c.type !== "input_text" || typeof c.text !== "string") continue;
            const match = /^PacedMind task [A-Z][A-Z0-9]{1,7}-\d+, session ([0-9a-f]{16})[.:] /.exec(c.text);
            const candidate = match ? unknown.get(match[1]) : undefined;
            const at = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : NaN;
            if (candidate && at >= candidate.since) target = candidate;
          }
        }
      }
      if (!target) continue;
      const found = { cli, observation: codexObservation(readEnd(file, true), cli) };
      // An ambiguous kickoff must not bind to the wrong conversation.
      if (out.has(target.id)) { out.set(target.id, { cli: "", observation: null }); continue; }
      out.set(target.id, found);
    }
  };
  visit(root, 3);
  return out;
}
