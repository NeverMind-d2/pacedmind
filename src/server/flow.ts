import "server-only";
import * as repo from "./repo";
import { startSession, type LaunchResult } from "./launcher";
import { confirmedFlow } from "./device";
import { askFromFlow } from "./requests";
import { toDateTimeStr } from "@/lib/dates";
import { LIVE_STATUSES, type FlowEdge, type Status, type Task } from "@/lib/types";

/*
 * Which session starts after which. Flows only ever start sessions in the desktop app, and only for projects
 * whose flow you switched on on this computer (Project.flowOn comes from device.ts, not from the cloud).
 * Even then they only start by themselves along connections you confirmed here: the ones the flow had when
 * you switched it on, or that you drew in this window since. A connection added elsewhere (by an agent,
 * in the web app, on another computer) turns the start into a request you allow in the app.
 */

/** Whether every one of these connections was confirmed on this computer for the target's project. */
function confirmed(projectId: string | null, inc: FlowEdge[]): boolean {
  const c = confirmedFlow(projectId);
  return !!c && inc.every((e) => c.edges.includes(repo.edgeSignature(e)));
}

const READY = new Set(["review", "done"]);

/** Whether a single connection lets its target start. */
function satisfied(edge: FlowEdge, source: Task | undefined, now = new Date()): boolean {
  if (!source) return true;
  switch (edge.mode) {
    case "manual":
      return source.status === "done";
    case "time":
      return READY.has(source.status) && !!edge.atTime && edge.atTime <= toDateTimeStr(now);
    default:
      return READY.has(source.status);
  }
}

function incoming(taskId: number, edges: FlowEdge[]) {
  return edges.filter((e) => e.toTaskId === taskId);
}

/** Starts the task's session if the flow allows it right now. */
async function maybeStart(target: Task, edges: FlowEdge[], tasks: Map<number, Task>): Promise<LaunchResult | null> {
  if (target.status !== "todo" && target.status !== "backlog") return null;
  // Your own tasks can wait for others (a dependency on the timeline), but they never start a session.
  if (target.agent === "human") return null;
  const project = target.projectId ? await repo.getProject(target.projectId) : null;
  if (!project?.flowOn) return null;
  const inc = incoming(target.id, edges);
  if (!inc.length || inc.some((e) => e.mode === "session")) return null;
  if (!inc.every((e) => satisfied(e, tasks.get(e.fromTaskId)))) return null;
  if ((await repo.listSessions({ taskId: target.id, status: LIVE_STATUSES })).length) return null;
  if (!confirmed(target.projectId, inc)) {
    await askFromFlow(target);
    return null;
  }
  return startSession(target.id, { reason: "flow" });
}

async function snapshot() {
  const [edges, list] = await Promise.all([repo.listEdges(), repo.listTasks()]);
  return { edges, tasks: new Map(list.map((t) => [t.id, t])) };
}

/**
 * Called when an agent reports a task as finished. Returns the task to continue in the same
 * session (if a "same session" connection is ready) and any sessions started automatically.
 */
export async function afterFinished(taskId: number): Promise<{ continueWith: Task | null; started: LaunchResult[] }> {
  const { edges, tasks } = await snapshot();
  let continueWith: Task | null = null;
  const started: LaunchResult[] = [];
  for (const e of edges.filter((x) => x.fromTaskId === taskId)) {
    const target = tasks.get(e.toTaskId);
    if (!target || (target.status !== "todo" && target.status !== "backlog")) continue;
    if (e.mode === "session") {
      // The same terminal takes the next task only along a confirmed connection of a flow that's on, and
      // never for a task that is yours.
      const project = target.projectId ? await repo.getProject(target.projectId) : null;
      if (target.agent === "human" || !project?.flowOn || !confirmed(target.projectId, [e])) continue;
      const others = incoming(target.id, edges).filter((x) => x.id !== e.id);
      if (!continueWith && others.every((x) => satisfied(x, tasks.get(x.fromTaskId)))) continueWith = target;
      continue;
    }
    const r = await maybeStart(target, edges, tasks);
    if (r) started.push(r);
  }
  return { continueWith, started };
}

/** Called when you mark a task done: manual connections can now start their sessions. */
export async function afterDone(taskId: number): Promise<LaunchResult[]> {
  const { edges, tasks } = await snapshot();
  const started: LaunchResult[] = [];
  for (const e of edges.filter((x) => x.fromTaskId === taskId)) {
    const target = tasks.get(e.toTaskId);
    if (!target) continue;
    const r = await maybeStart(target, edges, tasks);
    if (r) started.push(r);
  }
  const done = tasks.get(taskId);
  if (done?.projectId) started.push(...(await startNextProject(done.projectId, edges, tasks)));
  return started;
}

/** When every task in a project's flow is done, start the projects that wait for it. */
async function startNextProject(projectId: string, edges: FlowEdge[], tasks: Map<number, Task>): Promise<LaunchResult[]> {
  const inFlow = [...tasks.values()].filter((t) => t.projectId === projectId && t.flowX !== null);
  if (!inFlow.length || inFlow.some((t) => t.status !== "done" && t.status !== "canceled")) return [];
  const out: LaunchResult[] = [];
  for (const p of (await repo.listProjects()).filter((x) => x.afterProjectId === projectId && x.flowOn)) {
    const roots = [...tasks.values()].filter(
      (t) => t.projectId === p.id && t.flowX !== null && (t.status === "todo" || t.status === "backlog") && t.agent !== "human"
        && !incoming(t.id, edges).length,
    );
    // "Starts after" counts only as you confirmed it here.
    const sure = confirmedFlow(p.id)?.after === projectId;
    for (const r of roots) {
      if (sure) out.push(await startSession(r.id, { reason: "flow" }));
      else await askFromFlow(r);
    }
  }
  return out;
}

/** Runs every minute: starts sessions whose "at a set time" connection is due. */
export async function tick() {
  const { edges, tasks } = await snapshot();
  for (const e of edges.filter((x) => x.mode === "time" && x.atTime && x.atTime <= toDateTimeStr(new Date()))) {
    const target = tasks.get(e.toTaskId);
    if (target) await maybeStart(target, edges, tasks);
  }
}

const g = globalThis as unknown as { __pacedmindStatuses?: Map<number, Status>; __pacedmindVersion?: number };

/**
 * Tasks can be finished or marked done elsewhere too: in the web app, on another computer or by an agent. The
 * desktop app compares task statuses every few seconds (when the account changed at all) and lets the flows
 * react as if it had happened here. Starting twice is harmless: a task with a live session doesn't start again.
 */
export async function watchStatuses() {
  const version = await repo.stateVersion();
  if (g.__pacedmindVersion === version) return;
  g.__pacedmindVersion = version;
  const now = await repo.taskStatuses();
  const before = g.__pacedmindStatuses;
  g.__pacedmindStatuses = now;
  if (!before) return;
  for (const [id, status] of now) {
    const was = before.get(id);
    if (!was || was === status) continue;
    if (status === "review") await afterFinished(id);
    else if (status === "done") await afterDone(id);
  }
}

/** The next task in a project that is ready to be worked on. */
export async function nextReadyTask(projectId: string): Promise<Task | null> {
  const { edges, tasks } = await snapshot();
  const open = [...tasks.values()]
    .filter((t) => t.projectId === projectId && (t.status === "todo" || t.status === "backlog"))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return open.find((t) => incoming(t.id, edges).every((e) => satisfied(e, tasks.get(e.fromTaskId)))) ?? null;
}
