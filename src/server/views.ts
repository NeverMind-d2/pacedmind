import "server-only";
import { trustCheck } from "./claude-trust";
import { deviceIdFor, runsHere, thisDeviceId } from "./devices";
import { plannedFolder, plannedSurface } from "./launcher";
import { changesProblemIn, changesViaIn } from "./ops";
import * as repo from "./repo";
import { usesCloud } from "./scope";
import { MODE } from "./supabase";
import { agentOf, isLiveSession, type Area, type Project, type Session, type Task, type TaskContext, type Usage } from "@/lib/types";

export async function taskContext(tasks: Task[]): Promise<TaskContext> {
  const ids = new Set(tasks.map((t) => t.id));
  const [all, areas, projects] = await Promise.all([repo.listSessions(), repo.listAreas(), repo.listProjects()]);
  const sessions: Record<number, Session> = {};
  for (const s of all) {
    if (ids.has(s.taskId) && !sessions[s.taskId]) sessions[s.taskId] = s;
  }
  const shown = Object.values(sessions).map((s) => s.id);
  const [sessionEvents, reports, pending] = await Promise.all([repo.sessionEventsFor(shown), repo.reportsForTasks([...ids]), repo.pendingImages(shown)]);
  const live = new Set(all.filter(isLiveSession).map((s) => s.taskId));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const changesOk: Record<string, boolean> = {};
  // Changes for a session that ran elsewhere go to its computer as a request (requestChangesRemoteAction).
  const changesVia: Record<string, string> = {};
  for (const s of Object.values(sessions)) {
    if (s.status !== "finished" && s.status !== "done") continue;
    const ctx = { task: byId.get(s.taskId), live: live.has(s.taskId), newest: reports.get(s.taskId)?.[0] };
    changesOk[s.id] = !changesProblemIn(s, ctx);
    const via = changesViaIn(s, ctx);
    if (via) changesVia[s.id] = via;
  }
  return {
    areas, projects, sessions, sessionEvents, reports: Object.fromEntries(reports), pending: Object.fromEntries(pending), changesOk, changesVia,
    desktop: MODE === "desktop", deviceId: MODE === "desktop" && (await usesCloud()) ? thisDeviceId() : null,
    asksTrust: MODE === "desktop" ? asksTrust(tasks, sessions, projects) : undefined,
  };
}

/**
 * Tasks whose Claude Code session on this computer opens in a folder Claude Code doesn't trust yet (claude-trust.ts):
 * the running one's, in a terminal, else where the next one would start, unless that's the Claude app, which asks
 * about the folder its own way.
 */
function asksTrust(tasks: Task[], sessions: Record<number, Session>, projects: Project[]): Record<number, boolean> {
  const asks = trustCheck();
  if (!asks) return {};
  const projectOf = new Map(projects.map((p) => [p.id, p]));
  const out: Record<number, boolean> = {};
  for (const t of tasks) {
    const s = sessions[t.id];
    const project = t.projectId ? projectOf.get(t.projectId) : undefined;
    let folder: string | null = null;
    if (s && isLiveSession(s)) {
      if (s.agent === "claude" && s.surface === "terminal" && runsHere(s.deviceId)) folder = s.folder;
    } else if (agentOf(t, project?.agent) === "claude" && runsHere(deviceIdFor(t.deviceId, project?.deviceId)) && plannedSurface(t, "claude") !== "desktop") {
      folder = plannedFolder(t);
    }
    if (folder && asks(folder)) out[t.id] = true;
  }
  return out;
}

export const isOpen = (t: Task) => t.status !== "done" && t.status !== "canceled";

export function usage(areas: Area[], projects: Project[], tasks: Task[]): Usage {
  const areaOf = new Map(projects.map((p) => [p.id, p.areaId]));
  const inArea = (t: Task, id: string) => t.areaId === id || (t.projectId !== null && areaOf.get(t.projectId) === id);
  return {
    areas: Object.fromEntries(areas.map((a) => {
      const ts = tasks.filter((t) => inArea(t, a.id));
      return [a.id, { projects: projects.filter((p) => p.areaId === a.id).length, tasks: ts.length, open: ts.filter(isOpen).length }];
    })),
    projects: Object.fromEntries(projects.map((p) => {
      const ts = tasks.filter((t) => t.projectId === p.id);
      const counted = ts.filter((t) => t.status !== "canceled");
      const done = counted.filter((t) => t.status === "done").length;
      return [p.id, { tasks: ts.length, open: ts.filter(isOpen).length, done, pct: counted.length ? Math.round((done / counted.length) * 100) : 0 }];
    })),
  };
}

const STATUS_ORDER = ["review", "progress", "todo", "backlog", "done", "canceled"] as const;
const STATUS_GROUP: Record<string, string> = {
  review: "In review", progress: "In progress", todo: "Todo", backlog: "Backlog", done: "Done", canceled: "Canceled",
};

/** Groups tasks by status in Linear's order, dropping empty groups. */
export function groupByStatus(tasks: Task[]) {
  return STATUS_ORDER.map((st) => ({
    id: st,
    name: STATUS_GROUP[st],
    tasks: tasks.filter((t) => t.status === st).sort((a, b) => (a.priority || 5) - (b.priority || 5) || a.sortOrder - b.sortOrder),
  })).filter((g) => g.tasks.length);
}
