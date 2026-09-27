import { authorizeHook } from "@/server/auth";
import { PERMISSION_HOLD_MS, answeredText, describeToolUse, holdPermission, openAsk, toolName } from "@/server/asks";
import { deviceConfig } from "@/server/device";
import * as repo from "@/server/repo";
import { hookSession } from "@/server/signals";

const SESSION_ID = /^[0-9a-f]{16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_BODY = 256 * 1024;

/** No decision: Claude Code asks in the terminal as it would without PacedMind. */
const noDecision = () => new Response(null, { status: 204 });

/**
 * Claude Code's PermissionRequest hook, which the launcher installs when this computer's "Answer from elsewhere" is on,
 * with the session's token. PacedMind holds the request up to ten minutes (asks.ts): the permission shows on the task,
 * in Sessions and as a notification on your devices, and what you answer there goes back as the hook's decision.
 * Claude Code shows its own prompt in the terminal meanwhile, and the first answer counts: one given in the terminal
 * ends the hold through the hooks that follow it (answeredInTerminal). Without an answer, the hook decides nothing.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const cli = new URL(req.url).searchParams.get("cli");
  const { id } = await ctx.params;
  if (!SESSION_ID.test(id) || (cli && !UUID.test(cli))) return noDecision();
  const who = await authorizeHook(req);
  // Switched off since the session started: back to the terminal.
  if (!who || who.kind !== "session" || !deviceConfig().remoteAnswers) return noDecision();
  const text = await req.text().catch(() => "");
  let input: { tool_name?: unknown; tool_input?: unknown } = {};
  try {
    if (text.length <= MAX_BODY) input = JSON.parse(text);
  } catch {
    // Nothing to show without the tool: the terminal asks.
  }
  if (!input || typeof input !== "object" || typeof input.tool_name !== "string") return noDecision();
  const s = await hookSession(who.sessionId, id, cli);
  if (!s) return noDecision();
  const tool = toolName(input.tool_name);
  const ask = await openAsk(s, "permission", describeToolUse(tool, input.tool_input), tool, PERMISSION_HOLD_MS);
  const answer = await holdPermission(s.id, ask, PERMISSION_HOLD_MS - 5_000, req.signal);
  if (answer !== "allow" && answer !== "deny") {
    await repo.settleAsk(ask.id, req.signal.aborted ? "withdrawn" : "expired").catch(() => {});
    return noDecision();
  }
  await repo.addSessionEvent(s.id, "working", answeredText(s, "permission", answer));
  return Response.json({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: answer === "allow" ? { behavior: "allow" } : { behavior: "deny", message: "The user refused this in PacedMind." },
    },
  });
}
