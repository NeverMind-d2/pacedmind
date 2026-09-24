import "server-only";
import { tx } from "./db";
import * as repo from "./repo";
import { afterDone } from "./flow";
import type { LaunchResult } from "./launcher";
import { nowStamp } from "@/lib/dates";
import { GRID, NODE_H, freeSpot, layoutFlow } from "@/lib/flow-layout";
import type { AgentId } from "@/lib/types";

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

// Positions are free on a grid; the geometry and layout are shared with the canvas (src/lib/flow-layout.ts).

/**
 * Puts a task on its project's flow canvas, run by `agent`: below `belowTaskId` when given (the task it
 * runs after), else under the rest of the flow, moved aside if another session is in the way.
 */
export function placeInFlow(taskId: number, agent: AgentId, belowTaskId?: number) {
  const task = repo.getTask(taskId);
  if (!task) return;
  const others = repo.listTasks("project_id IS ? AND flow_x IS NOT NULL AND flow_y IS NOT NULL AND id != ?", task.projectId, taskId);
  const at = (t: { flowX: number | null; flowY: number | null }) => ({ x: t.flowX ?? 0, y: t.flowY ?? 0 });
  const source = belowTaskId !== undefined ? others.find((t) => t.id === belowTaskId) : undefined;
  const spot = freeSpot(others.map(at), source ? at(source) : undefined);
  repo.updateTask(taskId, { flowX: spot.x, flowY: spot.y, agent });
}

/** Lays a project's flow out in the order its tasks run, like the canvas's "Tidy up". */
export function tidyFlow(projectId: string) {
  const placed = repo.listTasks("project_id = ? AND flow_x IS NOT NULL AND flow_y IS NOT NULL", projectId);
  const ids = new Set(placed.map((t) => t.id));
  const edges = repo.listEdges().filter((e) => ids.has(e.fromTaskId) && ids.has(e.toTaskId));
  const at = layoutFlow(placed.map((t) => ({
    id: t.id, x: t.flowX ?? 0, y: t.flowY ?? 0, sortOrder: t.sortOrder,
  })), edges);
  tx(() => {
    for (const t of placed) {
      const p = at.get(t.id);
      if (p && (p.x !== t.flowX || p.y !== t.flowY)) repo.updateTask(t.id, { flowX: p.x, flowY: p.y });
    }
  });
}

/** Whether the task a connection leads to isn't below the one it comes from, so the flow needs tidying. */
export function flowNeedsTidy(fromId: number, toId: number): boolean {
  const a = repo.getTask(fromId);
  const b = repo.getTask(toId);
  return !!a && !!b && (b.flowY ?? 0) < (a.flowY ?? 0) + NODE_H + GRID;
}

/** Takes a task off the flow canvas together with its connections. */
export function removeFromFlow(taskId: number) {
  tx(() => {
    for (const e of repo.listEdges().filter((e) => e.fromTaskId === taskId || e.toTaskId === taskId)) repo.deleteEdge(e.id);
    repo.updateTask(taskId, { flowX: null, flowY: null });
  });
}

/** A task that is yours ("human") has no place in a flow: takes it off the canvas when it's on it. Call after its agent changed. */
export function keepYoursOutOfFlow(taskId: number): boolean {
  const t = repo.getTask(taskId);
  if (t?.agent !== "human" || (t.flowX === null && t.flowY === null)) return false;
  removeFromFlow(taskId);
  return true;
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
