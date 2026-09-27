import "server-only";
import * as repo from "./repo";
import type { StoredImage } from "./attachments";
import { revokeSessionTokens } from "./device";
import { afterDone, afterFinished, afterFlowOn } from "./flow";
import { changesSurfaceProblem, forgetSessionFiles, reopenForChanges, reopenProblem, startSession, type LaunchResult } from "./launcher";
import { MODE } from "./supabase";
import { nowStamp } from "@/lib/dates";
import { GRID, NODE_H, freeSpot, layoutFlow } from "@/lib/flow-layout";
import {
  AGENT_LABEL, LIVE_STATUSES, isLiveSession,
  type AgentId, type Project, type Report, type ReportCriterion, type ReportOutcome, type Session, type Task,
} from "@/lib/types";

/* Operations shared by the Server Actions (the UI) and the MCP tools, so both behave the same. */

/**
 * Call after a task's status became done: its finished sessions count as reviewed, and flows may start the sessions
 * that waited for it. A cloud session never reports back, so marking its task done ends it too.
 */
export async function afterTaskDone(taskId: number): Promise<LaunchResult[]> {
  const finished = await repo.listSessions({ taskId, status: ["finished"] });
  for (const s of finished) {
    await repo.updateSession(s.id, { status: "done" });
    await repo.addSessionEvent(s.id, "done", "You marked it done");
  }
  for (const s of await repo.listSessions({ taskId, surface: "cloud", status: LIVE_STATUSES })) {
    await repo.updateSession(s.id, { status: "done", finishedAt: nowStamp() });
    await repo.addSessionEvent(s.id, "done", "You marked it done");
  }
  // Their agents are done with PacedMind.
  if (MODE === "desktop") {
    revokeSessionTokens(finished.map((s) => s.id));
    forgetSessionFiles(finished.map((s) => s.id));
  }
  return afterDone(taskId);
}

/** The session an agent works in on a task: the one it names, else the task's running one. */
export async function activeSession(taskId: number, sessionId?: string | null): Promise<Session | null> {
  if (sessionId) {
    const s = await repo.getSession(sessionId);
    if (s && s.taskId === taskId) return s;
  }
  return (await repo.listSessions({ taskId, status: LIVE_STATUSES }))[0] ?? null;
}

/** What an agent hands back with finish_task besides its summary (the note). The images are already stored. */
export interface HandBack {
  outcome: ReportOutcome;
  details?: string;
  criteria?: ReportCriterion[];
  verify?: string[];
  questions?: string[];
  links?: { label: string; url: string }[];
  followUps?: string[];
  images?: { img: StoredImage; caption?: string }[];
}

/**
 * The work on a task is finished and waits for your check: its session and the task say so, and the flow starts
 * what waited for it. A "same session" connection continues in the same session when the agent reported it (`by`
 * "agent"); when you or the cloud's status said so, that task starts in a new session instead. An agent's hand-back
 * comes with a report; when that says the work is partial or blocked, the flow waits for you. `session` is the
 * session to finish when the caller already knows it (a session token's own).
 */
export async function finishTask(
  taskId: number, sessionId: string | null, note: string, by: "agent" | "you" | "cloud", report?: HandBack, session?: Session | null,
): Promise<{ session: Session | null; continueWith: Task | null; continued: Session | null; started: LaunchResult[] }> {
  const s = session === undefined ? await activeSession(taskId, sessionId) : session;
  if (s) {
    await repo.updateSession(s.id, { status: "finished", finishedAt: nowStamp(), note: note.slice(0, 2000) || null });
    await repo.addSessionEvent(s.id, "finished", (by === "you" ? `You marked it finished${note ? `: ${note}` : ""}` : note).slice(0, 2000));
    if (report) {
      const { images = [], ...fields } = report;
      const reportId = await repo.createReport({ sessionId: s.id, taskId, summary: note, ...fields });
      for (const x of images) await repo.addAttachment(x.img, { taskId, sessionId: s.id, reportId, caption: x.caption });
    }
  }
  await repo.updateTask(taskId, { status: "review" });
  if (report && report.outcome !== "done") return { session: s, continueWith: null, continued: null, started: [] };
  const { continueWith, started } = await afterFinished(taskId);
  let continued: Session | null = null;
  if (continueWith && by === "agent" && s && s.surface !== "cloud") {
    continued = await repo.createSession({
      taskId: continueWith.id, agent: s.agent, surface: s.surface, deviceId: s.deviceId, folder: s.folder, status: "running",
      cliSessionId: s.cliSessionId, continuesSessionId: s.id,
    });
    await repo.addSessionEvent(continued.id, "started", `Continues session ${s.id} in the same ${s.surface === "desktop" ? "app session" : "terminal"}`);
    await repo.updateTask(continueWith.id, { status: "progress" });
  } else if (continueWith) {
    started.push(await startSession(continueWith.id, { agent: s?.agent, reason: "flow" }));
  }
  return { session: s, continueWith: continued ? continueWith : null, continued, started };
}

/** "Started WRK-3 in Claude Code" lines for sessions a flow started. */
export async function startedLines(started: LaunchResult[]): Promise<string[]> {
  const lines: string[] = [];
  for (const r of started) {
    if (r.ok && r.session) lines.push(`PacedMind started ${(await repo.getTask(r.session.taskId))?.key} in a new ${AGENT_LABEL[r.session.agent]} session.`);
  }
  return lines;
}

/**
 * Saves a project. Switching its flow on (only the desktop app's own window can) starts the sessions it would have
 * started while it was off.
 */
export async function saveProject(id: string, patch: Partial<Omit<Project, "id">>): Promise<LaunchResult[]> {
  const wasOn = (await repo.getProject(id))?.flowOn;
  await repo.updateProject(id, patch);
  return patch.flowOn && !wasOn ? afterFlowOn(id) : [];
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

/**
 * Why the user can't send changes to this session's agent right now, or null, from what the caller already has:
 * the session's task, whether the task has a running session, and its newest report. `where` "here" (the default):
 * whether this computer can reopen it itself; "remote": whether a request to the computer the session ran on can
 * (the web app, or another computer's session), which that computer checks again with "here". The app offers
 * Request changes only where this is null, so the button and requestChanges agree.
 */
export function changesProblemIn(
  s: Session, ctx: { task: Task | null | undefined; live: boolean; newest: Report | null | undefined }, where: "here" | "remote" = "here",
): string | null {
  if (s.status !== "finished" && s.status !== "done") return "The agent hasn't handed this task back yet";
  const task = ctx.task;
  if (!task) return "The task is gone";
  if (task.agent === "human") return `${task.key} is marked as yours. Hand it to Claude Code or Codex first.`;
  if (ctx.live) return "This task already has a running session";
  const elsewhere = where === "here"
    ? reopenProblem(s)
    : (changesSurfaceProblem(s) ?? (s.deviceId ? null : "This session didn't run on a computer of your account, so there's nowhere to send the changes."));
  if (elsewhere) return elsewhere;
  // The agent reads the changes with the task's latest report (start_task), so they can only go on that one.
  if (ctx.newest && ctx.newest.sessionId !== s.id) return `${task.key} has a newer report. Ask for the changes on that one.`;
  return null;
}

/**
 * The computer to send changes to for a session that can't take them from here (the web app, another computer's
 * session), or null: when this computer can reopen it itself, or nobody can.
 */
export function changesViaIn(s: Session, ctx: { task: Task | null | undefined; live: boolean; newest: Report | null | undefined }): string | null {
  if (!s.deviceId || !changesProblemIn(s, ctx) || changesProblemIn(s, ctx, "remote")) return null;
  return s.deviceId;
}

/** changesProblemIn for one session, looking up what it needs. */
export async function changesProblem(s: Session, where: "here" | "remote" = "here"): Promise<string | null> {
  const [task, live, newest] = await Promise.all([
    repo.getTask(s.taskId), repo.listSessions({ taskId: s.taskId, status: LIVE_STATUSES }), repo.latestReport(s.taskId),
  ]);
  return changesProblemIn(s, { task, live: live.length > 0, newest }, where);
}

/**
 * The user read an agent's hand-back and wants changes. They go on the session's last report, where start_task
 * finds them, and the session reopens in a new terminal: Claude Code continues its conversation, Codex starts
 * a new one. The task goes back to in progress, also when it was already marked done. From the desktop app's own
 * window, or a request you allowed there (an agent's request_changes waits for you, see requests.ts).
 */
export async function requestChanges(sessionId: string, changes: string): Promise<LaunchResult> {
  const text = changes.trim().slice(0, 20000);
  const s = await repo.getSession(sessionId);
  if (!s) return { ok: false, error: "Session not found" };
  if (!text) return { ok: false, error: "Write what should change" };
  const problem = await changesProblem(s);
  if (problem) return { ok: false, error: problem };
  // Hand-backs from before reports existed only left a note; it becomes their report.
  const report = await repo.latestSessionReport(s.id);
  const reportId = report?.id ?? await repo.createReport({
    sessionId: s.id, taskId: s.taskId, outcome: "done", summary: (s.note || "Handed back without a report").slice(0, 2000),
    createdAt: s.finishedAt ?? undefined,
  });
  // Written before the terminal opens, so the agent finds it however fast it starts; so is the session running
  // again, or the agent's first call would find it ended. The hand-back's time stays on its report.
  await repo.setReportChanges(reportId, text, nowStamp());
  await repo.updateSession(s.id, { status: "running", finishedAt: null, endedAt: null });
  const r = await reopenForChanges(s.id);
  if (!r.ok) {
    // Nothing changes when the terminal doesn't open: the request goes, and so does a report made for it.
    await repo.updateSession(s.id, { status: s.status, finishedAt: s.finishedAt, endedAt: s.endedAt });
    if (report) await repo.setReportChanges(reportId, report.changes ?? null, report.changesAt ?? null);
    else await repo.deleteReport(reportId);
    return r;
  }
  await repo.addSessionEvent(s.id, "changes_requested", `You asked for changes: ${text.length > 140 ? `${text.slice(0, 140).trimEnd()}…` : text}`);
  await repo.updateTask(s.taskId, { status: "progress" });
  return { ok: true, session: (await repo.getSession(s.id))!, message: r.message };
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
