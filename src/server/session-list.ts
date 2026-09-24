import "server-only";
import { db } from "./db";
import * as repo from "./repo";
import { dateOnly, todayStr } from "@/lib/dates";
import type { SessionGroup, SessionItem, StartableTask } from "@/components/views/sessions";
import { agentOf, type Session, type Status, type Task } from "@/lib/types";

const EARLIER_LIMIT = 30;
const active = (s: Session) => s.status === "starting" || s.status === "running";

/** Where a task opens in the app: its project, else its area, else the inbox. */
export function taskHref(t: Task): string {
  if (t.projectId) return `/project/${t.projectId}?task=${t.key}`;
  if (t.areaId) return `/area/${t.areaId}?task=${t.key}`;
  return `/inbox?task=${t.key}`;
}

/** When each session was marked done: its latest "done" event. */
function doneTimes(): Map<string, string> {
  const rows = db().prepare("SELECT session_id, MAX(at) AS at FROM session_events WHERE kind = 'done' GROUP BY session_id").all();
  return new Map(rows.map((r) => [String(r.session_id), String(r.at)]));
}

/** Everything the Sessions screen shows, grouped the way it lists them. */
export function sessionList(selected: string | null): { groups: SessionGroup[]; initialId: string | null; startable: StartableTask[] } {
  const all = repo.listSessions();
  const tasks = new Map(repo.listTasks().map((t) => [t.id, t]));
  const projects = new Map(repo.listProjects().map((p) => [p.id, p]));
  const edges = repo.listEdges();
  const done = doneTimes();
  const byId = new Map(all.map((s) => [s.id, s]));
  const busy = new Set(all.filter(active).map((s) => s.taskId));
  const today = todayStr();

  /** When a session stopped needing anything: marked done, or its terminal closed. */
  const endAt = (s: Session) =>
    s.status === "done"
      ? done.get(s.id) ?? s.endedAt ?? s.finishedAt ?? tasks.get(s.taskId)?.completedAt ?? s.startedAt
      : s.endedAt ?? s.finishedAt ?? s.startedAt;

  const item = (s: Session): SessionItem => {
    const task = tasks.get(s.taskId);
    const project = task?.projectId ? projects.get(task.projectId) : undefined;
    const events = repo.sessionEvents(s.id);
    const prev = s.continuesSessionId ? byId.get(s.continuesSessionId) : undefined;
    const next = task
      ? edges
        .filter((e) => e.fromTaskId === task.id)
        .map((e) => tasks.get(e.toTaskId))
        .filter((t): t is Task => !!t && t.status !== "done" && t.status !== "canceled")
        .sort((a, b) => a.sortOrder - b.sortOrder)[0]
      : undefined;
    return {
      id: s.id,
      status: s.status,
      agent: s.agent,
      folder: s.folder,
      branch: s.branch,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      endedAt: s.endedAt,
      endAt: active(s) || s.status === "finished" ? null : endAt(s),
      note: s.note,
      cliSessionId: s.cliSessionId,
      origin: s.continuesSessionId
        ? "continued"
        : events.some((e) => e.kind === "started" && e.text === "Started outside Organizer") ? "outside" : "organizer",
      continues: prev ? { id: prev.id, key: tasks.get(prev.taskId)?.key ?? "an earlier task" } : null,
      task: task ? { id: task.id, key: task.key, title: task.title } : null,
      project: project ? { id: project.id, name: project.name } : null,
      href: task ? taskHref(task) : null,
      events,
      next: next
        ? {
          id: next.id, key: next.key, title: next.title, href: taskHref(next),
          canStart: (next.status === "todo" || next.status === "backlog") && !busy.has(next.id),
        }
        : null,
    };
  };

  const finished = all.filter((s) => s.status === "finished")
    .sort((a, b) => (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt));
  const running = all.filter(active).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const ended = all.filter((s) => !active(s) && s.status !== "finished").sort((a, b) => endAt(b).localeCompare(endAt(a)));
  const endedToday = ended.filter((s) => dateOnly(endAt(s)) >= today);
  const earlier = ended.filter((s) => dateOnly(endAt(s)) < today);
  const shownEarlier = earlier.slice(0, EARLIER_LIMIT);
  // A link to an older session still opens it.
  const linked = selected ? earlier.slice(EARLIER_LIMIT).find((s) => s.id === selected) : undefined;
  if (linked) shownEarlier.push(linked);

  const groups: SessionGroup[] = (
    [
      { id: "finished", name: "Finished, waiting for you", items: finished.map(item) },
      { id: "running", name: "Running", items: running.map(item) },
      { id: "today", name: "Ended today", items: endedToday.map(item) },
      { id: "earlier", name: "Earlier", items: shownEarlier.map(item) },
    ] satisfies SessionGroup[]
  ).filter((g) => g.items.length);

  const shown = groups.flatMap((g) => g.items);
  const newest = [...shown].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const initialId = (selected && shown.some((s) => s.id === selected) ? selected : null)
    ?? finished[0]?.id ?? running[0]?.id ?? newest?.id ?? null;

  // Tasks an agent could pick up right now, for the "Start session" menu.
  const rank: Partial<Record<Status, number>> = { progress: 0, todo: 1, backlog: 2 };
  const startable = [...tasks.values()]
    .filter((t) => rank[t.status] !== undefined && !busy.has(t.id))
    .map((t) => ({ t, p: t.projectId ? projects.get(t.projectId) : undefined }))
    .filter(({ t, p }) => t.agent !== "human" && (t.agent || p?.agent))
    .sort((a, b) =>
      rank[a.t.status]! - rank[b.t.status]! || (a.t.priority || 5) - (b.t.priority || 5) ||
      (a.p?.sort ?? 999) - (b.p?.sort ?? 999) || a.t.sortOrder - b.t.sortOrder)
    .slice(0, 20)
    .map(({ t, p }) => ({ id: t.id, key: t.key, title: t.title, agent: agentOf(t, p?.agent) ?? "claude" }));

  return { groups, initialId, startable };
}
