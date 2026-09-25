import "server-only";
import { changesProblemIn } from "./ops";
import * as repo from "./repo";
import { dateOnly, todayStr } from "@/lib/dates";
import type { SessionGroup, SessionItem, StartableTask } from "@/components/views/sessions";
import { agentOf, taskHref, type Report, type Session, type Status, type Task } from "@/lib/types";

const EARLIER_LIMIT = 30;
const active = (s: Session) => s.status === "starting" || s.status === "running";

/** Everything the Sessions screen shows, grouped the way it lists them. */
export async function sessionList(selected: string | null): Promise<{ groups: SessionGroup[]; initialId: string | null; startable: StartableTask[] }> {
  const [all, taskList, projectList, edges, done, deviceList] = await Promise.all([
    repo.listSessions(), repo.listTasks(), repo.listProjects(), repo.listEdges(), repo.doneTimes(), repo.listDevices(),
  ]);
  const tasks = new Map(taskList.map((t) => [t.id, t]));
  const projects = new Map(projectList.map((p) => [p.id, p]));
  const byId = new Map(all.map((s) => [s.id, s]));
  const devices = new Map(deviceList.map((d) => [d.id, d.name]));
  const busy = new Set(all.filter(active).map((s) => s.taskId));
  const today = todayStr();

  /** When a session stopped needing anything: marked done, or its terminal closed. */
  const endAt = (s: Session) =>
    s.status === "done"
      ? done.get(s.id) ?? s.endedAt ?? s.finishedAt ?? tasks.get(s.taskId)?.completedAt ?? s.startedAt
      : s.endedAt ?? s.finishedAt ?? s.startedAt;

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

  const shownIds = [...finished, ...running, ...endedToday, ...shownEarlier].map((s) => s.id);
  const [eventsOf, reports, pending] = await Promise.all([
    repo.sessionEventsFor(shownIds), repo.reportsForSessions(shownIds), repo.pendingImages(shownIds),
  ]);
  // Request changes goes on a task's newest report only.
  const newestOfTask = new Map<number, Report>();
  for (const list of reports.values()) {
    for (const r of list) if ((newestOfTask.get(r.taskId)?.id ?? 0) < r.id) newestOfTask.set(r.taskId, r);
  }

  const item = (s: Session): SessionItem => {
    const task = tasks.get(s.taskId);
    const project = task?.projectId ? projects.get(task.projectId) : undefined;
    const events = eventsOf[s.id] ?? [];
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
      surface: s.surface,
      device: s.deviceId ? devices.get(s.deviceId) ?? null : null,
      url: s.url,
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
        : events.some((e) => e.kind === "started" && /^Started outside (Organizer|PacedMind)$/.test(e.text)) ? "outside" : "organizer",
      continues: prev ? { id: prev.id, key: tasks.get(prev.taskId)?.key ?? "an earlier task" } : null,
      task: task ? { id: task.id, key: task.key, title: task.title } : null,
      project: project ? { id: project.id, name: project.name } : null,
      href: task ? taskHref(task) : null,
      events,
      reports: reports.get(s.id) ?? [],
      pending: pending.get(s.id) ?? [],
      canRequestChanges: (s.status === "finished" || s.status === "done")
        && !changesProblemIn(s, { task, live: busy.has(s.taskId), newest: newestOfTask.get(s.taskId) }),
      next: next
        ? {
          id: next.id, key: next.key, title: next.title, href: taskHref(next),
          canStart: (next.status === "todo" || next.status === "backlog") && !busy.has(next.id),
        }
        : null,
    };
  };

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
