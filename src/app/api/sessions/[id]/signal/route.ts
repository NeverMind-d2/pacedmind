import { authorizeHook } from "@/server/auth";
import { HOOK_KINDS, recordSignal, type HookKind } from "@/server/signals";

const SESSION_ID = /^[0-9a-f]{16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** What these hooks send is small; a longer body is left unread, and so is what comes after each message and tool call. */
const MAX_BODY = 64 * 1024;

/**
 * Called by the hooks the launcher installs in a session's terminal (signals.ts), with that session's token:
 * `?kind=stop|notify|prompt|tool` from Claude Code, `turn` from Codex's notify, and `cli`, the Claude Code
 * conversation. The answer never has a body, whatever happens: what a UserPromptSubmit hook prints goes into the
 * agent's conversation. A token that doesn't work (any more) gets the same empty answer as one that does: after a
 * session hands its task back, its terminal's hooks keep calling, and an error would show in the agent's terminal.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as HookKind | null;
  const cli = url.searchParams.get("cli");
  const { id } = await ctx.params;
  if (!kind || !HOOK_KINDS.includes(kind) || !SESSION_ID.test(id) || (cli && !UUID.test(cli))) return new Response(null, { status: 400 });
  const who = await authorizeHook(req);
  if (!who || who.kind !== "session") return new Response(null, { status: 204 });
  let payload: Record<string, unknown> = {};
  if (kind === "stop" || kind === "notify" || kind === "turn") {
    const text = await req.text().catch(() => "");
    if (text.length <= MAX_BODY) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
      } catch {
        // Not JSON: the event goes without what the agent said.
      }
    }
  }
  try {
    await recordSignal({ sessionId: who.sessionId, hookedId: id, kind, cli, payload });
  } catch (e) {
    console.error("[organizer] session signal", e);
  }
  return new Response(null, { status: 204 });
}
