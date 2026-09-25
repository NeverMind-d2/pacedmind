"use server";

import { refresh } from "next/cache";
import * as repo from "@/server/repo";
import { resetDatabase } from "@/server/db";
import { checkThisDevice, connectClaude, connectCodex, thisDeviceId } from "@/server/devices";
import { folderProblem } from "@/server/folders";
import { findProjects, importProjects, type FoundProject, type ImportItem } from "@/server/import";
import { mcpUrl, resumeSession, startSession, type LaunchResult } from "@/server/launcher";
import { afterTaskDone, closeSession, edgeWouldLoop, finishTask, keepYoursOutOfFlow, removeFromFlow } from "@/server/ops";
import type { AgentId, EdgeMode, Project, Settings, Surface } from "@/lib/types";

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

export async function updateTaskAction(id: number, patch: repo.TaskPatch): Promise<Result> {
  const before = repo.getTask(id);
  if (!before) return { ok: false, error: "Task not found" };
  const bad = folderError(patch.folder, patch.deviceId !== undefined ? patch.deviceId : before.deviceId, before.projectId);
  if (bad) return { ok: false, error: bad };
  repo.updateTask(id, patch);
  if (patch.agent === "human" && keepYoursOutOfFlow(id)) return done({ ok: true, message: `${before.key} is yours now, so it left the flow` });
  if (patch.status === "done" && before.status !== "done") return done({ ok: true, message: launched(afterTaskDone(id)) });
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

/**
 * Why a task can't work in `folder`, or null. Folders are checked on this computer; a folder on another device is
 * taken as it is.
 */
function folderError(folder: string | null | undefined, deviceId: string | null, projectId: string | null): string | null {
  if (!folder) return null;
  const device = deviceId ?? (projectId ? repo.getProject(projectId)?.deviceId : null) ?? null;
  if (device && device !== thisDeviceId()) return null;
  const problem = folderProblem(folder);
  return problem ? `Can't use ${folder}: ${problem}` : null;
}

/* ---------- sessions ---------- */

const SURFACES = new Set<Surface>(["terminal", "desktop", "cloud"]);

export async function startSessionAction(taskId: number, agent?: AgentId, surface?: Surface): Promise<Result> {
  if (surface && !SURFACES.has(surface)) return { ok: false, error: "Unknown place to run the session" };
  const r = startSession(taskId, { agent, surface });
  return done(r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
}

/** Picks a session up again where it ran, or in the desktop app (`surface` "desktop"). */
export async function resumeSessionAction(sessionId: string, surface?: Surface): Promise<Result> {
  if (surface && !SURFACES.has(surface)) return { ok: false, error: "Unknown place to open the session" };
  const r = resumeSession(sessionId, surface);
  return done(r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
}

/** For sessions that can't report back (the cloud, an app without PacedMind's MCP server): you say the work is finished. */
export async function finishSessionAction(sessionId: string): Promise<Result> {
  const s = repo.getSession(sessionId);
  if (!s) return { ok: false, error: "Session not found" };
  if (s.status !== "starting" && s.status !== "running") return { ok: false, error: "The session isn't running" };
  const { started } = finishTask(s.taskId, s.id, "", "you");
  return done({ ok: true, message: launched(started) ?? `${repo.getTask(s.taskId)?.key ?? "The task"} waits for your check` });
}

/** Closes a session by hand, e.g. when its terminal was closed or it got stuck before the agent checked in. */
export async function closeSessionAction(sessionId: string): Promise<Result> {
  if (!closeSession(sessionId)) return { ok: false, error: "Session not found" };
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
  removeFromFlow(taskId);
  return done();
}

export async function connectAction(fromTaskId: number, toTaskId: number, mode: EdgeMode = "auto") {
  repo.createEdge(fromTaskId, toTaskId, mode);
  return done();
}

/**
 * A dependency drawn on the timeline: `toTaskId` waits for `fromTaskId`. It is the same connection a flow
 * uses, so it follows the same rules and takes the mode of the task's other incoming connections.
 */
export async function linkTasksAction(fromTaskId: number, toTaskId: number): Promise<Result> {
  const from = repo.getTask(fromTaskId);
  const to = repo.getTask(toTaskId);
  if (!from || !to) return { ok: false, error: "Task not found" };
  if (from.id === to.id) return { ok: false, error: "A task can't wait for itself" };
  if (from.projectId !== to.projectId) return { ok: false, error: `${from.key} and ${to.key} are in different projects. Dependencies stay within one project.` };
  if (edgeWouldLoop(from.id, to.id)) return { ok: false, error: `${from.key} already waits for ${to.key}, so this would make a loop` };
  const other = repo.listEdges().find((e) => e.toTaskId === to.id && e.fromTaskId !== from.id);
  repo.createEdge(from.id, to.id, other?.mode ?? "auto");
  if (other) repo.setIncomingMode(to.id, other.mode, other.atTime);
  return done({ ok: true, message: `${to.key} now waits for ${from.key}` });
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

export async function createProjectAction(input: {
  name: string; areaId: string; folder?: string | null; agent?: AgentId | null; color?: string | null;
}): Promise<Result & { id?: string }> {
  if (!input.name?.trim()) return { ok: false, error: "Give the project a name" };
  if (!repo.listAreas().some((a) => a.id === input.areaId)) return { ok: false, error: "Pick an area for the project" };
  const p = repo.createProject(input);
  refresh();
  return { ok: true, id: p.id, message: `Created ${p.name}` };
}

export async function deleteProjectAction(id: string) {
  const p = repo.getProject(id);
  if (!p) return { ok: false, error: "Project not found" };
  const kept = repo.listTasks("project_id = ?", id).length;
  repo.deleteProject(id);
  return done({ ok: true, message: kept ? `Deleted ${p.name}. Its tasks stay in the area.` : `Deleted ${p.name}` });
}

export async function createAreaAction(input: { name: string; color: string }): Promise<Result & { id?: string }> {
  if (!input.name?.trim()) return { ok: false, error: "Give the area a name" };
  const a = repo.createArea(input);
  refresh();
  return { ok: true, id: a.id, message: `Created ${a.name} (${a.key})` };
}

export async function updateAreaAction(id: string, patch: { name?: string; color?: string }) {
  repo.updateArea(id, patch);
  return done();
}

export async function deleteAreaAction(id: string) {
  const a = repo.listAreas().find((x) => x.id === id);
  if (!a) return { ok: false, error: "Area not found" };
  const kept = repo.listTasks("area_id = ? OR project_id IN (SELECT id FROM projects WHERE area_id = ?)", id, id).length;
  repo.deleteArea(id);
  return done({ ok: true, message: kept ? `Deleted ${a.name}. Its tasks moved to the Inbox.` : `Deleted ${a.name}` });
}

export async function updateProjectAction(id: string, patch: Partial<Omit<Project, "id">>) {
  repo.updateProject(id, patch);
  return done();
}

export async function updateSettingsAction(patch: Partial<Settings>) {
  repo.setSettings(patch);
  return done();
}

/* ---------- devices and importing projects ---------- */

/** Looks for Claude Code and Codex on this computer again. */
export async function checkDeviceAction(): Promise<Result> {
  const d = await checkThisDevice(mcpUrl());
  return done({ ok: true, message: `Checked ${d.name}` });
}

/**
 * Sets an agent up to reach this PacedMind from sessions PacedMind doesn't configure itself (its desktop app, a
 * terminal you opened): Claude Code for all projects, Codex in its config.toml.
 */
export async function connectAgentAction(agent: AgentId): Promise<Result> {
  const token = repo.getSettings().mcpToken;
  const failed = agent === "claude" ? await connectClaude(mcpUrl(), token) : agent === "codex" ? connectCodex(mcpUrl(), token) : "Unknown agent";
  await checkThisDevice(mcpUrl());
  return done(failed ? { ok: false, error: failed } : { ok: true, message: `${agent === "claude" ? "Claude Code" : "Codex"} reports to PacedMind now` });
}

/** The Codex cloud environment a project's tasks run in when they go to Codex cloud (its label or id). */
export async function setCodexEnvAction(projectId: string, env: string | null): Promise<Result> {
  const value = env?.trim() || null;
  if (value && !/^[\w .:-]{1,100}$/.test(value)) return { ok: false, error: "Use the environment's label or id" };
  if (!repo.getProject(projectId)) return { ok: false, error: "Project not found" };
  repo.updateProject(projectId, { codexEnv: value });
  return done();
}

/** Folders you work in with Claude Code and Codex on this computer, for the import. */
export async function findProjectsAction(): Promise<FoundProject[]> {
  return findProjects();
}

export async function importProjectsAction(items: ImportItem[], areaId: string): Promise<Result> {
  if (!repo.listAreas().some((a) => a.id === areaId)) return { ok: false, error: "Pick an area for the projects" };
  const { created, skipped } = importProjects(items.filter((i) => i && typeof i.folder === "string" && typeof i.name === "string"), areaId);
  repo.setSettings({ importOffered: true });
  const made = created.length === 1 ? `Added ${created[0].name}` : `Added ${created.length} projects`;
  return done(created.length
    ? { ok: true, message: skipped.length ? `${made}. Skipped ${skipped.join(", ")}.` : made }
    : { ok: false, error: skipped.length ? `Couldn't add ${skipped.join(", ")}` : "Pick a project to add" });
}

/** The import opens by itself once; after that it's in Settings. */
export async function dismissImportAction(): Promise<Result> {
  repo.setSettings({ importOffered: true });
  return done();
}

export async function resetDataAction(mode: "sample" | "empty") {
  resetDatabase(mode);
  return done();
}
