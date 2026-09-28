import "server-only";
import * as repo from "./repo";
import { plannedFolder, plannedSurface, startSession, type LaunchResult } from "./launcher";
import { areaFolder, confirmedFlow } from "./device";
import { toolsHere } from "./devices";
import { missingFrom } from "@/lib/needs";
import { askFromFlow } from "./requests";
import { toDateTimeStr } from "@/lib/dates";
import { LIVE_STATUSES, agentOf, type AgentId, type FlowEdge, type Project, type Status, type Task } from "@/lib/types";

/** An area changed from elsewhere must not redirect an unattended flow into a different local workspace. */
function workspaceConfirmed(task: Task, project: Project | null): boolean {
  return !!task.folder || !!project?.folder || !areaFolder(task.areaId)
    || (!!project && confirmedFlow(project.id)?.areaId === task.areaId);
}

/*
 * Which session starts after which. Flows only ever start sessions in the desktop app, and only for projects
 * whose flow you switched on on this computer (Project.flowOn comes from device.ts, not from the cloud).
 * Even then they only start by themselves along connections you confirmed here: the ones the flow had when
 * you switched it on, or that you drew in this window since. A connection added elsewhere (by an agent,
 * in the web app, on another computer) turns the start into a request you allow in the app. So does a task
 * that would run in the agent's cloud.
 */

/** Whether every one of these connections was confirmed on this computer for the target's project. */
function confirmed(projectId: string | null, inc: FlowEdge[]): boolean {
  const c = confirmedFlow(projectId);
  return !!c && inc.every((e) => c.edges.includes(repo.edgeSignature(e)));
}

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

/**
 * Starts a task's session for its flow (with `agent`, else the task's), or asks you: when it would run in the agent's
 * cloud, since that sends the project there, and where a task runs can be changed elsewhere (in the web app), which
 * confirming a flow's connections doesn't cover; and when the task needs something (Task.needs) the agent doesn't have
 * here, since another computer may, and only you can send it there (a request takes a fresh two-factor code).
 */
export async function startFromFlow(task: Task, agent?: AgentId): Promise<LaunchResult | null> {
  const project = task.projectId ? await repo.getProject(task.projectId) : null;
  const who = agent ?? agentOf(task, project?.agent) ?? "claude";
  const lacks = task.needs.length ? missingFrom(task.needs, toolsHere(who, plannedFolder(task))) : [];
  if (plannedSurface(task, who) === "cloud" || lacks.length || !workspaceConfirmed(task, project)) {
    await askFromFlow(task);
    return null;
  }
  return startSession(task.id, { agent, reason: "flow" });
}

async function snapshot() {
  const [edges, list, held] = await Promise.all([repo.listEdges(), repo.listTasks(), repo.heldTaskIds()]);
  return { edges, tasks: new Map(list.map((t) => [t.id, t])), held };
}

type Snapshot = Awaited<ReturnType<typeof snapshot>>;

/** Starts the task's session if the flow allows it right now. */
async function maybeStart(target: Task, { edges, tasks, held }: Snapshot): Promise<LaunchResult | null> {
  if (target.status !== "todo" && target.status !== "backlog") return null;
  // Your own tasks can wait for others (a dependency on the timeline), but they never start a session.
  if (target.agent === "human") return null;
  const project = target.projectId ? await repo.getProject(target.projectId) : null;
  if (!project?.flowOn) return null;
  const inc = incoming(target.id, edges);
  if (!inc.length || inc.some((e) => e.mode === "session")) return null;
  if (!inc.every((e) => satisfied(e, tasks.get(e.fromTaskId), held))) return null;
  if ((await repo.listSessions({ taskId: target.id, status: LIVE_STATUSES })).length) return null;
  if (!confirmed(target.projectId, inc)) {
    await askFromFlow(target);
    return null;
  }
  return startFromFlow(target);
}

/**
 * Starts a "same session" task in a new session, once the task before it is released from a partial or blocked
 * hand-back (the agent stopped, so it can't continue in that session), unless its other connections still hold
 * it. Like any start from a flow, only for a flow that's on here and along a connection confirmed here; otherwise
 * it asks you.
 */
async function startAfterHold(target: Task, edge: FlowEdge, { edges, tasks, held }: Snapshot): Promise<LaunchResult | null> {
  if (target.status !== "todo" && target.status !== "backlog") return null;
  if (target.agent === "human") return null;
  const project = target.projectId ? await repo.getProject(target.projectId) : null;
  if (!project?.flowOn) return null;
  const others = incoming(target.id, edges).filter((x) => x.id !== edge.id);
  if (!others.every((x) => satisfied(x, tasks.get(x.fromTaskId), held))) return null;
  if ((await repo.listSessions({ taskId: target.id, status: LIVE_STATUSES })).length) return null;
  if (!confirmed(target.projectId, incoming(target.id, edges))) {
    await askFromFlow(target);
    return null;
  }
  return startFromFlow(target);
}

/**
 * Called when an agent reports a task as finished. Returns the task to continue in the same
 * session (if a "same session" connection is ready) and any sessions started automatically.
 */
export async function afterFinished(taskId: number): Promise<{ continueWith: Task | null; started: LaunchResult[] }> {
  const snap = await snapshot();
  const { edges, tasks, held } = snap;
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
      if (!workspaceConfirmed(target, project)) { await askFromFlow(target); continue; }
      const others = incoming(target.id, edges).filter((x) => x.id !== e.id);
      if (!continueWith && others.every((x) => satisfied(x, tasks.get(x.fromTaskId), held))) {
        // An existing conversation cannot apply another task's explicit model settings through MCP.
        // Start it normally so the destination checks and applies those settings before any work happens.
        if (target.modelSettings) {
          const r = await startFromFlow(target);
          if (r) started.push(r);
        } else continueWith = target;
      }
      continue;
    }
    const r = await maybeStart(target, snap);
    if (r) started.push(r);
  }
  return { continueWith, started };
}

/**
 * Called when you mark a task done: manual connections can now start their sessions. After a partial or blocked
 * hand-back the agent stopped, so a "same session" task after it can't continue in its session: it starts in a new
 * one, as it does when a session is marked finished.
 */
export async function afterDone(taskId: number): Promise<LaunchResult[]> {
  const snap = await snapshot();
  const { edges, tasks, held } = snap;
  const started: LaunchResult[] = [];
  for (const e of edges.filter((x) => x.fromTaskId === taskId)) {
    const target = tasks.get(e.toTaskId);
    if (!target) continue;
    const r = e.mode === "session" && held.has(taskId) ? await startAfterHold(target, e, snap) : await maybeStart(target, snap);
    if (r) started.push(r);
  }
  const done = tasks.get(taskId);
  if (done?.projectId) started.push(...(await startNextProject(done.projectId, edges, tasks)));
  return started;
}

/** The first tasks of a project that starts after another one (no connections into them), for its agents. */
const rootsOf = (projectId: string, edges: FlowEdge[], tasks: Map<number, Task>) => [...tasks.values()].filter(
  (t) => t.projectId === projectId && t.flowX !== null && (t.status === "todo" || t.status === "backlog") && t.agent !== "human"
    && !incoming(t.id, edges).length,
);

/** When every task in a project's flow is done, start the projects that wait for it. */
async function startNextProject(projectId: string, edges: FlowEdge[], tasks: Map<number, Task>): Promise<LaunchResult[]> {
  const inFlow = [...tasks.values()].filter((t) => t.projectId === projectId && t.flowX !== null);
  if (!inFlow.length || inFlow.some((t) => t.status !== "done" && t.status !== "canceled")) return [];
  const out: LaunchResult[] = [];
  for (const p of (await repo.listProjects()).filter((x) => x.afterProjectId === projectId && x.flowOn)) {
    // "Starts after" counts only as you confirmed it here.
    const sure = confirmedFlow(p.id)?.after === projectId;
    for (const t of rootsOf(p.id, edges, tasks)) {
      if (!sure) {
        await askFromFlow(t);
        continue;
      }
      const r = await startFromFlow(t);
      if (r) out.push(r);
    }
  }
  return out;
}

/** Runs every minute: starts sessions whose "at a set time" connection is due. */
export async function tick() {
  const snap = await snapshot();
  for (const e of snap.edges.filter((x) => x.mode === "time" && x.atTime && x.atTime <= toDateTimeStr(new Date()))) {
    const target = snap.tasks.get(e.toTaskId);
    if (target) await maybeStart(target, snap);
  }
}

/**
 * Called when a project's flow is switched on (in this window, which also confirms its connections): starts what it
 * would have started while it was off. That is the tasks whose connections are all ready and, if the project starts
 * after another one whose flow is finished, its first tasks, as startNextProject does when that flow finishes.
 */
export async function afterFlowOn(projectId: string): Promise<LaunchResult[]> {
  const snap = await snapshot();
  const { edges, tasks } = snap;
  const own = [...tasks.values()].filter((t) => t.projectId === projectId).sort((a, b) => a.sortOrder - b.sortOrder);
  const started: LaunchResult[] = [];
  for (const t of own) {
    const r = await maybeStart(t, snap);
    if (r) started.push(r);
  }
  const before = (await repo.getProject(projectId))?.afterProjectId;
  const prior = before ? [...tasks.values()].filter((t) => t.projectId === before && t.flowX !== null) : [];
  if (before && prior.length && prior.every((t) => t.status === "done" || t.status === "canceled")) {
    const sure = confirmedFlow(projectId)?.after === before;
    for (const t of rootsOf(projectId, edges, tasks)) {
      if ((await repo.listSessions({ taskId: t.id, status: LIVE_STATUSES })).length) continue;
      if (!sure) {
        await askFromFlow(t);
        continue;
      }
      const r = await startFromFlow(t);
      if (r) started.push(r);
    }
  }
  return started;
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
  const { edges, tasks, held } = await snapshot();
  const open = [...tasks.values()]
    .filter((t) => t.projectId === projectId && (t.status === "todo" || t.status === "backlog"))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return open.find((t) => incoming(t.id, edges).every((e) => satisfied(e, tasks.get(e.fromTaskId), held))) ?? null;
}
