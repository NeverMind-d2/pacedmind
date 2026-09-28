import { attentionOf, checkedIn, isNeutralEvent, parseLocal, type AttentionKind } from "./dates";
import { AGENT_LABEL, APP_LABEL, type AgentId } from "./types";

export type SessionIssue = "capacity" | "limit" | "locked" | "error";
export type HealthEvent = { kind: AttentionKind | "working"; text: string };

export const desktopStartText = (agent: AgentId) => `Send the prepared first message in the ${APP_LABEL[agent]}: press Enter or select Send. Complete any setup prompts shown there. PacedMind is waiting for the agent to check in.`;

/** Only classify structured failures from the CLI, never text in a conversation or a tool result. */
export function sessionIssue(code: unknown, message: unknown): SessionIssue {
  const c = typeof code === "string" ? code.toLowerCase().replace(/[_-]/g, "") : "";
  const m = typeof message === "string" ? message.toLowerCase() : "";
  if (/^(serveroverloaded|modelcapacity|overloaded|overloadederror)$/.test(c) || /selected model is at capacity|server is overloaded/.test(m)) return "capacity";
  if (/ratelimit|usagelimit|billing|quotaexceeded/.test(c)) return "limit";
  if (/threadlocked|conversationlocked|threadinuse/.test(c) || /conversation is open in another app/.test(m)) return "locked";
  return "error";
}

/** Fixed messages only: API errors can contain paths, credentials or request contents. */
export function issueEvent(agent: AgentId, issue: SessionIssue): HealthEvent {
  const who = AGENT_LABEL[agent];
  if (issue === "capacity") return { kind: "capacity", text: `${who}'s selected model is at capacity. In its existing terminal, use /model to choose another available model, then retry, or wait and retry later.` };
  if (issue === "limit") return { kind: "limit", text: `${who} stopped at a usage or billing limit. Check its existing terminal for the reset time or account action, then retry.` };
  if (issue === "locked") return { kind: "locked", text: `${who}'s conversation is open elsewhere. Close the other view of this conversation, then retry in its existing terminal.` };
  return { kind: "error", text: `${who} stopped on an error. Check its existing terminal, resolve the error, then retry.` };
}

type Event = { kind: string; text: string; at: string };
export const STARTUP_EVENTS = new Set(["started", "opened", "resumed", "changes_requested"]);

/** A reopen starts a new wait too; an earlier check-in must not hide its setup prompts. */
export function startupSince(startedAt: string, events: Event[]): number {
  return parseLocal(events.findLast((e) => STARTUP_EVENTS.has(e.kind))?.at ?? startedAt).getTime();
}

export function startupEvent(agent: AgentId, startedAt: string, events: Event[], now: number): HealthEvent | null {
  const since = Math.max(startupSince(startedAt, events), parseLocal(events.findLast((e) => e.kind === "working")?.at ?? startedAt).getTime());
  if (!Number.isFinite(since) || now - since < 90_000 || checkedIn(events) || attentionOf(events)) return null;
  // Only one reminder per launch attempt, even if a hook briefly clears it before check-in.
  const back = events.findLastIndex((e) => STARTUP_EVENTS.has(e.kind));
  if (events.slice(back + 1).some((e) => e.kind === "setup")) return null;
  return { kind: "setup", text: `${AGENT_LABEL[agent]} hasn't checked in. Check its existing terminal for sign-in, folder trust, hook review or another startup choice. Complete any prompt shown there. If setup is complete, ask it to call PacedMind's start_task. If the conversation is open elsewhere, close the other view and retry here.` };
}

export interface RuntimeObservation { at: number; kind: "working" | "waiting" | SessionIssue }

/** Ignore an older attempt or an observation superseded by a hook/MCP call; specific failures beat a generic wait. */
export function runtimeEvent(agent: AgentId, startedAt: string, events: Event[], observation: RuntimeObservation): HealthEvent | null {
  if (observation.at < startupSince(startedAt, events) || !Number.isFinite(observation.at)) return null;
  const last = events.findLast((e) => !isNeutralEvent(e.kind));
  const failure = observation.kind !== "working" && observation.kind !== "waiting";
  const genericWait = last?.kind === "setup" || (last?.kind === "waiting" && parseLocal(last.at).getTime() <= observation.at + 5_000);
  if (failure && genericWait && events.some((e) => ["working", "picked_up", "progress", "question", "permission", "input"].includes(e.kind) && parseLocal(e.at).getTime() > observation.at)) return null;
  if (last && parseLocal(last.at).getTime() > observation.at && !(failure && genericWait)) return null;
  const attention = attentionOf(events);
  if (observation.kind === "working") {
    return attention ? { kind: "working", text: `${AGENT_LABEL[agent]} started another turn` } : null;
  }
  if (observation.kind === "waiting") {
    return attention ? null : { kind: "waiting", text: `${AGENT_LABEL[agent]} is waiting for you in its terminal` };
  }
  return attention?.kind === observation.kind ? null : issueEvent(agent, observation.kind);
}
