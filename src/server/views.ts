import "server-only";
import * as repo from "./repo";
import type { Session, SessionEvent, Task, TaskContext } from "@/lib/types";

export function taskContext(tasks: Task[]): TaskContext {
  const ids = new Set(tasks.map((t) => t.id));
  const sessions: Record<number, Session> = {};
  for (const s of repo.listSessions()) {
    if (ids.has(s.taskId) && !sessions[s.taskId]) sessions[s.taskId] = s;
  }
  const sessionEvents: Record<string, SessionEvent[]> = {};
  for (const s of Object.values(sessions)) sessionEvents[s.id] = repo.sessionEvents(s.id);
  return { areas: repo.listAreas(), projects: repo.listProjects(), sessions, sessionEvents };
}

export const isOpen = (t: Task) => t.status !== "done" && t.status !== "canceled";

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
