import "server-only";
import { cliCommand, thisDevice } from "./devices";
import { finishTask } from "./ops";
import * as repo from "./repo";
import { runCommand } from "./shell";
import { nowStamp } from "@/lib/dates";

/*
 * Cloud sessions can't reach PacedMind on this computer. Codex cloud can be asked, though: `codex cloud list --json`
 * says which tasks are ready. A ready task finishes its session here, as if the agent had reported it, so the flow
 * goes on. Claude Code on the web has no such list, so you mark those finished yourself.
 */

type CloudTask = { id?: string; url?: string; title?: string; status?: string; summary?: { files_changed?: number; lines_added?: number; lines_removed?: number } };

let busy = false;

/** Checks the running Codex cloud sessions once. Runs with the background tick. */
export async function checkCodexCloud() {
  const running = repo.listSessions("surface = 'cloud' AND agent = 'codex' AND status = 'running' AND url LIKE 'https://chatgpt.com/codex/tasks/%'");
  const device = thisDevice();
  if (busy || !running.length || !device.agents.codex.cli) return;
  busy = true;
  try {
    const out = await runCommand(`${cliCommand("codex", device)} cloud list --json --limit 20`, 60_000);
    let tasks: CloudTask[] = [];
    try {
      tasks = (JSON.parse(out ?? "{}") as { tasks?: CloudTask[] }).tasks ?? [];
    } catch {
      return;
    }
    for (const s of running) {
      const t = tasks.find((x) => x.url === s.url || (x.id && s.url?.endsWith(`/${x.id}`)));
      // Still running here, and not something someone else already settled.
      const now = repo.getSession(s.id);
      if (!t || now?.status !== "running") continue;
      if (t.status === "ready" || t.status === "applied") {
        const d = t.summary;
        const size = d?.files_changed ? `, +${d.lines_added ?? 0} −${d.lines_removed ?? 0} in ${d.files_changed} file${d.files_changed > 1 ? "s" : ""}` : "";
        finishTask(s.taskId, s.id, `Codex cloud finished${t.title ? `: ${t.title}` : ""}${size}`, "cloud");
      } else if (t.status === "error") {
        repo.updateSession(s.id, { status: "closed", endedAt: nowStamp(), note: "Codex cloud couldn't finish it" });
        repo.addSessionEvent(s.id, "closed", "Codex cloud couldn't finish it");
      }
    }
  } finally {
    busy = false;
  }
}
