import "server-only";
import * as repo from "./repo";
import { revokeSessionTokens } from "./device";
import { forgetSessionFiles } from "./launcher";
import { MODE } from "./supabase";
import { afterDone } from "./flow";
import type { LaunchResult } from "./launcher";
import { nowStamp } from "@/lib/dates";
import { GRID, NODE_H, freeSpot, layoutFlow } from "@/lib/flow-layout";
import { isLiveSession, type AgentId } from "@/lib/types";

/* Operations shared by the Server Actions (the UI) and the MCP tools, so both behave the same. */

/**
 * Call after a task's status became done: its finished sessions count as reviewed, and flows may
 * start the sessions that waited for it.
 */
export async function afterTaskDone(taskId: number): Promise<LaunchResult[]> {
  const finished = await repo.listSessions({ taskId, status: ["finished"] });
  for (const s of finished) {
    await repo.updateSession(s.id, { status: "done" });
    await repo.addSessionEvent(s.id, "done", "You marked it done");
  }
  // Their agents are done with PacedMind.
  if (MODE === "desktop") {
    revokeSessionTokens(finished.map((s) => s.id));
    forgetSessionFiles(finished.map((s) => s.id));
  }
  return afterDone(taskId);
}

/** Closes a session by hand, e.g. when its terminal was closed or it got stuck before the agent checked in. */
export async function closeSession(sessionId: string): Promise<boolean> {
  const s = await repo.getSession(sessionId);
  if (!s) return false;
  // Its agent loses PacedMind access now, whatever its terminal does next.
  if (MODE === "desktop") {
    revokeSessionTokens([sessionId]);
    forgetSessionFiles([sessionId]);
  }
  if (isLiveSession(s)) {
    await repo.updateSession(sessionId, { status: "closed", endedAt: nowStamp() });
    await repo.addSessionEvent(sessionId, "closed", "You closed the session");
    const task = await repo.getTask(s.taskId);
    if (task?.status === "progress") await repo.updateTask(task.id, { status: "todo" });
  }
  return true;
}

/* ---------- flow canvas ---------- */

// Positions are free on a grid; the geometry and layout are shared with the canvas (src/lib/flow-layout.ts).

const placed = (t: { flowX: number | null; flowY: number | null }) => t.flowX !== null && t.flowY !== null;

/**
 * Puts a task on its project's flow canvas, run by `agent`: below `belowTaskId` when given (the task it
 * runs after), else under the rest of the flow, moved aside if another session is in the way.
 */
export async function placeInFlow(taskId: number, agent: AgentId, belowTaskId?: number) {
  const task = await repo.getTask(taskId);
  if (!task) return;
  const others = (await repo.listTasks({ projectId: task.projectId })).filter((t) => placed(t) && t.id !== taskId);
  const at = (t: { flowX: number | null; flowY: number | null }) => ({ x: t.flowX ?? 0, y: t.flowY ?? 0 });
  const source = belowTaskId !== undefined ? others.find((t) => t.id === belowTaskId) : undefined;
  const spot = freeSpot(others.map(at), source ? at(source) : undefined);
  await repo.updateTask(taskId, { flowX: spot.x, flowY: spot.y, agent });
}

/** Lays a project's flow out in the order its tasks run, like the canvas's "Tidy up". */
export async function tidyFlow(projectId: string) {
  const onCanvas = (await repo.listTasks({ projectId })).filter(placed);
  const ids = new Set(onCanvas.map((t) => t.id));
  const edges = (await repo.listEdges()).filter((e) => ids.has(e.fromTaskId) && ids.has(e.toTaskId));
  const at = layoutFlow(onCanvas.map((t) => ({
    id: t.id, x: t.flowX ?? 0, y: t.flowY ?? 0, sortOrder: t.sortOrder,
  })), edges);
  await Promise.all(onCanvas.map((t) => {
    const p = at.get(t.id);
    return p && (p.x !== t.flowX || p.y !== t.flowY) ? repo.updateTask(t.id, { flowX: p.x, flowY: p.y }) : null;
  }));
}

/** Whether the task a connection leads to isn't below the one it comes from, so the flow needs tidying. */
export async function flowNeedsTidy(fromId: number, toId: number): Promise<boolean> {
  const [a, b] = await Promise.all([repo.getTask(fromId), repo.getTask(toId)]);
  return !!a && !!b && (b.flowY ?? 0) < (a.flowY ?? 0) + NODE_H + GRID;
}

/** Takes a task off the flow canvas together with its connections. */
export async function removeFromFlow(taskId: number) {
  await repo.deleteEdgesOf(taskId);
  await repo.updateTask(taskId, { flowX: null, flowY: null });
}

/** A task that is yours ("human") has no place in a flow: takes it off the canvas when it's on it. Call after its agent changed. */
export async function keepYoursOutOfFlow(taskId: number): Promise<boolean> {
  const t = await repo.getTask(taskId);
  if (t?.agent !== "human" || (t.flowX === null && t.flowY === null)) return false;
  await removeFromFlow(taskId);
  return true;
}

/** Whether connecting fromId → toId would close a loop (toId already leads to fromId). */
export async function edgeWouldLoop(fromId: number, toId: number): Promise<boolean> {
  const edges = await repo.listEdges();
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
export async function startsAfterWouldLoop(projectId: string, afterId: string): Promise<boolean> {
  const byId = new Map((await repo.listProjects()).map((p) => [p.id, p]));
  const seen = new Set<string>();
  for (let cur: string | null = afterId; cur && !seen.has(cur); cur = byId.get(cur)?.afterProjectId ?? null) {
    if (cur === projectId) return true;
    seen.add(cur);
  }
  return false;
}
