"use server";

import { refresh } from "next/cache";
import * as repo from "@/server/repo";
import { importLegacy, resetAccount } from "@/server/account";
import { usesCloud } from "@/server/scope";
import { resetLocal } from "@/server/store/local-db";
import { checkThisDevice, deviceIdFor, offeredDevice, runsHere } from "@/server/devices";
import { mcpUrl, resumeSession, startSession, type LaunchResult } from "@/server/launcher";
import {
  afterTaskDone, changesProblem, closeSession, edgeWouldLoop, finishTask, keepYoursOutOfFlow, removeFromFlow, requestChanges, saveProject,
} from "@/server/ops";
import { approve, deny } from "@/server/requests";
import { commandProblem, deviceConfig, rotateOwnerToken, updateDevice } from "@/server/device";
import { folderProblem } from "@/server/folders";
import { connectClaudeCode, connectCodex } from "@/server/connect";
import { findProjects, importProjects, type FoundProject, type ImportItem } from "@/server/import";
import { STEP_UP_REFUSED, codeFreshUntil, refusedStepUp, verifyCode } from "@/server/step-up";
import { MODE, readAuthState, supabase } from "@/server/supabase";
import { guardAction as guard } from "@/server/guard";
import { addDaysStr, dateOnly, dayDiff, parseLocal, timeOf, toDateTimeStr } from "@/lib/dates";
import {
  LIVE_STATUSES, deviceOnline, isLiveSession,
  type AgentId, type Device, type EdgeMode, type LaunchRequestKind, type Project, type RemoteStart, type Settings, type Surface, type TerminalId,
} from "@/lib/types";

type Result = { ok: boolean; error?: string; message?: string };

function done<T extends Result = Result>(r: T = { ok: true } as T): T {
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

/** A real local date and time, "YYYY-MM-DDTHH:mm". */
const isStamp = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) && toDateTimeStr(parseLocal(s)) === s;

/**
 * Changes an activity from one of its days: `occurrence` is the start it had there. A weekly activity changes every
 * week. Moved to another day, the whole series moves by as many days and keeps its first week; made one-off, it
 * stays only on the day the change gives it.
 */
export async function updateEventAction(id: number, occurrence: string, input: { title: string; areaId: string | null; start: string; end: string; weekly: boolean }) {
  await guard();
  const e = await repo.getEvent(id);
  if (!e) return { ok: false, error: "That activity is no longer in the calendar" };
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "Give the activity a title" };
  if (title.length > 200) return { ok: false, error: "Keep the title under 200 characters" };
  if (!isStamp(occurrence) || !isStamp(input.start) || !isStamp(input.end)) return { ok: false, error: "That isn't a day and time" };
  if (dateOnly(input.end) !== dateOnly(input.start)) return { ok: false, error: "An activity starts and ends on the same day" };
  if (input.end <= input.start) return { ok: false, error: "The end has to be after the start" };
  let { start, end } = input;
  if (e.recurrence === "weekly" && input.weekly) {
    const first = addDaysStr(e.start, dayDiff(occurrence, start));
    start = `${first}T${timeOf(start)}`;
    end = `${first}T${timeOf(end)}`;
  }
  await repo.updateEvent(id, { title, areaId: input.areaId ?? null, start, end, recurrence: input.weekly ? "weekly" : null });
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
 * What start, resume and changes answer when they can't run on this computer (the web app has none, and a task or
 * session can belong to another computer): `remote`, with the computer to offer (`deviceId`, null when there's none to
 * suggest) and whether it's the only one that can take it (`pinned`: the task or its project names it, or the session
 * ran there). The page then asks that computer with a fresh two-factor code: requestSessionAction,
 * requestResumeAction or requestChangesRemoteAction.
 */
type Remote = { remote?: boolean; deviceId?: string | null; pinned?: boolean };

/**
 * What a request to a computer answers: the request's id once sent (it shows in /api/state's `requests`), and
 * `needCode` when it needs a current two-factor code first (none was given, and none was entered in the last four
 * minutes), or the one given didn't do.
 */
type Requested = Result & { requestId?: string; needCode?: boolean };

/**
 * Starts a session: in the desktop app, where the task says (a terminal or the agent's app here, or its cloud).
 * The web app can't start anything, and a task that runs on another computer starts there: both answer `remote`,
 * offering the computer the task names, else its project's, else the account's default.
 */
export async function startSessionAction(taskId: number, agent?: AgentId | null, surface?: Surface): Promise<Result & Remote> {
  await guard();
  if (surface && !SURFACES.has(surface)) return { ok: false, error: "Unknown place to run the session" };
  const task = await repo.getTask(taskId);
  if (!task) return { ok: false, error: "Task not found" };
  const project = task.projectId ? await repo.getProject(task.projectId) : null;
  if (MODE === "web") {
    return { ok: false, remote: true, ...offeredDevice(task, project, await repo.listDevices()), error: "Choose a computer to start it on." };
  }
  const runsOn = deviceIdFor(task.deviceId, project?.deviceId);
  if (runsOn && !runsHere(runsOn)) return { ok: false, remote: true, deviceId: runsOn, pinned: true, error: `${task.key} runs on another computer.` };
  const r = await startSession(taskId, { agent: agent ?? undefined, surface, reason: "you" });
  return done(r.ok ? { ok: true, message: r.message ?? "Session started" } : { ok: false, error: r.error });
}

/**
 * The computer a request goes to, when it's signed in and takes requests (its setting as it last said: the computer
 * decides for itself when the request arrives).
 */
async function requestTarget(deviceId: string | null | undefined): Promise<Device | string> {
  if (!(await usesCloud())) return "Sign in to PacedMind Cloud to use your other computers.";
  const device = deviceId ? await repo.getDevice(deviceId) : null;
  if (!device || device.revokedAt) return "That computer isn't signed in to PacedMind anymore.";
  if (device.remoteStart === "off") return `${device.name} doesn't take sessions from elsewhere. Change that in its Settings.`;
  return device;
}

/**
 * The fresh two-factor code a request to a computer needs: `code` when given, else one this session entered in the
 * last four minutes. The database checks the code's time and authenticator either way. Null when the request can go.
 */
async function stepUp(code: string | null | undefined): Promise<Requested | null> {
  if (code?.trim()) {
    const wrong = await verifyCode(await supabase(), code);
    return wrong ? { ok: false, error: wrong, needCode: true } : null;
  }
  const until = codeFreshUntil(await readAuthState());
  return until && until > Date.now() ? null : { ok: false, error: "Enter a current two-factor code.", needCode: true };
}

/** What the computer does with a request, as its setting last said, for the message after sending it. */
function sentMessage(device: Device, kind: LaunchRequestKind, asks: boolean): string {
  const now = asks
    ? { start: "allow it there to start", resume: "allow it there to resume the session", changes: "allow it there to send the changes" }[kind]
    : { start: "it starts within seconds", resume: "it opens within seconds", changes: "the agent gets your changes within seconds" }[kind];
  const away = deviceOnline(device) ? "" : ` It hasn't been online in the last few minutes; the request waits there for 10 minutes.`;
  return `Sent to ${device.name}: ${now}.${away}`;
}

/** Sends a request, after its fresh code. */
async function sendRequest(input: repo.LaunchRequestInput, device: Device, code: string, asks: boolean): Promise<Requested> {
  const stale = await stepUp(code);
  if (stale) return stale;
  try {
    const r = await repo.createLaunchRequest(input);
    return done({ ok: true, requestId: r.id, message: sentMessage(device, input.kind ?? "start", asks) });
  } catch (e) {
    const message = errorOf(e);
    if (!refusedStepUp(message)) return { ok: false, error: message };
    // A code from an authenticator added in this session doesn't count (SECURITY.md), and neither does an old one.
    return { ok: false, needCode: true, error: (code ?? "").trim() ? STEP_UP_REFUSED : "Enter a current two-factor code." };
  }
}

/**
 * Asks a computer to start a session for a task, where the task says or on `surface`. Needs a fresh two-factor code:
 * `code`, or "" to use one entered in the last four minutes. A task or project that names its computer starts only
 * there, so another computer is refused here already.
 */
export async function requestSessionAction(
  taskId: number, agent: AgentId, deviceId: string, code: string, surface?: Surface | null,
): Promise<Requested> {
  await guard();
  if (agent !== "claude" && agent !== "codex") return { ok: false, error: "Choose Claude Code or Codex." };
  if (surface && !SURFACES.has(surface)) return { ok: false, error: "Unknown place to run the session" };
  const task = await repo.getTask(taskId);
  if (!task) return { ok: false, error: "Task not found" };
  if (task.agent === "human") return { ok: false, error: `${task.key} is marked as yours. Hand it to Claude Code or Codex first.` };
  if ((await repo.listSessions({ taskId, status: LIVE_STATUSES })).length) return { ok: false, error: `${task.key} already has a running session` };
  const device = await requestTarget(deviceId);
  if (typeof device === "string") return { ok: false, error: device };
  const project = task.projectId ? await repo.getProject(task.projectId) : null;
  const named = deviceIdFor(task.deviceId, project?.deviceId);
  if (named && named !== device.id) {
    const other = await repo.getDevice(named);
    return { ok: false, error: `${task.key} runs on ${other?.name ?? "another computer"}. Send it there, or pick another computer in its details.` };
  }
  // A session in the agent's cloud always waits for you on the computer, whatever its setting.
  const asks = device.remoteStart !== "auto" || (surface ?? task.runIn) === "cloud";
  return sendRequest({ deviceId: device.id, taskId, agent, via: MODE === "web" ? "web" : "desktop", kind: "start", surface: surface ?? null }, device, code, asks);
}

/**
 * Picks a session up again where it ran, or in the desktop app (`surface` "desktop"). From the web app, and for a
 * session that ran on another computer, it answers `remote` with that computer (a cloud session can be pulled in on any
 * computer from its desktop app, and from the web app on the one that sent it).
 */
export async function resumeSessionAction(sessionId: string, surface?: Surface): Promise<Result & Remote> {
  await guard();
  if (surface && !SURFACES.has(surface)) return { ok: false, error: "Unknown place to open the session" };
  const s = await repo.getSession(sessionId);
  if (!s) return { ok: false, error: "Session not found" };
  if (MODE === "web" || (s.surface !== "cloud" && !runsHere(s.deviceId))) {
    if (!s.deviceId) return { ok: false, error: "This session didn't run on a computer of your account, so it can't be resumed from here." };
    return { ok: false, remote: true, deviceId: s.deviceId, pinned: true, error: "Resume it on the computer it ran on." };
  }
  const r = await resumeSession(sessionId, surface);
  return done(r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
}

/**
 * Asks the computer a session ran on to pick it up again: where it ran, or with `surface` "desktop" a Claude Code
 * conversation moves from its terminal into the Claude app. Needs a fresh code, like requestSessionAction.
 */
export async function requestResumeAction(sessionId: string, code: string, surface?: Surface | null): Promise<Requested> {
  await guard();
  if (surface === "cloud" || (surface && !SURFACES.has(surface))) return { ok: false, error: "A session resumes where it ran, or in the Claude app." };
  const s = await repo.getSession(sessionId);
  if (!s) return { ok: false, error: "Session not found" };
  if (!(await repo.getTask(s.taskId))) return { ok: false, error: "The task is gone" };
  if (!s.deviceId) return { ok: false, error: "This session didn't run on a computer of your account, so it can't be resumed from here." };
  const to = surface === "desktop" ? "desktop" : null;
  if (!to && s.surface === "terminal" && isLiveSession(s)) {
    return { ok: false, error: "That session is still running in its terminal. Close it in PacedMind first if its terminal is gone." };
  }
  const device = await requestTarget(s.deviceId);
  if (typeof device === "string") return { ok: false, error: device };
  // Pulling a cloud session in runs its work on the computer, so that always waits for you there.
  const asks = device.remoteStart !== "auto" || s.surface === "cloud";
  return sendRequest({
    deviceId: device.id, taskId: s.taskId, agent: s.agent, via: MODE === "web" ? "web" : "desktop", kind: "resume", targetSessionId: s.id, surface: to,
  }, device, code, asks);
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

/**
 * Sends a hand-back back to its agent with what should change. It reopens in a new terminal here. From the web app, and
 * for a session that ran on another computer, it answers `remote` with that computer (requestChangesRemoteAction).
 */
export async function requestChangesAction(sessionId: string, changes: string): Promise<Result & Remote> {
  await guard();
  const s = await repo.getSession(sessionId);
  if (!s) return { ok: false, error: "Session not found" };
  if (MODE === "web" || !runsHere(s.deviceId)) {
    const problem = await changesProblem(s, "remote");
    if (problem) return { ok: false, error: problem };
    return { ok: false, remote: true, deviceId: s.deviceId, pinned: true, error: "Send the changes to the computer the session ran on." };
  }
  const r = await requestChanges(sessionId, changes);
  return done(r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error });
}

/**
 * Asks the computer a session ran on to send it back to its agent with `text` (trimmed, 1 to 20,000 characters): its
 * terminal reopens there and the agent reads the changes through start_task. Needs a fresh code, like
 * requestSessionAction. Only terminal sessions take changes; the apps and the cloud take them where they run.
 */
export async function requestChangesRemoteAction(sessionId: string, text: string, code: string): Promise<Requested> {
  await guard();
  const changes = (text ?? "").trim();
  if (!changes) return { ok: false, error: "Write what should change" };
  if (changes.length > 20000) return { ok: false, error: "Keep the changes under 20,000 characters." };
  const s = await repo.getSession(sessionId);
  if (!s) return { ok: false, error: "Session not found" };
  const problem = await changesProblem(s, "remote");
  if (problem) return { ok: false, error: problem };
  const device = await requestTarget(s.deviceId);
  if (typeof device === "string") return { ok: false, error: device };
  return sendRequest({
    deviceId: device.id, taskId: s.taskId, agent: s.agent, via: MODE === "web" ? "web" : "desktop", kind: "changes", targetSessionId: s.id, changes,
  }, device, code, device.remoteStart !== "auto");
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
  const name = patch.name === undefined ? undefined : repo.cleanDeviceName(patch.name);
  updateDevice({
    ...(name ? { name } : {}),
    ...(patch.terminal ? { terminal: patch.terminal } : {}),
    ...(patch.claudeCommand ? { claudeCommand: patch.claudeCommand.trim() } : {}),
    ...(patch.codexCommand ? { codexCommand: patch.codexCommand.trim() } : {}),
    ...(patch.remoteStart ? { remoteStart: patch.remoteStart } : {}),
  });
  const id = deviceConfig().deviceId;
  // The account's copy, for Settings elsewhere. What counts is saved above already: if the copy doesn't go through now
  // (offline, or just signed in again), the account sync sends it within a minute (requests.ts).
  if (id && (name || patch.remoteStart)) await repo.updateDeviceRow(id, { name, remoteStart: patch.remoteStart }).catch(() => {});
  // A new command can find a different tool: look again.
  if (patch.claudeCommand || patch.codexCommand) void checkThisDevice(mcpUrl()).catch(() => {});
  return done({ ok: true, message: "Saved" });
}

/* ---------- the account's computers ---------- */

/**
 * Renames one of the account's computers, from any signed-in window (the web app, any computer). This computer takes a
 * new name at once, another one within a minute. Without an account, it renames this computer (id "" or its own id).
 */
export async function renameDeviceAction(deviceId: string, name: string): Promise<Result> {
  await guard();
  const clean = repo.cleanDeviceName(name ?? "");
  if (!clean) return { ok: false, error: "Give the computer a name" };
  const here = MODE === "desktop" && (deviceId === deviceConfig().deviceId || (deviceId === "" && !(await usesCloud())));
  if (await usesCloud()) {
    try {
      await repo.renameDevice(deviceId, clean);
    } catch (e) {
      return { ok: false, error: errorOf(e) };
    }
  } else if (!here) {
    return { ok: false, error: "Without an account, PacedMind knows only this computer." };
  }
  if (here) updateDevice({ name: clean });
  return done({ ok: true, message: `Renamed to ${clean}` });
}

/** Makes a signed-in computer the account's default: sessions go there when neither the task nor its project names one. */
export async function setDefaultDeviceAction(deviceId: string): Promise<Result> {
  await guard();
  if (!(await usesCloud())) return { ok: false, error: "Without an account, this computer is the only one." };
  try {
    await repo.setDefaultDevice(deviceId);
  } catch (e) {
    return { ok: false, error: errorOf(e) };
  }
  return done({ ok: true, message: `${(await repo.getDevice(deviceId))?.name ?? "That computer"} is the default now` });
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

/** Starts the data in use over: the account's, or without an account this computer's own. */
export async function resetDataAction(mode: "sample" | "empty") {
  await guard();
  if (await usesCloud()) await resetAccount(mode);
  else resetLocal(mode);
  return done();
}

/** Copies this computer's own data (what PacedMind keeps without an account) into the signed-in account. */
export async function importLegacyAction(): Promise<Result> {
  await guard();
  if (MODE !== "desktop") return { ok: false, error: "Move it from the desktop app on the computer that has it." };
  if (!(await usesCloud())) return { ok: false, error: "Sign in to PacedMind Cloud first." };
  try {
    const n = await importLegacy();
    return done({ ok: true, message: `Moved ${n.tasks} tasks, ${n.projects} projects and ${n.areas} areas to your account` });
  } catch (e) {
    return { ok: false, error: errorOf(e) };
  }
}
