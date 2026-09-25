"use server";

import { refresh } from "next/cache";
import * as repo from "@/server/repo";
import { importLegacy, resetAccount } from "@/server/account";
import { checkThisDevice, deviceIdFor, runsHere } from "@/server/devices";
import { mcpUrl, resumeSession, startSession, type LaunchResult } from "@/server/launcher";
import {
  afterTaskDone, closeSession, edgeWouldLoop, finishTask, keepYoursOutOfFlow, removeFromFlow, requestChanges, saveProject,
} from "@/server/ops";
import { approve, deny } from "@/server/requests";
import { commandProblem, deviceConfig, rotateOwnerToken, updateDevice } from "@/server/device";
import { folderProblem } from "@/server/folders";
import { connectClaudeCode, connectCodex } from "@/server/connect";
import { findProjects, importProjects, type FoundProject, type ImportItem } from "@/server/import";
import { STEP_UP_REFUSED, refusedStepUp, verifyCode } from "@/server/step-up";
import { MODE, supabase } from "@/server/supabase";
import { guardAction as guard } from "@/server/guard";
import type { AgentId, EdgeMode, Project, RemoteStart, Settings, Surface, TerminalId } from "@/lib/types";

type Result = { ok: boolean; error?: string; message?: string };

function done(r: Result = { ok: true }): Result {
  refresh();
  return r;
}

async function launched(rs: LaunchResult[]): Promise<string | undefined> {
  const keys: string[] = [];
  for (const r of rs) if (r.ok && r.session) keys.push((await repo.getTask(r.session.taskId))?.key ?? "a task");
  return keys.length ? `Started ${keys.join(", ")}` : undefined;
}

const errorOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ---------- tasks ---------- */

export async function createTaskAction(input: repo.TaskInput & { subtasks?: string[] }): Promise<Result & { key?: string }> {
  await guard();
  if (!input.title?.trim()) return { ok: false, error: "Give the task a title" };
  const t = await repo.createTask(input);
  for (const s of input.subtasks ?? []) await repo.addSubtask(t.id, s);
  refresh();
  return { ok: true, key: t.key };
}

/**
 * A task's own folder is this computer's setting, so it's checked here; a new one switches its project's flow off
 * until you switch it on again (repo.updateTask).
 */
export async function updateTaskAction(id: number, patch: repo.TaskPatch): Promise<Result> {
  await guard();
  const before = await repo.getTask(id);
  if (!before) return { ok: false, error: "Task not found" };
  if (patch.folder !== undefined && MODE !== "desktop") return { ok: false, error: "Folders are set in the PacedMind desktop app." };
  const bad = patch.folder ? folderProblem(patch.folder) : null;
  if (bad) return { ok: false, error: `Can't use ${patch.folder}: ${bad}` };
  const project = before.projectId ? await repo.getProject(before.projectId) : null;
  try {
    await repo.updateTask(id, patch);
  } catch (e) {
    return { ok: false, error: errorOf(e) };
  }
  if (patch.agent === "human" && (await keepYoursOutOfFlow(id))) return done({ ok: true, message: `${before.key} is yours now, so it left the flow` });
  if (patch.status === "done" && before.status !== "done") return done({ ok: true, message: await launched(await afterTaskDone(id)) });
  if (patch.folder !== undefined && project?.flowOn && !(await repo.getProject(project.id))?.flowOn) {
    return done({ ok: true, message: `${project.name}'s flow is off now. Switch it on again to let it start sessions in the new folder.` });
  }
  return done();
}

export async function deleteTaskAction(id: number) {
  await guard();
  await repo.deleteTask(id);
  return done();
}

export async function addSubtaskAction(taskId: number, title: string) {
  await guard();
  if (title.trim()) await repo.addSubtask(taskId, title);
  return done();
}

export async function toggleSubtaskAction(id: number, isDone: boolean) {
  await guard();
  await repo.setSubtaskDone(id, isDone);
  return done();
}

export async function deleteSubtaskAction(id: number) {
  await guard();
  await repo.deleteSubtask(id);
  return done();
}

/* ---------- events ---------- */

export async function createEventAction(input: { title: string; areaId?: string | null; start: string; end: string; recurrence?: "weekly" | null }) {
  await guard();
  if (!input.title?.trim()) return { ok: false, error: "Give the activity a title" };
  await repo.createEvent(input);
  return done();
}

export async function deleteEventAction(id: number) {
  await guard();
  await repo.deleteEvent(id);
  return done();
}

/* ---------- sessions ---------- */

const SURFACES = new Set<Surface>(["terminal", "desktop", "cloud"]);

/**
 * Starts a session: in the desktop app, where the task says (a terminal or the agent's app here, or its cloud).
 * The web app can't start anything, and a task that runs on another computer starts there: both answer `remote`
 * (with that computer), and the page asks for a fresh two-factor code to send the request (requestSessionAction).
 */
export async function startSessionAction(
  taskId: number, agent?: AgentId | null, surface?: Surface,
): Promise<Result & { remote?: boolean; deviceId?: string }> {
  await guard();
  if (surface && !SURFACES.has(surface)) return { ok: false, error: "Unknown place to run the session" };
  if (MODE === "web") return { ok: false, remote: true, error: "Choose a computer to start it on." };
  const task = await repo.getTask(taskId);
  const project = task?.projectId ? await repo.getProject(task.projectId) : null;
  const runsOn = task ? deviceIdFor(task.deviceId, project?.deviceId) : null;
  if (task && runsOn && !runsHere(runsOn)) return { ok: false, remote: true, deviceId: runsOn, error: `${task.key} runs on another computer.` };
  const r = await startSession(taskId, { agent: agent ?? undefined, surface, reason: "you" });
  return done(r.ok ? { ok: true, message: r.message ?? "Session started" } : { ok: false, error: r.error });
}

/** Asks a computer to start a session. Needs a fresh code: the database refuses the request without one. */
export async function requestSessionAction(taskId: number, agent: AgentId, deviceId: string, code: string): Promise<Result> {
  await guard();
  if (agent !== "claude" && agent !== "codex") return { ok: false, error: "Choose Claude Code or Codex." };
  const device = await repo.getDevice(deviceId);
  if (!device || device.revokedAt) return { ok: false, error: "That computer isn't signed in anymore." };
  if (device.remoteStart === "off") return { ok: false, error: `${device.name} doesn't take sessions started from elsewhere. Change that in its Settings.` };
  const db = await supabase();
  const wrong = await verifyCode(db, code);
  if (wrong) return { ok: false, error: wrong };
  try {
    await repo.createLaunchRequest({ deviceId, taskId, agent, via: MODE === "web" ? "web" : "desktop" });
  } catch (e) {
    const message = errorOf(e);
    return { ok: false, error: refusedStepUp(message) ? STEP_UP_REFUSED : message };
  }
  return done({
    ok: true,
    message: device.remoteStart === "auto" ? `Sent to ${device.name}: it starts within seconds.` : `Sent to ${device.name}: allow it there to start.`,
  });
}

/** Picks a session up again where it ran, or in the desktop app (`surface` "desktop"). */
export async function resumeSessionAction(sessionId: string, surface?: Surface): Promise<Result> {
  await guard();
  if (surface && !SURFACES.has(surface)) return { ok: false, error: "Unknown place to open the session" };
  const r = await resumeSession(sessionId, surface);
  return done(r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
}

/** For sessions that can't report back (the cloud, an app without PacedMind's MCP server): you say the work is finished. */
export async function finishSessionAction(sessionId: string): Promise<Result> {
  await guard();
  const s = await repo.getSession(sessionId);
  if (!s) return { ok: false, error: "Session not found" };
  if (s.status !== "starting" && s.status !== "running") return { ok: false, error: "The session isn't running" };
  const { started } = await finishTask(s.taskId, s.id, "", "you", undefined, s);
  return done({ ok: true, message: (await launched(started)) ?? `${(await repo.getTask(s.taskId))?.key ?? "The task"} waits for your check` });
}

/** Closes a session by hand, e.g. when its terminal was closed or it got stuck before the agent checked in. */
export async function closeSessionAction(sessionId: string): Promise<Result> {
  await guard();
  if (!(await closeSession(sessionId))) return { ok: false, error: "Session not found" };
  return done();
}

/** Sends a hand-back back to its agent with what should change. It reopens in a new terminal here. */
export async function requestChangesAction(sessionId: string, changes: string): Promise<Result> {
  await guard();
  if (MODE !== "desktop") return { ok: false, error: "Ask for changes in the PacedMind desktop app, on the computer the session ran on." };
  const r = await requestChanges(sessionId, changes);
  return done(r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
}

export async function markSessionDoneAction(sessionId: string): Promise<Result> {
  await guard();
  const s = await repo.getSession(sessionId);
  if (!s) return { ok: false, error: "Session not found" };
  return updateTaskAction(s.taskId, { status: "done" });
}

/** A session asked for over MCP or from elsewhere, allowed in this window. */
export async function approveLaunchAction(id: string): Promise<Result> {
  await guard();
  if (MODE !== "desktop") return { ok: false, error: "Only the desktop app starts sessions." };
  const r = await approve(id);
  return done(r.ok ? { ok: true, message: r.message ?? "Session started" } : { ok: false, error: r.error });
}

export async function denyLaunchAction(id: string): Promise<Result> {
  await guard();
  await deny(id);
  return done();
}

/* ---------- flow ---------- */

/** A flow edit in this window confirms what it touched, for a flow that's on (see repo.confirmFlowChange). */
async function confirmTasks(...taskIds: number[]) {
  const tasks = (await Promise.all(taskIds.map((id) => repo.getTask(id)))).filter((t) => t !== null);
  for (const projectId of new Set(tasks.map((t) => t.projectId))) await repo.confirmFlowChange(projectId, { tasks: taskIds });
}

export async function placeInFlowAction(taskId: number, x: number, y: number, agent?: AgentId) {
  await guard();
  await repo.updateTask(taskId, { flowX: x, flowY: y, ...(agent ? { agent } : {}) });
  return done();
}

export async function removeFromFlowAction(taskId: number) {
  await guard();
  await removeFromFlow(taskId);
  await confirmTasks(taskId);
  return done();
}

export async function connectAction(fromTaskId: number, toTaskId: number, mode: EdgeMode = "auto") {
  await guard();
  await repo.createEdge(fromTaskId, toTaskId, mode);
  await confirmTasks(fromTaskId, toTaskId);
  return done();
}

/**
 * A dependency drawn on the timeline: `toTaskId` waits for `fromTaskId`. It is the same connection a flow
 * uses, so it follows the same rules and takes the mode of the task's other incoming connections.
 */
export async function linkTasksAction(fromTaskId: number, toTaskId: number): Promise<Result> {
  await guard();
  const [from, to] = await Promise.all([repo.getTask(fromTaskId), repo.getTask(toTaskId)]);
  if (!from || !to) return { ok: false, error: "Task not found" };
  if (from.id === to.id) return { ok: false, error: "A task can't wait for itself" };
  if (from.projectId !== to.projectId) return { ok: false, error: `${from.key} and ${to.key} are in different projects. Dependencies stay within one project.` };
  if (await edgeWouldLoop(from.id, to.id)) return { ok: false, error: `${from.key} already waits for ${to.key}, so this would make a loop` };
  const other = (await repo.listEdges()).find((e) => e.toTaskId === to.id && e.fromTaskId !== from.id);
  await repo.createEdge(from.id, to.id, other?.mode ?? "auto");
  if (other) await repo.setIncomingMode(to.id, other.mode, other.atTime);
  await confirmTasks(from.id, to.id);
  return done({ ok: true, message: `${to.key} now waits for ${from.key}` });
}

export async function setIncomingModeAction(taskId: number, mode: EdgeMode, atTime: string | null = null) {
  await guard();
  await repo.setIncomingMode(taskId, mode, atTime);
  await confirmTasks(taskId);
  return done();
}

export async function deleteEdgeAction(edgeId: number) {
  await guard();
  const edge = (await repo.listEdges()).find((e) => e.id === edgeId);
  await repo.deleteEdge(edgeId);
  if (edge) await confirmTasks(edge.fromTaskId, edge.toTaskId);
  return done();
}

/**
 * Lets a project's flow start sessions on this computer by itself, or stops it. A switch of this computer only.
 * Switching it on starts the sessions it would have started while it was off.
 */
export async function setFlowOnAction(projectId: string, on: boolean): Promise<Result> {
  await guard();
  if (MODE !== "desktop") return { ok: false, error: "Flows are switched on in the PacedMind desktop app, on the computer they run on." };
  return done({ ok: true, message: await launched(await saveProject(projectId, { flowOn: on })) });
}

/* ---------- projects and settings ---------- */

export async function createProjectAction(input: {
  name: string; areaId: string; folder?: string | null; agent?: AgentId | null; color?: string | null;
}): Promise<Result & { id?: string }> {
  await guard();
  if (!input.name?.trim()) return { ok: false, error: "Give the project a name" };
  if (!(await repo.listAreas()).some((a) => a.id === input.areaId)) return { ok: false, error: "Pick an area for the project" };
  if (input.folder && MODE !== "desktop") return { ok: false, error: "Folders are set in the PacedMind desktop app." };
  const problem = input.folder ? folderProblem(input.folder) : null;
  if (problem) return { ok: false, error: `Can't use the folder ${input.folder}: ${problem}` };
  const p = await repo.createProject(input);
  refresh();
  return { ok: true, id: p.id, message: `Created ${p.name}` };
}

export async function deleteProjectAction(id: string) {
  await guard();
  const p = await repo.getProject(id);
  if (!p) return { ok: false, error: "Project not found" };
  const kept = (await repo.listTasks({ projectId: id })).length;
  await repo.deleteProject(id);
  return done({ ok: true, message: kept ? `Deleted ${p.name}. Its tasks stay in the area.` : `Deleted ${p.name}` });
}

export async function createAreaAction(input: { name: string; color: string }): Promise<Result & { id?: string }> {
  await guard();
  if (!input.name?.trim()) return { ok: false, error: "Give the area a name" };
  const a = await repo.createArea(input);
  refresh();
  return { ok: true, id: a.id, message: `Created ${a.name} (${a.key})` };
}

export async function updateAreaAction(id: string, patch: { name?: string; color?: string }) {
  await guard();
  await repo.updateArea(id, patch);
  return done();
}

export async function deleteAreaAction(id: string) {
  await guard();
  const [areas, projects, tasks] = await Promise.all([repo.listAreas(), repo.listProjects(), repo.listTasks()]);
  const a = areas.find((x) => x.id === id);
  if (!a) return { ok: false, error: "Area not found" };
  const own = new Set(projects.filter((p) => p.areaId === id).map((p) => p.id));
  const kept = tasks.filter((t) => t.areaId === id || (t.projectId !== null && own.has(t.projectId))).length;
  await repo.deleteArea(id);
  return done({ ok: true, message: kept ? `Deleted ${a.name}. Its tasks moved to the Inbox.` : `Deleted ${a.name}` });
}

/** Saves a project. Switching its flow on (desktop app only) starts the sessions it would have started while it was off. */
export async function updateProjectAction(id: string, patch: Partial<Omit<Project, "id">>): Promise<Result> {
  await guard();
  let started: LaunchResult[];
  try {
    started = await saveProject(id, patch);
    if (patch.afterProjectId !== undefined) await repo.confirmFlowChange(id, { after: true });
  } catch (e) {
    return { ok: false, error: errorOf(e) };
  }
  return done({ ok: true, message: await launched(started) });
}

/** The Codex cloud environment a project's tasks run in when they go to Codex cloud (its label or id). */
export async function setCodexEnvAction(projectId: string, env: string | null): Promise<Result> {
  await guard();
  const value = env?.trim() || null;
  const problem = value && repo.codexEnvProblem(value);
  if (problem) return { ok: false, error: problem };
  if (!(await repo.getProject(projectId))) return { ok: false, error: "Project not found" };
  await repo.updateProject(projectId, { codexEnv: value });
  return done();
}

/** Planning settings, stored with the account. */
export async function updateSettingsAction(patch: Partial<Settings>) {
  await guard();
  await repo.setSettings(patch);
  return done();
}

const TERMINAL_IDS = new Set<TerminalId>(["wt", "cmd", "terminal", "iterm"]);

/** How sessions start on this computer; only its own window changes it. */
export async function updateDeviceSettingsAction(patch: {
  name?: string; terminal?: TerminalId; claudeCommand?: string; codexCommand?: string; remoteStart?: RemoteStart;
}): Promise<Result> {
  await guard();
  if (MODE !== "desktop") return { ok: false, error: "These are set in the PacedMind desktop app." };
  for (const command of [patch.claudeCommand, patch.codexCommand]) {
    const problem = command === undefined ? null : commandProblem(command);
    if (problem) return { ok: false, error: problem };
  }
  if (patch.terminal && !TERMINAL_IDS.has(patch.terminal)) return { ok: false, error: "Unknown terminal" };
  if (patch.remoteStart && !["off", "ask", "auto"].includes(patch.remoteStart)) return { ok: false, error: "Unknown setting" };
  const name = patch.name?.trim().slice(0, 80);
  updateDevice({
    ...(name ? { name } : {}),
    ...(patch.terminal ? { terminal: patch.terminal } : {}),
    ...(patch.claudeCommand ? { claudeCommand: patch.claudeCommand.trim() } : {}),
    ...(patch.codexCommand ? { codexCommand: patch.codexCommand.trim() } : {}),
    ...(patch.remoteStart ? { remoteStart: patch.remoteStart } : {}),
  });
  const id = deviceConfig().deviceId;
  if (id && (name || patch.remoteStart)) await repo.updateDeviceRow(id, { name, remoteStart: patch.remoteStart });
  // A new command can find a different tool: look again.
  if (patch.claudeCommand || patch.codexCommand) void checkThisDevice(mcpUrl()).catch(() => {});
  return done({ ok: true, message: "Saved" });
}

/** A new owner token: agents set up with the old one lose access until you connect them again. */
export async function rotateMcpTokenAction(): Promise<Result> {
  await guard();
  if (MODE !== "desktop") return { ok: false, error: "Agents connect to the PacedMind desktop app." };
  rotateOwnerToken();
  void checkThisDevice(mcpUrl()).catch(() => {});
  return done({ ok: true, message: "New token made. Connect your agents again." });
}

/* ---------- this computer's agents, and importing projects ---------- */

/** Looks for Claude Code and Codex on this computer again. */
export async function checkDeviceAction(): Promise<Result> {
  await guard();
  if (MODE !== "desktop") return { ok: false, error: "Each computer looks for its agents in its desktop app." };
  await checkThisDevice(mcpUrl());
  return done({ ok: true, message: `Checked ${deviceConfig().name}` });
}

/**
 * Sets an agent up to reach this PacedMind with your token from sessions PacedMind doesn't configure itself (its
 * desktop app, a terminal you opened): Claude Code for all projects, Codex in its config.toml.
 */
export async function connectAgentAction(agent: AgentId): Promise<Result> {
  await guard();
  if (MODE !== "desktop") return { ok: false, error: "Agents connect to the PacedMind desktop app." };
  if (agent !== "claude" && agent !== "codex") return { ok: false, error: "Unknown agent" };
  const r = agent === "claude" ? connectClaudeCode() : connectCodex();
  await checkThisDevice(mcpUrl());
  return done(r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
}

/** Folders you work in with Claude Code and Codex on this computer, for the import. */
export async function findProjectsAction(): Promise<FoundProject[]> {
  await guard();
  if (MODE !== "desktop") return [];
  return findProjects();
}

export async function importProjectsAction(items: ImportItem[], areaId: string): Promise<Result> {
  await guard();
  if (MODE !== "desktop") return { ok: false, error: "Import from the desktop app on the computer with the folders." };
  if (!(await repo.listAreas()).some((a) => a.id === areaId)) return { ok: false, error: "Pick an area for the projects" };
  const { created, skipped } = await importProjects(items.filter((i) => i && typeof i.folder === "string" && typeof i.name === "string"), areaId);
  updateDevice({ importOffered: true });
  const made = created.length === 1 ? `Added ${created[0].name}` : `Added ${created.length} projects`;
  return done(created.length
    ? { ok: true, message: skipped.length ? `${made}. Skipped ${skipped.join(", ")}.` : made }
    : { ok: false, error: skipped.length ? `Couldn't add ${skipped.join(", ")}` : "Pick a project to add" });
}

/** The import opens by itself once on each computer; after that it's in Settings. */
export async function dismissImportAction(): Promise<Result> {
  await guard();
  if (MODE === "desktop") updateDevice({ importOffered: true });
  return done();
}

/* ---------- data ---------- */

export async function resetDataAction(mode: "sample" | "empty") {
  await guard();
  await resetAccount(mode);
  return done();
}

/** Brings the data PacedMind kept on this computer before accounts into the signed-in account. */
export async function importLegacyAction(): Promise<Result> {
  await guard();
  if (MODE !== "desktop") return { ok: false, error: "Import from the desktop app that has the data." };
  try {
    const n = await importLegacy();
    return done({ ok: true, message: `Imported ${n.tasks} tasks, ${n.projects} projects and ${n.areas} areas` });
  } catch (e) {
    return { ok: false, error: errorOf(e) };
  }
}
