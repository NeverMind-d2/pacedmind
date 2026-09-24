import "server-only";
import { tx } from "./db";
import * as repo from "./repo";
import { afterDone } from "./flow";
import type { LaunchResult } from "./launcher";
import { nowStamp } from "@/lib/dates";
import type { AgentId, Task } from "@/lib/types";

/* Operations shared by the Server Actions (the UI) and the MCP tools, so both behave the same. */

/**
 * Call after a task's status became done: its finished sessions count as reviewed, and flows may
 * start the sessions that waited for it.
 */
export function afterTaskDone(taskId: number): LaunchResult[] {
  for (const s of repo.listSessions("task_id = ? AND status = 'finished'", taskId)) {
    repo.updateSession(s.id, { status: "done" });
    repo.addSessionEvent(s.id, "done", "You marked it done");
  }
  return afterDone(taskId);
}

/** Closes a session by hand, e.g. when its terminal was closed or it got stuck before the agent checked in. */
export function closeSession(sessionId: string): boolean {
  const s = repo.getSession(sessionId);
  if (!s) return false;
  if (s.status === "starting" || s.status === "running") {
    repo.updateSession(sessionId, { status: "closed", endedAt: nowStamp() });
    repo.addSessionEvent(sessionId, "closed", "You closed the session");
    const task = repo.getTask(s.taskId);
    if (task?.status === "progress") repo.updateTask(task.id, { status: "todo" });
  }
  return true;
}

/* ---------- flow canvas ---------- */

// Keep in sync with the canvas geometry in src/components/views/flow.tsx.
const LANES: AgentId[] = ["claude", "codex"];
const LANE_W = 300;
const NODE_H = 68;
const GAP = 64;
export const laneX = (agent: AgentId) => Math.max(0, LANES.indexOf(agent)) * LANE_W;

/**
 * Puts a task on its project's flow canvas in an agent's lane: at the bottom of the lane, and
 * below `belowTaskId` when given (the task it runs after).
 */
export function placeInFlow(taskId: number, agent: AgentId, belowTaskId?: number) {
  const task = repo.getTask(taskId);
  if (!task) return;
  const others = repo.listTasks("project_id IS ? AND flow_x IS NOT NULL AND flow_y IS NOT NULL AND id != ?", task.projectId, taskId);
  const laneBottoms = others.filter((t) => (t.agent ?? "claude") === agent).map((t) => (t.flowY ?? 0) + NODE_H + GAP);
  const source = belowTaskId !== undefined ? others.find((t) => t.id === belowTaskId) : undefined;
  const y = Math.max(0, ...laneBottoms, source ? (source.flowY ?? 0) + NODE_H + GAP : 0);
  repo.updateTask(taskId, { flowX: laneX(agent), flowY: y, agent });
}

/**
 * Lays a project's flow out top to bottom in the order tasks run, each in its agent's lane, like the
 * canvas's "Tidy up" (tidy() in flow.tsx).
 */
export function tidyFlow(projectId: string) {
  const placed = repo.listTasks("project_id = ? AND flow_x IS NOT NULL AND flow_y IS NOT NULL", projectId);
  const ids = new Set(placed.map((t) => t.id));
  const edges = repo.listEdges().filter((e) => ids.has(e.fromTaskId) && ids.has(e.toTaskId));
  const agentOf = (t: Task) => t.agent ?? "claude";
  const before = (a: Task, b: Task) =>
    (a.flowY ?? 0) - (b.flowY ?? 0) || laneX(agentOf(a)) - laneX(agentOf(b)) || a.sortOrder - b.sortOrder;
  const indegree = new Map<number, number>(placed.map((t) => [t.id, 0]));
  for (const e of edges) indegree.set(e.toTaskId, (indegree.get(e.toTaskId) ?? 0) + 1);
  const ready = placed.filter((t) => !indegree.get(t.id));
  const order: Task[] = [];
  while (ready.length) {
    ready.sort(before);
    const t = ready.shift()!;
    order.push(t);
    for (const e of edges.filter((x) => x.fromTaskId === t.id)) {
      const left = (indegree.get(e.toTaskId) ?? 1) - 1;
      indegree.set(e.toTaskId, left);
      const next = placed.find((x) => x.id === e.toTaskId);
      if (left === 0 && next) ready.push(next);
    }
  }
  for (const t of [...placed].sort(before)) if (!order.includes(t)) order.push(t);
  const ys = new Map<number, number>();
  const bottom = LANES.map(() => -Infinity);
  for (const t of order) {
    const lane = Math.max(0, LANES.indexOf(agentOf(t)));
    let y = Math.max(0, bottom[lane] + GAP);
    for (const e of edges.filter((x) => x.toTaskId === t.id)) {
      const sy = ys.get(e.fromTaskId);
      if (sy !== undefined) y = Math.max(y, sy + NODE_H + GAP);
    }
    ys.set(t.id, y);
    bottom[lane] = y + NODE_H;
  }
  tx(() => {
    for (const t of placed) {
      const y = ys.get(t.id) ?? 0;
      if (t.flowY !== y || t.flowX !== laneX(agentOf(t))) repo.updateTask(t.id, { flowX: laneX(agentOf(t)), flowY: y });
    }
  });
}

/** Whether a connection from → to points up or sideways on the canvas, so the flow needs tidying. */
export function flowNeedsTidy(fromId: number, toId: number): boolean {
  const a = repo.getTask(fromId);
  const b = repo.getTask(toId);
  return !!a && !!b && (b.flowY ?? 0) < (a.flowY ?? 0) + NODE_H + GAP;
}

/** Takes a task off the flow canvas together with its connections. */
export function removeFromFlow(taskId: number) {
  tx(() => {
    for (const e of repo.listEdges().filter((e) => e.fromTaskId === taskId || e.toTaskId === taskId)) repo.deleteEdge(e.id);
    repo.updateTask(taskId, { flowX: null, flowY: null });
  });
}

/** Whether connecting fromId → toId would close a loop (toId already leads to fromId). */
export function edgeWouldLoop(fromId: number, toId: number): boolean {
  const edges = repo.listEdges();
  const seen = new Set<number>();
  const stack = [toId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === fromId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of edges) if (e.fromTaskId === cur) stack.push(e.toTaskId);
  }
  return false;
}

/** Whether making `projectId` start after `afterId` would make projects wait for each other in a circle. */
export function startsAfterWouldLoop(projectId: string, afterId: string): boolean {
  const byId = new Map(repo.listProjects().map((p) => [p.id, p]));
  const seen = new Set<string>();
  for (let cur: string | null = afterId; cur && !seen.has(cur); cur = byId.get(cur)?.afterProjectId ?? null) {
    if (cur === projectId) return true;
    seen.add(cur);
  }
  return false;
}
