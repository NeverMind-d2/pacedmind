"use server";

import { refresh } from "next/cache";
import * as repo from "@/server/repo";
import { resetDatabase } from "@/server/db";
import { afterDone } from "@/server/flow";
import { resumeSession, startSession, type LaunchResult } from "@/server/launcher";
import { nowStamp } from "@/lib/dates";
import type { AgentId, EdgeMode, Project, Settings } from "@/lib/types";

type Result = { ok: boolean; error?: string; message?: string };

function done(r: Result = { ok: true }): Result {
  refresh();
  return r;
}

const launched = (rs: LaunchResult[]): string | undefined => {
  const keys = rs.filter((r) => r.ok && r.session).map((r) => repo.getTask(r.session!.taskId)?.key);
  return keys.length ? `Started ${keys.join(", ")}` : undefined;
};

/* ---------- tasks ---------- */

export async function createTaskAction(input: repo.TaskInput & { subtasks?: string[] }): Promise<Result & { key?: string }> {
  if (!input.title?.trim()) return { ok: false, error: "Give the task a title" };
  const t = repo.createTask(input);
  for (const s of input.subtasks ?? []) repo.addSubtask(t.id, s);
  refresh();
  return { ok: true, key: t.key };
}

export async function updateTaskAction(id: number, patch: Parameters<typeof repo.updateTask>[1]): Promise<Result> {
  const before = repo.getTask(id);
  if (!before) return { ok: false, error: "Task not found" };
  repo.updateTask(id, patch);
  if (patch.status === "done" && before.status !== "done") {
    for (const s of repo.listSessions("task_id = ? AND status = 'finished'", id)) {
      repo.updateSession(s.id, { status: "done" });
      repo.addSessionEvent(s.id, "done", "You marked it done");
    }
    return done({ ok: true, message: launched(afterDone(id)) });
  }
  return done();
}

export async function deleteTaskAction(id: number) {
  repo.deleteTask(id);
  return done();
}

export async function addSubtaskAction(taskId: number, title: string) {
  if (title.trim()) repo.addSubtask(taskId, title);
  return done();
}

export async function toggleSubtaskAction(id: number, isDone: boolean) {
  repo.setSubtaskDone(id, isDone);
  return done();
}

export async function deleteSubtaskAction(id: number) {
  repo.deleteSubtask(id);
  return done();
}

/* ---------- events ---------- */

export async function createEventAction(input: { title: string; areaId?: string | null; start: string; end: string; recurrence?: "weekly" | null }) {
  if (!input.title?.trim()) return { ok: false, error: "Give the activity a title" };
  repo.createEvent(input);
  return done();
}

export async function deleteEventAction(id: number) {
  repo.deleteEvent(id);
  return done();
}

/* ---------- sessions ---------- */

export async function startSessionAction(taskId: number, agent?: AgentId): Promise<Result> {
  const r = startSession(taskId, agent);
  return done(r.ok ? { ok: true, message: "Session started in a new terminal" } : { ok: false, error: r.error });
}

export async function resumeSessionAction(sessionId: string): Promise<Result> {
  const r = resumeSession(sessionId);
  return done(r.ok ? { ok: true } : { ok: false, error: r.error });
}

/** Closes a session by hand, e.g. when its terminal was closed or it got stuck before the agent checked in. */
export async function closeSessionAction(sessionId: string): Promise<Result> {
  const s = repo.getSession(sessionId);
  if (!s) return { ok: false, error: "Session not found" };
  if (s.status === "starting" || s.status === "running") {
    repo.updateSession(sessionId, { status: "closed", endedAt: nowStamp() });
    repo.addSessionEvent(sessionId, "closed", "You closed the session");
    const task = repo.getTask(s.taskId);
    if (task?.status === "progress") repo.updateTask(task.id, { status: "todo" });
  }
  return done();
}

export async function markSessionDoneAction(sessionId: string): Promise<Result> {
  const s = repo.getSession(sessionId);
  if (!s) return { ok: false, error: "Session not found" };
  return updateTaskAction(s.taskId, { status: "done" });
}

/* ---------- flow ---------- */

export async function placeInFlowAction(taskId: number, x: number, y: number, agent?: AgentId) {
  repo.updateTask(taskId, { flowX: x, flowY: y, ...(agent ? { agent } : {}) });
  return done();
}

export async function removeFromFlowAction(taskId: number) {
  for (const e of repo.listEdges().filter((e) => e.fromTaskId === taskId || e.toTaskId === taskId)) repo.deleteEdge(e.id);
  repo.updateTask(taskId, { flowX: null, flowY: null });
  return done();
}

export async function connectAction(fromTaskId: number, toTaskId: number, mode: EdgeMode = "auto") {
  repo.createEdge(fromTaskId, toTaskId, mode);
  return done();
}

export async function setIncomingModeAction(taskId: number, mode: EdgeMode, atTime: string | null = null) {
  repo.setIncomingMode(taskId, mode, atTime);
  return done();
}

export async function deleteEdgeAction(edgeId: number) {
  repo.deleteEdge(edgeId);
  return done();
}

export async function setFlowOnAction(projectId: string, on: boolean) {
  repo.updateProject(projectId, { flowOn: on });
  return done();
}

/* ---------- projects and settings ---------- */

export async function createProjectAction(input: { name: string; areaId: string; folder?: string | null; agent?: AgentId | null }) {
  if (!input.name?.trim()) return { ok: false, error: "Give the project a name" };
  repo.createProject(input);
  return done();
}

export async function updateProjectAction(id: string, patch: Partial<Omit<Project, "id">>) {
  repo.updateProject(id, patch);
  return done();
}

export async function updateSettingsAction(patch: Partial<Settings>) {
  repo.setSettings(patch);
  return done();
}

export async function resetDataAction(mode: "sample" | "empty") {
  resetDatabase(mode);
  return done();
}
