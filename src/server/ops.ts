import "server-only";
import { tx } from "./db";
import * as repo from "./repo";
import type { StoredImage } from "./attachments";
import { afterDone, afterFinished, afterFlowOn } from "./flow";
import { reopenForChanges, startSession, type LaunchResult } from "./launcher";
import { nowStamp } from "@/lib/dates";
import { GRID, NODE_H, freeSpot, layoutFlow } from "@/lib/flow-layout";
import { AGENT_LABEL, type AgentId, type Project, type ReportCriterion, type ReportOutcome, type Session, type Task } from "@/lib/types";

/* Operations shared by the Server Actions (the UI) and the MCP tools, so both behave the same. */

/**
 * Call after a task's status became done: its finished sessions count as reviewed, and flows may
 * start the sessions that waited for it. A cloud session never reports back, so marking its task done ends it too.
 */
export function afterTaskDone(taskId: number): LaunchResult[] {
  for (const s of repo.listSessions("task_id = ? AND status = 'finished'", taskId)) {
    repo.updateSession(s.id, { status: "done" });
    repo.addSessionEvent(s.id, "done", "You marked it done");
  }
  for (const s of repo.listSessions("task_id = ? AND surface = 'cloud' AND status IN ('starting', 'running')", taskId)) {
    repo.updateSession(s.id, { status: "done", finishedAt: nowStamp() });
    repo.addSessionEvent(s.id, "done", "You marked it done");
  }
  return afterDone(taskId);
}

/** The session an agent works in on a task: the one it names, else the task's running one. */
export function activeSession(taskId: number, sessionId?: string | null): Session | null {
  if (sessionId) {
    const s = repo.getSession(sessionId);
    if (s && s.taskId === taskId) return s;
  }
  return repo.listSessions("task_id = ? AND status IN ('starting', 'running')", taskId)[0] ?? null;
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
 * comes with a report; when that says the work is partial or blocked, the flow waits for you.
 */
export function finishTask(taskId: number, sessionId: string | null, note: string, by: "agent" | "you" | "cloud", report?: HandBack): {
  session: Session | null; continueWith: Task | null; continued: Session | null; started: LaunchResult[];
} {
  const s = activeSession(taskId, sessionId);
  tx(() => {
    if (s) {
      repo.updateSession(s.id, { status: "finished", finishedAt: nowStamp(), note: note || null });
      repo.addSessionEvent(s.id, "finished", by === "you" ? `You marked it finished${note ? `: ${note}` : ""}` : note);
      if (report) {
        const { images = [], ...fields } = report;
        const reportId = repo.createReport({ sessionId: s.id, taskId, summary: note, ...fields });
        for (const x of images) repo.addAttachment(x.img, { taskId, sessionId: s.id, reportId, caption: x.caption });
      }
    }
    repo.updateTask(taskId, { status: "review" });
  });
  if (report && report.outcome !== "done") return { session: s, continueWith: null, continued: null, started: [] };
  const { continueWith, started } = afterFinished(taskId);
  let continued: Session | null = null;
  if (continueWith && by === "agent" && s?.surface !== "cloud") {
    continued = repo.createSession({
      taskId: continueWith.id, agent: s?.agent ?? "claude", surface: s?.surface ?? "terminal", deviceId: s?.deviceId ?? null,
      folder: s?.folder ?? null, status: "running", cliSessionId: s?.cliSessionId ?? null, continuesSessionId: s?.id ?? null,
    });
    repo.addSessionEvent(continued.id, "started", `Continues session ${s?.id ?? ""} in the same ${s?.surface === "desktop" ? "app session" : "terminal"}`);
    repo.updateTask(continueWith.id, { status: "progress" });
  } else if (continueWith) {
    started.push(startSession(continueWith.id, { agent: s?.agent }));
  }
  return { session: s, continueWith: continued ? continueWith : null, continued, started };
}

/** "Started WRK-3 in Claude Code" lines for sessions a flow started. */
export function startedLines(started: LaunchResult[]): string[] {
  return started.flatMap((r) =>
    r.ok && r.session ? [`PacedMind started ${repo.getTask(r.session.taskId)?.key} in a new ${AGENT_LABEL[r.session.agent]} session.`] : []);
}

/** Saves a project. Switching its flow on starts the sessions it would have started while it was paused. */
export function saveProject(id: string, patch: Partial<Omit<Project, "id">>): LaunchResult[] {
  const wasOn = repo.getProject(id)?.flowOn;
  repo.updateProject(id, patch);
  return patch.flowOn && !wasOn ? afterFlowOn(id) : [];
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

/**
 * The user read an agent's hand-back and wants changes. They go on the session's last report, where start_task
 * finds them, and the session reopens in a new terminal: Claude Code continues its conversation, Codex starts
 * a new one. The task goes back to in progress, also when it was already marked done.
 */
export function requestChanges(sessionId: string, changes: string): LaunchResult {
  const text = changes.trim();
  const s = repo.getSession(sessionId);
  if (!s) return { ok: false, error: "Session not found" };
  if (!text) return { ok: false, error: "Write what should change" };
  if (s.status !== "finished" && s.status !== "done") return { ok: false, error: "The agent hasn't handed this task back yet" };
  const task = repo.getTask(s.taskId);
  if (task?.agent === "human") return { ok: false, error: `${task.key} is marked as yours. Hand it to Claude Code or Codex first.` };
  if (repo.listSessions("task_id = ? AND status IN ('starting', 'running')", s.taskId).length) {
    return { ok: false, error: "This task already has a running session" };
  }
  // Hand-backs from before reports existed only left a note; it becomes their report.
  const report = repo.latestSessionReport(s.id);
  const reportId = report?.id ?? repo.createReport({
    sessionId: s.id, taskId: s.taskId, outcome: "done", summary: s.note || "Handed back without a report", createdAt: s.finishedAt ?? undefined,
  });
  // Written before the terminal opens, so the agent finds it however fast it starts.
  repo.setReportChanges(reportId, text, nowStamp());
  const r = reopenForChanges(s.id);
  if (!r.ok) {
    repo.setReportChanges(reportId, report?.changes ?? null, report?.changesAt ?? null);
    return r;
  }
  tx(() => {
    repo.updateSession(s.id, { status: "running", endedAt: null });
    repo.addSessionEvent(s.id, "changes_requested", `You asked for changes: ${text.length > 140 ? `${text.slice(0, 140).trimEnd()}…` : text}`);
    repo.updateTask(s.taskId, { status: "progress" });
  });
  return { ok: true, session: repo.getSession(s.id)! };
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
