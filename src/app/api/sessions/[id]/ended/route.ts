import * as repo from "@/server/repo";
import { authorized } from "@/server/auth";
import { nowStamp } from "@/lib/dates";

/** Called by the SessionEnd hook when the agent's terminal session closes. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const first = repo.getSession(id);
  if (!first) return Response.json({ ok: false, error: "Unknown session" }, { status: 404 });

  // A terminal can carry a chain of "same session" tasks; close every one still open.
  const chain = [first];
  for (let i = 0; i < chain.length; i++) {
    chain.push(...repo.listSessions("continues_session_id = ?", chain[i].id));
  }
  for (const s of chain) {
    if (s.status === "starting" || s.status === "running") {
      repo.updateSession(s.id, { status: "closed", endedAt: nowStamp() });
      repo.addSessionEvent(s.id, "closed", "Terminal closed before the agent finished");
    } else if (!s.endedAt) {
      repo.updateSession(s.id, { endedAt: nowStamp() });
      repo.addSessionEvent(s.id, "closed", "Terminal closed");
    }
  }
  return Response.json({ ok: true });
}
