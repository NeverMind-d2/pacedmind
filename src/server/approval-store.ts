import "server-only";
import type { AgentId, Surface } from "@/lib/types";

/*
 * Sessions waiting for you to allow them in this computer's PacedMind window (requests.ts decides what goes
 * in). A separate module, so that signing out anywhere (supabase.ts) can clear them without importing the
 * launcher.
 */

/** A session waiting for you, with what it would run as you saw it: launching refuses if any of it changed. */
export interface Approval {
  id: string;
  /** The launch request it answers, or null when it's this computer's own (an agent over MCP, a flow). */
  requestId: string | null;
  from: "elsewhere" | "agent" | "flow";
  taskId: number;
  key: string;
  agent: AgentId;
  folder: string;
  /** Where it would run: a terminal or the agent's app here, or the agent's cloud. */
  surface: Surface;
  /** For an agent asking to send a session back to work: the session and what should change. */
  changes?: { sessionId: string; text: string };
  requestedAt: number;
  expiresAt: number;
}

const g = globalThis as unknown as { __pacedmindApprovals?: Map<string, Approval>; __pacedmindHandled?: Set<string> };

export const approvals = () => (g.__pacedmindApprovals ??= new Map());

/** Launch requests this computer already decided: never acted on twice, whatever the cloud says later. */
export const handledRequests = () => (g.__pacedmindHandled ??= new Set());

export function clearApprovals() {
  approvals().clear();
}
