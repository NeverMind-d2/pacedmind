import "server-only";
import * as repo from "./repo";
import { knownAttention, noteSessionEvent } from "./attention";
import { attentionOf, type AttentionKind } from "@/lib/dates";
import { AGENT_LABEL, isLiveSession, type Session } from "@/lib/types";

/*
 * What the hooks the launcher installs in a session's terminal say (the signal route), and what its agent does over
 * MCP, turned into the session's events: its turn ended and it waits for you, it asks for your permission or for an
 * answer, or it went back to work. Claude Code runs a hook when its turn ends (Stop), when it shows a notification
 * (Notification), when you send it a message (UserPromptSubmit) and after every tool call (PostToolUse); Codex runs
 * its `notify` program when a turn ends. Pages show them and the desktop app notifies you (/api/state, attentionOf).
 *
 * The hooks after every message and tool call only matter while the session waits for you, so they're answered from
 * memory (attention.ts) without reading the store.
 */

export const HOOK_KINDS = ["stop", "notify", "prompt", "tool", "turn"] as const;
export type HookKind = (typeof HOOK_KINDS)[number];

/** At most this many events from hooks per session while this process runs, so a runaway loop can't fill its history. */
const LIMIT = 300;
const g = globalThis as unknown as { __pacedmindSignals?: Map<string, number> };
const counts = () => (g.__pacedmindSignals ??= new Map());

/** What the agent said, on one line and short enough for a notification. */
function said(v: unknown, max = 280): string {
  if (typeof v !== "string") return "";
  const line = v.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
}

async function attentionNow(sessionId: string): Promise<AttentionKind | null> {
  const known = knownAttention(sessionId);
  if (known !== undefined) return known;
  const now = attentionOf(await repo.sessionEvents(sessionId))?.kind ?? null;
  noteSessionEvent(sessionId, now);
  return now;
}

/** Whether `hookedId` (the session the hook was written for) is `s` or one it continues in the same terminal. */
async function sameTerminal(s: Session, hookedId: string): Promise<boolean> {
  let at: Session | null = s;
  for (let i = 0; at && i < 50; i++) {
    if (at.id === hookedId) return true;
    at = at.continuesSessionId ? await repo.getSession(at.continuesSessionId) : null;
  }
  return false;
}

/** The event a hook adds, given what the session waits for now; null for none. `who` names the agent. */
function eventFor(kind: HookKind, p: Record<string, unknown>, now: AttentionKind | null, who: string): { kind: string; text: string } | null {
  const quote = (v: unknown) => (said(v) ? `: “${said(v)}”` : "");
  const plain = (v: unknown) => (said(v) ? `: ${said(v)}` : "");
  switch (kind) {
    case "stop":
    case "turn": {
      // A question or an answer it asked for says more than "its turn ended"; a permission it was refused doesn't.
      if (now && now !== "permission") return null;
      return { kind: "waiting", text: `${who} is waiting for you in its terminal${quote(kind === "stop" ? p.last_assistant_message : p["last-assistant-message"])}` };
    }
    case "notify": {
      const type = p.notification_type;
      if (type === "permission_prompt") {
        return now === "permission" ? null : { kind: "permission", text: `${who} asks for your permission in its terminal${plain(p.message)}` };
      }
      if (type === "elicitation_dialog" || type === "agent_needs_input") {
        return now === "input" ? null : { kind: "input", text: `${who} asks you something in its terminal${plain(p.message)}` };
      }
      // Idle a minute after its turn ended: the Stop hook usually said so already.
      if (type === "idle_prompt") return now ? null : { kind: "waiting", text: `${who} is waiting for you in its terminal` };
      return null;
    }
    case "prompt":
      return now ? { kind: "working", text: `You answered in its terminal, and ${who} went on` } : null;
    case "tool":
      return now === "permission" ? { kind: "working", text: `You allowed it in its terminal, and ${who} went on` } : null;
  }
}

/**
 * Records what a hook said. `sessionId` is the session the hook's token works for now (it moves along "same session"
 * connections), `hookedId` the one the hook was written for, and `cli` the Claude Code conversation it runs in:
 * a terminal still open on an older conversation of the session says nothing about it.
 */
export async function recordSignal(o: { sessionId: string; hookedId: string; kind: HookKind; cli: string | null; payload: Record<string, unknown> }) {
  if (o.kind === "tool" || o.kind === "prompt") {
    const now = await attentionNow(o.sessionId);
    if (!now || (o.kind === "tool" && now !== "permission")) return;
  }
  const s = await repo.getSession(o.sessionId);
  if (!s || !isLiveSession(s)) return;
  if (o.cli && s.cliSessionId && o.cli !== s.cliSessionId) return;
  if (!(await sameTerminal(s, o.hookedId))) return;
  const e = eventFor(o.kind, o.payload, await attentionNow(s.id), AGENT_LABEL[s.agent]);
  if (!e) return;
  const n = counts().get(s.id) ?? 0;
  if (n >= LIMIT) return;
  counts().set(s.id, n + 1);
  await repo.addSessionEvent(s.id, e.kind, e.text.slice(0, 2000));
}

/** How MCP clients name themselves, as people know them. */
const CLIENTS: Record<string, string> = { "claude-code": "Claude Code", "codex-mcp-client": "Codex", codex: "Codex" };

/**
 * A session's agent connected to PacedMind's MCP server as `name` `version` (its MCP initialize request): the session
 * records it once per client and version while this process runs, so you see what it runs in.
 */
export async function noteClient(sessionId: string, name: unknown, version: unknown) {
  const plain = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[^\w .+()-]/g, "").trim().slice(0, max) : "");
  const who = CLIENTS[plain(name, 60)] ?? plain(name, 60);
  if (!who) return;
  const text = `Connected from ${who}${plain(version, 40) ? ` ${plain(version, 40)}` : ""}`;
  const key = `${sessionId}:${text}`;
  if (seen().has(key)) return;
  seen().add(key);
  await repo.addSessionEvent(sessionId, "connected", text);
}

const gs = globalThis as unknown as { __pacedmindClients?: Set<string> };
const seen = () => (gs.__pacedmindClients ??= new Set());

/**
 * A session's agent called PacedMind, so it's working, whatever it waited for before. For Codex this is how
 * PacedMind hears it went on: it has no hook for your messages.
 */
export async function noteAgentActivity(sessionId: string) {
  if (!(await attentionNow(sessionId))) return;
  const s = await repo.getSession(sessionId);
  if (s && isLiveSession(s)) await repo.addSessionEvent(sessionId, "working", `${AGENT_LABEL[s.agent]} went on`);
}
