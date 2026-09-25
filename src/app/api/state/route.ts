import crypto from "node:crypto";
import * as repo from "@/server/repo";
import { MODE, authState } from "@/server/supabase";
import { nextStep } from "@/server/auth-flow";
import { approvalItems } from "@/server/requests";

export const dynamic = "force-dynamic";

/** Changes when this server process starts, so a restart also counts as "something changed". */
const boot = crypto.randomBytes(4).toString("hex");

/**
 * Polled by open pages (to refresh when an agent changed something over MCP) and by the desktop app (to
 * notify when a session finishes or waits to be allowed). `version` changes after any write to the
 * account's data, and when someone signs in, verifies a code or signs out. In the desktop app only its own
 * window and main process can ask (proxy.ts); in the web app, only a signed-in browser.
 */
export async function GET() {
  const noStore = { headers: { "Cache-Control": "no-store" } };
  const state = await authState();
  // Without an account, the desktop app shows this computer's own data; signing in counts as a change.
  const step = state || MODE === "web" ? nextStep(state) : null;
  if (step) return Response.json({ version: `${boot}-${step}`, waiting: [], approvals: [], signedIn: false }, noStore);
  const [version, finished, tasks] = await Promise.all([repo.stateVersion(), repo.listSessions({ status: ["finished"] }), repo.listTasks()]);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const briefs = await repo.reportBriefs(finished.map((s) => s.id));
  const waiting = finished.map((s) => {
    const task = byId.get(s.taskId);
    const report = briefs.get(s.id);
    return {
      id: s.id, key: task?.key ?? null, title: task?.title ?? null, note: s.note, finishedAt: s.finishedAt,
      outcome: report?.outcome ?? null, questions: report?.questions ?? 0,
    };
  });
  const approvals = MODE === "desktop" ? approvalItems(tasks) : [];
  const approvalKey = approvals.map((a) => a.id).join(",");
  return Response.json(
    {
      version: `${boot}-${state ? state.user.id.slice(0, 8) : "local"}-${version}-${crypto.createHash("sha1").update(approvalKey).digest("hex").slice(0, 8)}`,
      waiting,
      approvals: approvals.map((a) => ({ id: a.id, key: a.key, title: a.title, agent: a.agent, from: a.from })),
      signedIn: !!state,
    },
    noStore,
  );
}
