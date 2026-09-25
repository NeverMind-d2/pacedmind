import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Principal } from "../device";

/*
 * Who the current MCP request acts for (src/server/auth.ts decides): you, through your own Claude Code or
 * Codex (the owner token), or one session PacedMind started (its own token). The route runs each request
 * inside runAs, so tools can ask without passing it around.
 */

const store = new AsyncLocalStorage<Principal>();

export const runAs = <T>(who: Principal, fn: () => T): T => store.run(who, fn);

export function caller(): Principal {
  const who = store.getStore();
  if (!who) throw new Error("MCP tool called outside a request");
  return who;
}

/** The session a session token belongs to, or null for your own agents. */
export function callerSession(): { sessionId: string; taskId: number } | null {
  const who = caller();
  return who.kind === "session" ? { sessionId: who.sessionId, taskId: who.taskId } : null;
}
