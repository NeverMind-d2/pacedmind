import crypto from "node:crypto";
import { db } from "@/server/db";
import * as repo from "@/server/repo";

export const dynamic = "force-dynamic";

/** Changes when this server process starts, so a restart also counts as "something changed". */
const boot = crypto.randomBytes(4).toString("hex");

/**
 * Polled by open pages (to refresh when an agent changed something over MCP) and by the desktop app
 * (to notify when a session finishes). `version` changes after any write to the database.
 */
export function GET() {
  const { changes } = db().prepare("SELECT total_changes() AS changes").get() as { changes: number };
  const waiting = repo.listSessions("status = 'finished'").map((s) => {
    const task = repo.getTask(s.taskId);
    return { id: s.id, key: task?.key ?? null, title: task?.title ?? null, note: s.note, finishedAt: s.finishedAt };
  });
  return Response.json({ version: `${boot}-${changes}`, waiting }, { headers: { "Cache-Control": "no-store" } });
}
