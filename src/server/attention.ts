import "server-only";
import { isAttention, isNeutralEvent, type AttentionKind } from "@/lib/dates";

/*
 * What each session waits for you about, as its latest event says (attentionOf in dates.ts), kept in memory so the
 * hook that runs after every tool call in a session's terminal (signals.ts) answers without reading the store.
 * Every session event goes through repo.addSessionEvent, which notes its kind here. A session this process hasn't
 * seen yet isn't in the map: signals.ts reads its events once.
 */

const g = globalThis as unknown as { __pacedmindAttention?: Map<string, AttentionKind | null> };

const known = () => (g.__pacedmindAttention ??= new Map());

/** The session's attention as this process knows it: undefined when it hasn't seen the session yet. */
export const knownAttention = (sessionId: string): AttentionKind | null | undefined => known().get(sessionId);

/** Records a session's latest event, or what its events say after reading them (null: nothing to wait for). */
export function noteSessionEvent(sessionId: string, kind: string | null) {
  if (kind && isNeutralEvent(kind)) return;
  known().set(sessionId, kind && isAttention(kind) ? kind : null);
}
