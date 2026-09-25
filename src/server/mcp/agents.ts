import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { ImageError, removeImageFiles, storeImage, type StoredImage } from "../attachments";
import { deviceConfig, moveSessionToken, revokeSessionTokens } from "../device";
import { nextReadyTask } from "../flow";
import { forgetSessionFiles, plannedFolder, plannedSurface } from "../launcher";
import { askForChanges, askFromAgent } from "../requests";
import {
  activeSession, changesProblem, closeSession, edgeWouldLoop, finishTask, flowNeedsTidy, placeInFlow, removeFromFlow, startedLines, tidyFlow,
} from "../ops";
import * as repo from "../repo";
import { callerSession } from "./principal";
import {
  AGENT_LABEL, APP_LABEL, CLOUD_LABEL, LIVE_STATUSES, STATUS_LABEL, SURFACE_LABEL, agentOf,
  type AgentId, type EdgeMode, type Report, type ReportCriterion, type Session, type Surface, type Task,
} from "@/lib/types";
import {
  agentSchema, dateTimeInput, describeTask, fail, findProject, findSession, findTask, imageLine, names, plural, projectRef, reportCounts,
  taskRef, tool, when,
} from "./common";

const MODE_OF = { auto: "auto", manual: "manual", same_session: "session", at_time: "time" } as const satisfies Record<string, EdgeMode>;
const MODE_TEXT: Record<EdgeMode, string> = {
  auto: "starts automatically when the previous task is finished",
  manual: "starts after the user marks the previous task done",
  session: "continues in the same terminal session as the previous task",
  time: "starts at a set time once the previous task is finished",
};
const modeName = (m: EdgeMode) => (m === "session" ? "same session" : m === "time" ? "at a set time" : m);

const SESSION_TEXT: Record<Session["status"], string> = {
  starting: "starting", running: "running", finished: "finished, waiting for the user's review", done: "reviewed and done",
  closed: "closed", failed: "failed",
};

/** The account's computers by id, for "on DESKTOP-1". */
const deviceNames = async () => new Map((await repo.listDevices()).map((d) => [d.id, d.name]));

/** "in a terminal on DESKTOP-1", "in the Claude app on DESKTOP-1" or "in Claude Code on the web". */
function placeText(agent: AgentId, surface: Surface, deviceId: string | null, devices: Map<string, string>): string {
  if (surface === "cloud") return `in ${CLOUD_LABEL[agent]}`;
  const on = deviceId ? ` on ${devices.get(deviceId) ?? "another computer"}` : "";
  return surface === "desktop" ? `in the ${APP_LABEL[agent]}${on}` : `in a terminal${on}`;
}

function sessionLine(s: Session, tasks: Map<number, Task>, reports: Map<string, Report[]>, devices: Map<string, string>): string {
  const t = tasks.get(s.taskId);
  const report = reports.get(s.id)?.[0] ?? null;
  // A session reopened for changes has been at work since the user asked for them.
  const working = (s.status === "starting" || s.status === "running") && report?.changesAt ? report.changesAt : null;
  const at = (working ?? s.finishedAt ?? s.endedAt ?? s.startedAt).replace("T", " ");
  const counts = report ? reportCounts(report) : "";
  return `Session ${s.id} · ${t ? `${t.key} ${t.title}` : `task #${s.taskId}`} · ${AGENT_LABEL[s.agent]} ${placeText(s.agent, s.surface, s.deviceId, devices)} · ` +
    `${SESSION_TEXT[s.status]} · ${at}${report && report.outcome !== "done" ? ` · handed back ${report.outcome}` : ""}` +
    `${s.note ? ` · ${s.note}` : ""}${counts ? ` (${counts})` : ""}`;
}

/** Session lines with their reports and computers looked up once. */
async function sessionLines(sessions: Session[], tasks: Map<number, Task>): Promise<string[]> {
  const [reports, devices] = await Promise.all([repo.reportsForSessions(sessions.map((s) => s.id)), deviceNames()]);
  return sessions.map((s) => sessionLine(s, tasks, reports, devices));
}

/** The agent that runs a task: its own, else the project's, else Claude Code. None for a task that is the user's own. */
const agentFor = async (t: Task): Promise<AgentId | null> => agentOf(t, t.projectId ? (await repo.getProject(t.projectId))?.agent : null);
const notYours = (t: Task) => {
  if (t.agent === "human") fail(`${t.key} is marked as the user's own task (human), so it stays out of flows and agent sessions. Ask the user before changing that with update_task.`);
};

/** Where a task's sessions run, in words. */
async function runsText(t: Task, devices: Map<string, string>): Promise<string> {
  const agent = (await agentFor(t)) ?? "claude";
  const project = t.projectId ? await repo.getProject(t.projectId) : null;
  return placeText(agent, plannedSurface(t, agent), t.deviceId ?? project?.deviceId ?? null, devices);
}

/**
 * The session a session token works in, checked against the task it names: a session PacedMind started can
 * only report on its own task (or the next one in the same terminal, which finish_task hands it).
 */
async function ownSession(t: Task, session?: string): Promise<Session | null> {
  const me = callerSession();
  if (!me) return null;
  const own = await repo.getSession(me.sessionId);
  // The token says which task it's for; the cloud's session row has to agree.
  if (!own || me.taskId !== t.id || own.taskId !== me.taskId || (session && session !== me.sessionId)) {
    const ownKey = own ? (await repo.getTask(own.taskId))?.key : null;
    fail(`This session works on ${ownKey ?? "another task"}${own ? ` (session ${own.id})` : ""}; it can only report on that task.`);
  }
  return own;
}

/**
 * The session an agent reports on: the one it names, else the one running, else the latest if it already
 * handed the task back (the user resumed it and asked for more).
 */
async function reportingSession(taskId: number, sessionId?: string | null): Promise<Session | null> {
  const s = await activeSession(taskId, sessionId);
  if (s) return s;
  const latest = await repo.latestSession(taskId);
  return latest?.status === "finished" ? latest : null;
}

/** A session for an agent that works on a task PacedMind didn't start (your own Claude Code or Codex). */
async function outsideSession(t: Task, agent?: AgentId): Promise<Session> {
  notYours(t);
  const s = await repo.createSession({
    taskId: t.id, agent: agent ?? (await agentFor(t)) ?? "claude", folder: plannedFolder(t), deviceId: deviceConfig().deviceId, status: "running",
  });
  await repo.addSessionEvent(s.id, "started", "Started outside PacedMind");
  return s;
}

/** Copies images into PacedMind. If one fails, none are kept, so the agent can fix the path and call again. */
function storeImages(images: { path: string; caption?: string }[], base: string | null): { img: StoredImage; caption?: string }[] {
  const stored: { img: StoredImage; caption?: string }[] = [];
  try {
    for (const x of images) stored.push({ img: storeImage(x.path, base), caption: x.caption });
    return stored;
  } catch (e) {
    removeImageFiles(stored.map((x) => x.img.file));
    if (e instanceof ImageError) fail(images.length > 1 ? `${e.message} Nothing was recorded; fix it and call again.` : e.message);
    throw e;
  }
}

const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Matches the agent's answers to the task's "Done when" items, by number or text. The report keeps each
 * item's text as it is now. Answers that match no item are kept too, as extra items the agent checked.
 */
function answerCriteria(t: Task, answers: { item: number | string; verdict: ReportCriterion["verdict"]; note?: string }[]): ReportCriterion[] {
  const out: ReportCriterion[] = t.doneWhen.map((text) => ({ text, verdict: null, note: "" }));
  for (const a of answers) {
    const ref = String(a.item).trim();
    let i: number;
    if (/^\d+$/.test(ref)) {
      i = Number(ref) - 1;
      if (i < 0 || i >= t.doneWhen.length) {
        fail(t.doneWhen.length
          ? `${t.key}'s Done when has ${plural(t.doneWhen.length, "item")}; there's no item ${ref}.`
          : `${t.key} has no Done when items. Pass the text of what you checked as item.`);
      }
    } else {
      i = t.doneWhen.findIndex((c) => norm(c) === norm(ref));
      if (i < 0) {
        const partial = t.doneWhen.map((c, k) => (norm(c).includes(norm(ref)) || norm(ref).includes(norm(c)) ? k : -1)).filter((k) => k >= 0);
        if (partial.length === 1) i = partial[0];
      }
    }
    const answer = { verdict: a.verdict, note: (a.note ?? "").trim() };
    if (i >= 0) out[i] = { ...out[i], ...answer };
    else if (ref) out.push({ text: ref, ...answer });
  }
  return out.slice(0, 50);
}

/** A session PacedMind started is done with PacedMind once it hands its task back: its token stops working. */
function releaseCaller() {
  const me = callerSession();
  if (me) {
    revokeSessionTokens([me.sessionId]);
    forgetSessionFiles([me.sessionId]);
  }
}

const taskMap = async () => new Map((await repo.listTasks()).map((t) => [t.id, t]));

export function registerAgentTools(server: McpServer) {
  /* ---------- flows ---------- */

  tool(server, "get_flow", {
    title: "Get project flow",
    description:
      "A project's flow: which tasks agent sessions work on, which agent runs each and where, and which task starts after which (and how). Also whether the flow may start sessions on its own.",
    input: z.object({ project: projectRef }),
    kind: "read",
  }, async ({ project }) => {
    const [n, devices] = await Promise.all([names(), deviceNames()]);
    const p = await findProject(project);
    const [tasks, edges] = await Promise.all([repo.listTasks({ projectId: p.id }), repo.listEdges()]);
    const inFlow = tasks.filter((t) => t.flowX !== null && t.flowY !== null).sort((a, b) => (a.flowY ?? 0) - (b.flowY ?? 0));
    const keyOf = new Map(tasks.map((t) => [t.id, t.key]));
    const next = [...n.projects.values()].filter((x) => x.afterProjectId === p.id);
    const lines = [
      `Flow for ${p.name} (id ${p.id}) · ${p.flowOn ? "on: sessions start on their own on this computer when their turn comes" : "off: nothing starts on its own (the user switches it on in PacedMind)"}`,
      p.afterProjectId ? `Starts after project ${n.project(p.afterProjectId)}.` : null,
      next.length ? `Then: ${next.map((x) => x.name).join(", ")}.` : null,
    ];
    for (const agent of ["claude", "codex"] as AgentId[]) {
      const runs = inFlow.filter((t) => agentOf(t, p.agent) === agent);
      if (!runs.length) continue;
      lines.push(`\nRun by ${AGENT_LABEL[agent]}:`);
      for (const t of runs) {
        const inc = edges.filter((e) => e.toTaskId === t.id);
        const how = inc.length
          ? `after ${inc.map((e) => `${keyOf.get(e.fromTaskId) ?? `#${e.fromTaskId}`} (${modeName(e.mode)}${e.mode === "time" && e.atTime ? ` ${e.atTime.replace("T", " ")}` : ""})`).join(", ")}`
          : "first, started by the user";
        lines.push(`- ${t.key} · ${STATUS_LABEL[t.status]} · ${t.title} · ${how} · runs ${await runsText(t, devices)}`);
      }
    }
    if (!inFlow.length) lines.push("\nNo tasks in the flow yet. connect_tasks or add_to_flow adds them.");
    const outside = tasks.filter((t) => t.flowX === null && t.status !== "done" && t.status !== "canceled");
    if (outside.length) lines.push(`\nOpen tasks not in the flow: ${outside.map((t) => t.key).join(", ")}`);
    const ready = await nextReadyTask(p.id);
    if (ready) lines.push(`Next ready task: ${ready.key} · ${ready.title}`);
    return lines.filter((l) => l !== null).join("\n");
  });

  tool(server, "connect_tasks", {
    title: "Connect tasks in a flow",
    description:
      "Make one task's agent session start after another's, within one project. Modes: auto (when the previous task is finished), manual (after the user marks it done), same_session (the same agent continues in the same terminal), at_time (at a set time once the previous one is finished). The mode is how the second task starts, so it applies to all its incoming connections. Tasks not yet in the flow are added to it. Call again to change the mode.",
    input: z.object({
      from: taskRef.describe("The task that comes first"),
      to: taskRef.describe("The task that starts after it"),
      mode: z.enum(["auto", "manual", "same_session", "at_time"]).optional().describe("Default auto"),
      at: dateTimeInput.optional().describe("For at_time: when the task may start"),
    }),
    kind: "write",
  }, async (args) => {
    const from = await findTask(args.from);
    const to = await findTask(args.to);
    if (from.id === to.id) fail("A task can't come after itself.");
    if (!from.projectId || from.projectId !== to.projectId) fail("Both tasks have to be in the same project; flows are per project.");
    if (await edgeWouldLoop(from.id, to.id)) fail(`${to.key} already leads to ${from.key}, so this would make a loop.`);
    notYours(from);
    notYours(to);
    const mode: EdgeMode = MODE_OF[args.mode ?? "auto"];
    const at = mode === "time" ? (args.at ? when(args.at, "required") : fail("at_time needs at, e.g. \"2026-09-26T09:00\".")) : null;
    const fromAgent = (await agentFor(from)) ?? "claude";
    if (from.flowX === null || from.flowY === null) await placeInFlow(from.id, fromAgent);
    // "Same session" continues in the previous task's terminal, so it runs with that task's agent.
    const toAgent = mode === "session" ? fromAgent : (await agentFor(to)) ?? "claude";
    if (to.flowX === null || to.flowY === null) await placeInFlow(to.id, toAgent, from.id);
    else if (toAgent !== (await agentFor(to))) await repo.updateTask(to.id, { agent: toAgent });
    // One session also runs in one place.
    if (mode === "session") await repo.updateTask(to.id, { runIn: from.runIn, deviceId: from.deviceId });
    await repo.createEdge(from.id, to.id, mode);
    await repo.setIncomingMode(to.id, mode, at);
    const project = (await repo.getProject(from.projectId))!;
    // Keep the canvas reading top to bottom when the new connection points up.
    if (await flowNeedsTidy(from.id, to.id)) await tidyFlow(project.id);
    return [
      `${from.key} → ${to.key}: ${to.key} ${MODE_TEXT[mode]}${at ? ` (${at.replace("T", " ")})` : ""}.`,
      project.flowOn ? null : `${project.name}'s flow is off, so nothing starts on its own. Only the user can switch it on, in PacedMind's Flows page, because it starts agents on their computer.`,
    ].filter(Boolean).join("\n");
  });

  tool(server, "disconnect_tasks", {
    title: "Disconnect tasks",
    description: "Remove the connection that makes one task start after another.",
    input: z.object({ from: taskRef, to: taskRef }),
    kind: "delete",
  }, async ({ from, to }) => {
    const a = await findTask(from);
    const b = await findTask(to);
    const edge = (await repo.listEdges()).find((e) => e.fromTaskId === a.id && e.toTaskId === b.id);
    if (!edge) fail(`${b.key} doesn't start after ${a.key}.`);
    await repo.deleteEdge(edge.id);
    return `${b.key} no longer starts after ${a.key}.`;
  });

  tool(server, "add_to_flow", {
    title: "Add task to flow",
    description: "Put a project task on the flow canvas, under the rest of the flow, so an agent session can work on it.",
    input: z.object({ task: taskRef, agent: agentSchema.optional().describe("Defaults to the task's or project's agent") }),
    kind: "write",
  }, async ({ task, agent }) => {
    const t = await findTask(task);
    if (!t.projectId) fail(`${t.key} isn't in a project. Flows belong to projects; move it into one first.`);
    notYours(t);
    const a = agent ?? (await agentFor(t)) ?? "claude";
    await placeInFlow(t.id, a);
    return `${t.key} is in ${(await names()).project(t.projectId)}'s flow, run by ${AGENT_LABEL[a]}.`;
  });

  tool(server, "remove_from_flow", {
    title: "Remove task from flow",
    description: "Take a task off the flow canvas together with its connections. The task itself stays.",
    input: z.object({ task: taskRef }),
    kind: "delete",
  }, async ({ task }) => {
    const t = await findTask(task);
    await removeFromFlow(t.id);
    return `${t.key} is no longer in the flow.`;
  });

  /* ---------- sessions ---------- */

  tool(server, "list_sessions", {
    title: "List agent sessions",
    description: "Agent sessions (Claude Code or Codex working on a task), newest first, with where they run and what they handed back. waiting means an agent finished and the user should review it.",
    input: z.object({
      status: z.enum(["waiting", "running", "all"]).optional().describe("Default all"),
      project: projectRef.optional(),
      task: taskRef.optional(),
      limit: z.number().int().min(1).max(200).optional().describe("Default 20"),
    }),
    kind: "read",
  }, async (args) => {
    const status = args.status === "waiting" ? ["finished" as const] : args.status === "running" ? LIVE_STATUSES : undefined;
    const task = args.task ? await findTask(args.task) : null;
    const project = args.project ? await findProject(args.project) : null;
    const tasks = await taskMap();
    const sessions = (await repo.listSessions({ status }))
      .filter((s) => (!task || s.taskId === task.id) && (!project || tasks.get(s.taskId)?.projectId === project.id));
    if (!sessions.length) return "No sessions match.";
    return (await sessionLines(sessions.slice(0, args.limit ?? 20), tasks)).join("\n");
  });

  tool(server, "start_session", {
    title: "Start agent session",
    description:
      "Ask to start Claude Code or Codex working on a task, where the task says unless `where` is given: in a terminal or the agent's desktop app on the user's computer, in the task's folder, or in the agent's cloud (Claude Code on the web, Codex cloud). Only when the user asks for it. The user allows it in the PacedMind app first; the request expires after 10 minutes.",
    input: z.object({
      task: taskRef,
      agent: agentSchema.optional(),
      where: z.enum(["terminal", "desktop", "cloud"]).optional()
        .describe("terminal, desktop (the Claude or Codex app, with the first message written for the user to send) or cloud"),
    }),
    kind: "launch",
  }, async ({ task, agent, where }) => {
    const t = await findTask(task);
    notYours(t);
    if ((await repo.listSessions({ taskId: t.id, status: LIVE_STATUSES })).length) fail(`${t.key} already has a running session.`);
    const a = (await askFromAgent(t, agent ?? (await agentFor(t)) ?? "claude", where)) ?? fail(`${t.key} can't run on this computer.`);
    return (
      `Asked the user to allow ${t.key} with ${AGENT_LABEL[a.agent]} (${SURFACE_LABEL[a.surface].toLowerCase()}): PacedMind shows the request in its window ` +
      "and a notification. It starts once they allow it (within 10 minutes). Tell the user to look at PacedMind; don't ask again." +
      (a.surface === "cloud" ? " Cloud sessions can't report back to PacedMind; the user marks the task finished or done." : "")
    );
  });

  tool(server, "close_session", {
    title: "Close agent session",
    description: "Mark a running session as closed, e.g. when its terminal was closed or it got stuck. The task goes back to Todo.",
    input: z.object({ session: z.string().describe("Session id from list_sessions") }),
    kind: "delete",
  }, async ({ session }) => {
    const s = await findSession(session);
    await closeSession(s.id);
    return (await sessionLines([(await repo.getSession(s.id))!], await taskMap()))[0];
  });

  tool(server, "request_changes", {
    title: "Request changes",
    description:
      "Ask to send work an agent handed back to the agent again, with what the user wants changed. Once the user allows it in the PacedMind app, the changes go on the agent's last report and its session reopens in a new terminal on the user's computer: Claude Code continues its conversation, Codex starts a new one that reads the report and the changes. The task goes back to in progress. Only when the user asks.",
    input: z.object({
      task: taskRef,
      changes: z.string().max(20000).describe("What should change, in the user's words. The agent reads it as written"),
    }),
    kind: "launch",
  }, async ({ task, changes }) => {
    const t = await findTask(task);
    const s = await repo.latestSession(t.id);
    if (!s || (s.status !== "finished" && s.status !== "done")) {
      fail(`${t.key} has no hand-back to send changes to${s ? `: its latest session is ${SESSION_TEXT[s.status]}` : ""}. start_session starts a new session.`);
    }
    if (!changes.trim()) fail("Write what should change.");
    const problem = await changesProblem(s);
    if (problem) fail(problem);
    const a = (await askForChanges(s, t, changes.trim())) ?? fail(`${t.key} can't run on this computer.`);
    return (
      `Asked the user to allow sending the changes to ${AGENT_LABEL[a.agent]} for ${t.key}: PacedMind shows the request in its window and a notification. ` +
      "Once they allow it (within 10 minutes), session " + s.id + " reopens in a new terminal and the task is in progress again. Tell the user to look at PacedMind; don't ask again."
    );
  });

  /* ---------- the session protocol for agents working on a task ---------- */

  tool(server, "get_next_task", {
    title: "Get next task",
    description: "The next task in a project that is ready to be worked on (the tasks it waits for are finished).",
    input: z.object({ project: projectRef }),
    kind: "read",
  }, async ({ project }) => {
    const p = await findProject(project);
    const t = await nextReadyTask(p.id);
    return t ? describeTask(t) : `Nothing in ${p.name} is ready right now.`;
  });

  tool(server, "start_task", {
    title: "Start task",
    description: "For agents: tell PacedMind you are starting work on a task. Returns the task and what to do when you finish.",
    input: z.object({
      task: taskRef,
      session: z.string().optional().describe("Session id given in your first message, if any"),
      agent: agentSchema.optional(),
    }),
    kind: "write",
  }, async ({ task, session, agent }) => {
    const t = await findTask(task);
    const s = (await ownSession(t, session)) ?? (callerSession() ? null : await activeSession(t.id, session)) ?? (await outsideSession(t, agent));
    await repo.updateSession(s.id, { status: "running" });
    await repo.addSessionEvent(s.id, "picked_up", `${AGENT_LABEL[s.agent]} read the task over MCP`);
    if (t.status !== "progress") await repo.updateTask(t.id, { status: "progress" });
    const after = (await repo.getTask(t.id))!;
    // A request for changes stays on the last report until the agent hands the task back again.
    const asked = await repo.latestReport(t.id);
    return [
      asked?.changes
        ? `The user reviewed your last hand-back and asked for changes (${(asked.changesAt ?? "").replace("T", " ")}):\n${asked.changes}\n\n` +
          "Make these changes first; your last report is at the end of the task below. Then hand the task back again with finish_task " +
          "and a new report whose summary starts with what you changed.\n"
        : null,
      await describeTask(after),
      `\nPacedMind session: ${s.id}`,
      `Work on this task here. When it is ready for the user to check, call finish_task with task ${t.key}, session ${s.id} and a report:`,
      "- summary: one or two sentences on what changed and what the user should look at first;",
      after.doneWhen.length ? "- criteria: your answer to each Done when item above (met, partly or not_met, with a short note on how you checked);" : null,
      "- images: screenshots of anything you changed that can be seen. Save each as a PNG, JPEG, GIF or WebP file and pass its path; attach_image adds them while you work;",
      "- verify: steps the user can follow to check the result, and questions: anything the user has to decide;",
      "- details: anything longer, in Markdown.",
      "If you can't finish, still call finish_task, with outcome partial or blocked, and say why. Do not mark the task done yourself.",
    ].filter((l) => l !== null).join("\n");
  });

  tool(server, "attach_image", {
    title: "Attach image",
    description:
      "For agents: add a screenshot or another image (PNG, JPEG, GIF or WebP, up to 20 MB) to the task you're working on, so the user sees it with your report. Save the image as a file first and pass its path; PacedMind keeps its own copy on this computer. You can also pass images to finish_task.",
    input: z.object({
      task: taskRef,
      session: z.string().optional().describe("Your session id"),
      path: z.string().max(1000).describe("Path of the image file on this computer. Relative paths are read from the task's folder"),
      caption: z.string().max(500).optional().describe("What the image shows, in a few words"),
    }),
    kind: "write",
  }, async ({ task, session, path, caption }) => {
    const t = await findTask(task);
    const s = (await ownSession(t, session)) ?? (callerSession() ? null : (await activeSession(t.id, session)) ?? (await repo.latestSession(t.id)));
    if (!s) fail(`${t.key} has no session yet. Call start_task with task ${t.key} first.`);
    if ((await repo.countSessionImages(s.id)) >= 40) fail("This session already has 40 images. Attach the ones that show the result best.");
    const [{ img }] = storeImages([{ path }], plannedFolder(t));
    // After a hand-back, the image joins the latest report; before, it waits for finish_task.
    const report = s.status === "running" || s.status === "starting" ? null : await repo.latestSessionReport(s.id);
    const a = await repo.addAttachment(img, { taskId: t.id, sessionId: s.id, reportId: report?.id ?? null, caption });
    return `Attached ${imageLine(a)} to ${t.key}${report ? ", in your last report" : ". It will be part of your report when you call finish_task"}.`;
  });

  const listItem = z.string().max(2000);
  const criterion = z.object({
    item: z.union([z.number().int().min(1), z.string().max(400)]).describe("The Done when item's number, as start_task listed it, or its text"),
    verdict: z.enum(["met", "partly", "not_met"]),
    note: z.string().max(2000).optional().describe("How you checked it, or what's missing"),
  });

  tool(server, "finish_task", {
    title: "Finish task",
    description:
      "For agents: hand a task back for the user's review, with a report of what you did. PacedMind shows the report on the task: your summary, your answer to each Done when item, screenshots, how to check the result and your questions. If not everything is ready, use outcome partial or blocked; the flow then waits for the user.",
    input: z.object({
      task: taskRef,
      session: z.string().optional(),
      summary: z.string().max(2000).optional().describe("Required. One or two sentences on what changed and what the user should look at first"),
      outcome: z.enum(["done", "partial", "blocked"]).optional()
        .describe("done (default): everything asked for is ready. partial: only some of it is. blocked: you can't go on without the user"),
      criteria: z.array(criterion).max(50).optional().describe("Your answer to each of the task's Done when items"),
      images: z.array(z.object({
        path: z.string().max(1000).describe("Path of a PNG, JPEG, GIF or WebP file on this computer"),
        caption: z.string().max(500).optional().describe("What it shows"),
      })).max(20).optional().describe("Screenshots of the result, or other images that show it. Save them as files first"),
      verify: z.array(listItem).max(50).optional().describe("Steps the user can follow to check the result: a command to run, a page to open, what to look for"),
      questions: z.array(listItem).max(50).optional().describe("Decisions or answers you need from the user"),
      details: z.string().max(100000).optional().describe("Anything longer, in Markdown: what you did and why, trade-offs, test results, findings"),
      links: z.array(z.object({ label: z.string().max(200), url: z.string().max(2000) })).max(50).optional()
        .describe("Pull requests, commits, previews or documents (http or https links)"),
      follow_ups: z.array(taskRef).max(50).optional().describe("Keys of tasks you created for work outside this one"),
      note: z.string().max(2000).optional().describe("Older name for summary"),
    }),
    kind: "write",
  }, async (args) => {
    const t = await findTask(args.task);
    const summary = (args.summary ?? args.note ?? "").replace(/\s+/g, " ").trim();
    if (!summary) fail("finish_task needs a summary: one or two sentences on what changed and what the user should look at first.");
    const outcome = args.outcome ?? "done";
    if (t.doneWhen.length && !args.criteria?.length && outcome !== "blocked") {
      fail(`${t.key} lists what "done" means. Answer each item in criteria (verdict met, partly or not_met, with a note), then call finish_task again:\n` +
        t.doneWhen.map((c, i) => `${i + 1}. ${c}`).join("\n"));
    }
    const criteria = answerCriteria(t, args.criteria ?? []);
    const refs = [...new Set((args.follow_ups ?? []).map((k) => k.trim()).filter(Boolean))];
    const found = await Promise.all(refs.map(async (k) => [k, (await repo.getTask(k))?.key ?? null] as const));
    const followUps = found.flatMap(([, key]) => (key && key !== t.key ? [key] : []));
    const unknown = found.flatMap(([k, key]) => (key ? [] : [k]));
    const clean = (xs?: string[]) => (xs ?? []).map((x) => x.trim()).filter(Boolean);
    const links = (args.links ?? []).map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
      .filter((l) => /^https?:\/\/\S+$/i.test(l.url)).map((l) => ({ label: l.label || l.url, url: l.url }));
    const mine = await ownSession(t, args.session);
    const reporting = mine ?? (callerSession() ? null : await reportingSession(t.id, args.session));
    const stored = storeImages(args.images ?? [], plannedFolder(t));
    let result: Awaited<ReturnType<typeof finishTask>>;
    try {
      // A report belongs to a session: the agent's, or a new one when it works on the task outside PacedMind.
      const s = reporting ?? (await outsideSession(t));
      result = await finishTask(t.id, s.id, summary, "agent", {
        outcome, details: args.details, criteria, verify: clean(args.verify), questions: clean(args.questions), links, followUps, images: stored,
      }, s);
    } catch (e) {
      removeImageFiles(stored.map((x) => x.img.file));
      throw e;
    }
    const { session, continueWith, continued, started } = result;
    const report = session ? await repo.latestSessionReport(session.id) : null;
    const lines = [`Recorded your report for ${t.key} (${(report && reportCounts(report)) || "summary only"}). It waits for the user's check.`];
    const unanswered = criteria.filter((c) => c.verdict === null);
    if (unanswered.length && outcome !== "blocked") lines.push(`Not answered: ${unanswered.map((c) => `"${c.text}"`).join(", ")}.`);
    if (unknown.length) lines.push(`Left out follow-ups that aren't PacedMind tasks: ${unknown.join(", ")}.`);
    if ((args.links ?? []).length > links.length) lines.push("Left out links that aren't http or https.");
    if (outcome !== "done") {
      lines.push(`You handed it back as ${outcome}, so the flow waits until the user marks ${t.key} done. You can stop here.`);
      releaseCaller();
      return lines.join("\n");
    }
    lines.push(...(await startedLines(started)));
    if (continueWith && continued) {
      lines.push(`\nNext in this same session: ${continueWith.key} · ${continueWith.title}.`);
      lines.push(`Call start_task with task ${continueWith.key} and session ${continued.id}, then keep working.`);
      // The terminal's token now works for the next task.
      const me = callerSession();
      if (me) moveSessionToken(me.sessionId, continued.id, continueWith.id);
    } else {
      lines.push("You can stop here.");
      releaseCaller();
    }
    return lines.join("\n");
  });
}
