import "server-only";
import * as repo from "./repo";
import { deviceConfig } from "./device";
import { thisDeviceId } from "./devices";
import { usesCloud } from "./scope";
import { MODE } from "./supabase";
import { AGENT_LABEL, type AskKind, type Session, type SessionAsk } from "@/lib/types";

/*
 * What a running session's agent waits for you to answer, held by this computer (the desktop app): a tool Claude Code
 * wants permission for (its PermissionRequest hook, /api/sessions/[id]/permission) or a question (the ask_user tool).
 * It's kept as an ask (session_asks), shows on the task and in Sessions with a way to answer (AskCard), and notifies
 * you, through the session event it adds (the desktop app's notifications and web push, push.ts).
 *
 * You answer in this window (answerHere), or from the web app or another computer when this computer's "Answer from
 * elsewhere" is on (Settings): such an answer comes through the account's database, which takes it only with a
 * two-factor code from the last five minutes, and this computer checks its own setting again before it passes the
 * answer on. Nothing waits longer than the agent: a hold that runs out, or an agent that stops waiting, ends the ask.
 */

const g = globalThis as unknown as { __pacedmindAskWaiters?: Map<string, () => void> };
const waiters = () => (g.__pacedmindAskWaiters ??= new Map());

/** How often a hold looks for an answer given elsewhere. One given here wakes it at once. */
const POLL_MS = 2000;

/** A permission Claude Code asks for waits this long in PacedMind. Its terminal asks at the same time. */
export const PERMISSION_HOLD_MS = 10 * 60_000;
/** A question can be answered for this long; each ask_user call waits part of it. */
export const QUESTION_OPEN_MS = 30 * 60_000;
/**
 * One ask_user call waits this long: MCP clients give a tool call about a minute (Claude Code's "The operation timed
 * out"), and an answer that comes after the client gave up would reach nobody. The agent calls again to keep waiting.
 */
export const QUESTION_CALL_MS = 45_000;

const clip = (s: string, max = 280) => {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
};

/** A tool's name as the database keeps it: plain characters only. */
export const toolName = (name: unknown) => (typeof name === "string" ? name.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 100) : "") || "a tool";

/** What a tool call would do, in a line: the command, the file, the address; else its input, shortened. */
export function describeToolUse(tool: string, input: unknown): string {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const text = tool === "Bash" ? str(i.command)
    : ["Edit", "Write", "MultiEdit", "Read", "NotebookEdit"].includes(tool) ? str(i.file_path) || str(i.notebook_path)
      : tool === "WebFetch" ? str(i.url) : tool === "WebSearch" ? str(i.query) : "";
  const shown = text || JSON.stringify(i);
  return shown.length > 2000 ? `${shown.slice(0, 2000)}…` : shown || tool;
}

/** Whether this computer is the session's own: answers given here need no code. */
export async function askedHere(ask: SessionAsk): Promise<boolean> {
  if (MODE !== "desktop") return false;
  return (await usesCloud()) ? !!ask.deviceId && ask.deviceId === thisDeviceId() : true;
}

/** Whether an answer counts here: given on this computer, or from elsewhere while this computer takes those. */
const counts = (ask: SessionAsk) => ask.answeredVia !== "elsewhere" || !!deviceConfig().remoteAnswers;

/**
 * Records something a running session's agent waits for you to answer, open for `openMs`, and tells you: a
 * `permission` or `question` event, which the task, Sessions, notifications and web push show.
 */
export async function openAsk(session: Session, kind: AskKind, text: string, tool: string | null, openMs: number): Promise<SessionAsk> {
  const cloud = await usesCloud();
  const ask = await repo.createAsk({
    sessionId: session.id, deviceId: cloud ? session.deviceId : null, kind, tool, text: text.slice(0, 4000),
    remoteOk: cloud && !!deviceConfig().remoteAnswers, expiresAt: new Date(Date.now() + openMs).toISOString(),
  });
  const who = AGENT_LABEL[session.agent];
  await repo.addSessionEvent(
    session.id, kind,
    kind === "permission" ? `${who} asks for your permission to use ${tool}: ${clip(text)}` : `${who} asks you: ${clip(text)}`,
  );
  return ask;
}

/**
 * Waits up to `waitMs` for the answer to `ask`: woken at once by one given here, and looking every two seconds for one
 * given elsewhere. `signal`: the agent stopped waiting (its hook's request closed). Returns the answer, or null when
 * none came, it was withdrawn, or it came from elsewhere while this computer doesn't take those.
 */
export async function waitForAnswer(ask: SessionAsk, waitMs: number, signal?: AbortSignal): Promise<string | null> {
  const until = Math.min(Date.now() + waitMs, Date.parse(ask.expiresAt));
  for (;;) {
    const now = await repo.getAsk(ask.id);
    if (!now || now.status === "expired" || now.status === "withdrawn") return null;
    if (now.status === "answered") return counts(now) ? now.answer : null;
    if (Date.now() >= until || signal?.aborted) return null;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        if (waiters().get(ask.id) === done) waiters().delete(ask.id);
        resolve();
      };
      const timer = setTimeout(done, Math.max(0, Math.min(POLL_MS, until - Date.now())));
      waiters().set(ask.id, done);
      signal?.addEventListener("abort", done, { once: true });
    });
  }
}

const gh = globalThis as unknown as { __pacedmindHeld?: Map<string, Map<string, { tool: string; text: string }>> };
/** The permissions this computer holds for Claude Code right now, by session. */
const held = () => (gh.__pacedmindHeld ??= new Map());

/** Whether this computer holds a permission for the session now. */
export const holdsPermission = (sessionId: string) => !!held().get(sessionId)?.size;

/** Waits for the answer to a permission Claude Code asked for (waitForAnswer), known meanwhile as held (answeredInTerminal). */
export async function holdPermission(sessionId: string, ask: SessionAsk, waitMs: number, signal: AbortSignal): Promise<string | null> {
  const mine = held().get(sessionId) ?? new Map<string, { tool: string; text: string }>();
  held().set(sessionId, mine);
  mine.set(ask.id, { tool: ask.tool ?? "", text: ask.text });
  try {
    return await waitForAnswer(ask, waitMs, signal);
  } finally {
    mine.delete(ask.id);
    if (!mine.size) held().delete(sessionId);
  }
}

/**
 * Claude Code asks in its terminal while PacedMind holds its permission request, and doesn't cancel the request when
 * you answer there. What its hooks say next shows you did: the tool ran (`tool`, its name and input), you wrote to it,
 * or its turn ended. The permissions that answers stop waiting, so they leave your devices.
 */
export async function answeredInTerminal(sessionId: string, tool?: { name: unknown; input: unknown }) {
  const mine = held().get(sessionId);
  if (!mine) return;
  const name = tool ? toolName(tool.name) : "";
  for (const [id, h] of mine) {
    if (tool && (h.tool !== name || h.text !== describeToolUse(name, tool.input).slice(0, 4000))) continue;
    await repo.settleAsk(id, "withdrawn").catch(() => {});
    waiters().get(id)?.();
  }
}

/** Answers in this window, the session's own computer: the database takes it without a code, and the hold wakes. */
export async function answerHere(id: string, answer: string): Promise<SessionAsk> {
  const a = await repo.answerAsk(id, answer);
  waiters().get(id)?.();
  return a;
}

/** "Answer in the terminal": PacedMind stops asking, and the agent's own prompt, open all along, is the one left. */
export async function withdrawHere(id: string) {
  await repo.settleAsk(id, "withdrawn");
  waiters().get(id)?.();
}

/** What an answer did, for the session's history. */
export function answeredText(session: Session, kind: AskKind, answer: string): string {
  const who = AGENT_LABEL[session.agent];
  if (kind === "question") return `You answered in PacedMind, and ${who} went on: ${clip(answer)}`;
  return answer === "allow" ? `You allowed it in PacedMind, and ${who} went on` : `You refused it in PacedMind, and ${who} went on`;
}
