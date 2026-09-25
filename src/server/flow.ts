import "server-only";
import * as repo from "./repo";
import { startSession, type LaunchResult } from "./launcher";
import { toDateTimeStr } from "@/lib/dates";
import type { FlowEdge, Task } from "@/lib/types";

/**
 * Whether a task is far enough for the tasks after it: done, or handed back for review. A hand-back
 * that was partial or blocked (`held`) waits until the user marks the task done.
 */
const ready = (source: Task, held: Set<number>) => source.status === "done" || (source.status === "review" && !held.has(source.id));

/** Whether a single connection lets its target start. */
function satisfied(edge: FlowEdge, source: Task | undefined, held: Set<number>, now = new Date()): boolean {
  if (!source) return true;
  switch (edge.mode) {
    case "manual":
      return source.status === "done";
    case "time":
      return ready(source, held) && !!edge.atTime && edge.atTime <= toDateTimeStr(now);
    default:
      return ready(source, held);
  }
}

function incoming(taskId: number, edges: FlowEdge[]) {
  return edges.filter((e) => e.toTaskId === taskId);
}

/** Starts the task's session if the flow allows it right now. */
function maybeStart(target: Task, { edges, tasks, held }: Snapshot): LaunchResult | null {
  if (target.status !== "todo" && target.status !== "backlog") return null;
  // Your own tasks can wait for others (a dependency on the timeline), but they never start a session.
  if (target.agent === "human") return null;
  const project = target.projectId ? repo.getProject(target.projectId) : null;
  if (!project?.flowOn) return null;
  const inc = incoming(target.id, edges);
  if (!inc.length || inc.some((e) => e.mode === "session")) return null;
  if (!inc.every((e) => satisfied(e, tasks.get(e.fromTaskId), held))) return null;
  if (repo.listSessions("task_id = ? AND status IN ('starting', 'running')", target.id).length) return null;
  return startSession(target.id);
}

function snapshot() {
  const edges = repo.listEdges();
  const tasks = new Map(repo.listTasks().map((t) => [t.id, t]));
  return { edges, tasks, held: repo.heldTaskIds() };
}

type Snapshot = ReturnType<typeof snapshot>;

/**
 * Called when an agent reports a task as finished. Returns the task to continue in the same
 * session (if a "same session" connection is ready) and any sessions started automatically.
 */
export function afterFinished(taskId: number): { continueWith: Task | null; started: LaunchResult[] } {
  const snap = snapshot();
  const { edges, tasks, held } = snap;
  let continueWith: Task | null = null;
  const started: LaunchResult[] = [];
  for (const e of edges.filter((x) => x.fromTaskId === taskId)) {
    const target = tasks.get(e.toTaskId);
    if (!target || (target.status !== "todo" && target.status !== "backlog")) continue;
    if (e.mode === "session") {
      const others = incoming(target.id, edges).filter((x) => x.id !== e.id);
      if (!continueWith && others.every((x) => satisfied(x, tasks.get(x.fromTaskId), held))) continueWith = target;
      continue;
    }
    const r = maybeStart(target, snap);
    if (r) started.push(r);
  }
  return { continueWith, started };
}

/** Called when you mark a task done: manual connections can now start their sessions. */
export function afterDone(taskId: number): LaunchResult[] {
  const snap = snapshot();
  const { edges, tasks } = snap;
  const started: LaunchResult[] = [];
  for (const e of edges.filter((x) => x.fromTaskId === taskId)) {
    const target = tasks.get(e.toTaskId);
    if (!target) continue;
    const r = maybeStart(target, snap);
    if (r) started.push(r);
  }
  const done = tasks.get(taskId);
  if (done?.projectId) started.push(...startNextProject(done.projectId, edges, tasks));
  return started;
}

/** When every task in a project's flow is done, start the projects that wait for it. */
function startNextProject(projectId: string, edges: FlowEdge[], tasks: Map<number, Task>): LaunchResult[] {
  const inFlow = [...tasks.values()].filter((t) => t.projectId === projectId && t.flowX !== null);
  if (!inFlow.length || inFlow.some((t) => t.status !== "done" && t.status !== "canceled")) return [];
  const out: LaunchResult[] = [];
  for (const p of repo.listProjects().filter((x) => x.afterProjectId === projectId && x.flowOn)) {
    const roots = [...tasks.values()].filter(
      (t) => t.projectId === p.id && t.flowX !== null && (t.status === "todo" || t.status === "backlog") && !incoming(t.id, edges).length,
    );
    for (const r of roots) out.push(startSession(r.id));
  }
  return out;
}

/** Runs every minute: starts sessions whose "at a set time" connection is due. */
export function tick() {
  const snap = snapshot();
  for (const e of snap.edges.filter((x) => x.mode === "time" && x.atTime && x.atTime <= toDateTimeStr(new Date()))) {
    const target = snap.tasks.get(e.toTaskId);
    if (target) maybeStart(target, snap);
  }
}

/** The next task in a project that is ready to be worked on. */
export function nextReadyTask(projectId: string): Task | null {
  const { edges, tasks, held } = snapshot();
  const open = [...tasks.values()]
    .filter((t) => t.projectId === projectId && (t.status === "todo" || t.status === "backlog"))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return open.find((t) => incoming(t.id, edges).every((e) => satisfied(e, tasks.get(e.fromTaskId), held))) ?? null;
}
