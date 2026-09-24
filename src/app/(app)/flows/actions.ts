"use server";

import { refresh } from "next/cache";
import { tx } from "@/server/db";
import * as repo from "@/server/repo";
import type { AgentId, EdgeMode } from "@/lib/types";

type Result = { ok: boolean; error?: string; message?: string };

const AGENTS = new Set<AgentId>(["claude", "codex"]);
const MODES = new Set<EdgeMode>(["auto", "manual", "session", "time"]);
const finite = (...ns: number[]) => ns.every((n) => Number.isFinite(n));

/** Puts a task on the canvas, run by `agent`, and optionally runs it after another task. */
export async function addToFlowAction(
  taskId: number, x: number, y: number, agent: AgentId, afterTaskId: number | null = null,
): Promise<Result> {
  if (!repo.getTask(taskId)) return { ok: false, error: "Task not found" };
  if (!finite(x, y) || !AGENTS.has(agent)) return { ok: false, error: "The task can't go there" };
  tx(() => {
    repo.updateTask(taskId, { flowX: x, flowY: y, agent });
    if (afterTaskId !== null && afterTaskId !== taskId && repo.getTask(afterTaskId)) repo.createEdge(afterTaskId, taskId, "auto");
  });
  refresh();
  return { ok: true };
}

/** Saves new canvas positions for several tasks at once ("Tidy up"). */
export async function tidyFlowAction(positions: { taskId: number; x: number; y: number }[]): Promise<Result> {
  const valid = positions.filter((p) => finite(p.taskId, p.x, p.y));
  tx(() => {
    for (const p of valid) repo.updateTask(p.taskId, { flowX: p.x, flowY: p.y });
  });
  refresh();
  return { ok: true };
}

/** Hands tasks to an agent. The canvas sends a task together with the tasks that share its terminal session. */
export async function setAgentsAction(taskIds: number[], agent: AgentId): Promise<Result> {
  if (!AGENTS.has(agent)) return { ok: false, error: "Unknown agent" };
  tx(() => {
    for (const id of taskIds) if (Number.isFinite(id) && repo.getTask(id)) repo.updateTask(id, { agent });
  });
  refresh();
  return { ok: true };
}

/** Sets how a task's session starts. */
export async function setStartAction(taskId: number, mode: EdgeMode, atTime: string | null): Promise<Result> {
  if (!MODES.has(mode)) return { ok: false, error: "Unknown start mode" };
  if (mode === "time" && !(atTime && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(atTime))) return { ok: false, error: "Pick a day and time" };
  repo.setIncomingMode(taskId, mode, mode === "time" ? atTime : null);
  refresh();
  return { ok: true };
}
