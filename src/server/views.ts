import "server-only";
import { changesProblemIn } from "./ops";
import * as repo from "./repo";
import { MODE } from "./supabase";
import { isLiveSession, type Area, type Project, type Session, type Task, type TaskContext, type Usage } from "@/lib/types";

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
  const changesOk = Object.fromEntries(
    Object.values(sessions).filter((s) => s.status === "finished" || s.status === "done").map((s) => [
      s.id, !changesProblemIn(s, { task: byId.get(s.taskId), live: live.has(s.taskId), newest: reports.get(s.taskId)?.[0] }),
    ]),
  );
  return {
    areas, projects, sessions, sessionEvents, reports: Object.fromEntries(reports), pending: Object.fromEntries(pending), changesOk,
    desktop: MODE === "desktop",
  };
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
