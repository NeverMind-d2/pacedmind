import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { afterFinished, nextReadyTask } from "../flow";
import { deviceConfig, moveSessionToken, revokeSessionTokens } from "../device";
import { forgetSessionFiles } from "../launcher";
import { askFromAgent } from "../requests";
import { closeSession, edgeWouldLoop, flowNeedsTidy, placeInFlow, removeFromFlow, tidyFlow } from "../ops";
import * as repo from "../repo";
import { callerSession } from "./principal";
import { nowStamp } from "@/lib/dates";
import {
  AGENT_LABEL, LIVE_STATUSES, STATUS_LABEL, agentOf, type AgentId, type EdgeMode, type Session, type Task,
} from "@/lib/types";
import {
  agentSchema, dateTimeInput, describeTask, fail, findProject, findSession, findTask, names, projectRef, taskRef, tool, when,
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

function sessionLine(s: Session, tasks: Map<number, Task>): string {
  const t = tasks.get(s.taskId);
  const at = (s.finishedAt ?? s.endedAt ?? s.startedAt).replace("T", " ");
  return `Session ${s.id} · ${t ? `${t.key} ${t.title}` : `task #${s.taskId}`} · ${AGENT_LABEL[s.agent]} · ${SESSION_TEXT[s.status]} · ${at}${s.note ? ` · ${s.note}` : ""}`;
}

/** The agent that runs a task: its own, else the project's, else Claude Code. None for a task that is the user's own. */
const agentFor = async (t: Task): Promise<AgentId | null> => agentOf(t, t.projectId ? (await repo.getProject(t.projectId))?.agent : null);
const notYours = (t: Task) => {
  if (t.agent === "human") fail(`${t.key} is marked as the user's own task (human), so it stays out of flows and agent sessions. Ask the user before changing that with update_task.`);
};

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

async function activeSession(taskId: number, sessionId?: string | null): Promise<Session | null> {
  if (sessionId) {
    const s = await repo.getSession(sessionId);
    if (s && s.taskId === taskId) return s;
  }
  return (await repo.listSessions({ taskId, status: LIVE_STATUSES }))[0] ?? null;
}

const taskMap = async () => new Map((await repo.listTasks()).map((t) => [t.id, t]));

export function registerAgentTools(server: McpServer) {
  /* ---------- flows ---------- */

  tool(server, "get_flow", {
    title: "Get project flow",
    description:
      "A project's flow: which tasks agent sessions work on, which agent runs each, and which task starts after which (and how). Also whether the flow may start sessions on its own.",
    input: z.object({ project: projectRef }),
    kind: "read",
  }, async ({ project }) => {
    const n = await names();
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
        lines.push(`- ${t.key} · ${STATUS_LABEL[t.status]} · ${t.title} · ${how}`);
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
    description: "Agent sessions (Claude Code or Codex working on a task), newest first. waiting means an agent finished and the user should review it.",
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
    return sessions.slice(0, args.limit ?? 20).map((s) => sessionLine(s, tasks)).join("\n");
  });

  tool(server, "start_session", {
    title: "Start agent session",
    description:
      "Ask to open a new terminal on the user's computer with Claude Code or Codex working on a task, in the project's folder. Only when the user asks for it. The user allows it in the PacedMind app first; the request expires after 10 minutes.",
    input: z.object({ task: taskRef, agent: agentSchema.optional() }),
    kind: "launch",
  }, async ({ task, agent }) => {
    const t = await findTask(task);
    notYours(t);
    if ((await repo.listSessions({ taskId: t.id, status: LIVE_STATUSES })).length) fail(`${t.key} already has a running session.`);
    const a = (await askFromAgent(t, agent ?? (await agentFor(t)) ?? "claude")) ?? fail(`${t.key} can't run on this computer.`);
    return (
      `Asked the user to allow ${t.key} with ${AGENT_LABEL[a.agent]}: PacedMind shows the request in its window and a notification. ` +
      "The terminal opens once they allow it (within 10 minutes). Tell the user to look at PacedMind; don't ask again."
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
    return sessionLine((await repo.getSession(s.id))!, await taskMap());
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
    let s = (await ownSession(t, session)) ?? (callerSession() ? null : await activeSession(t.id, session));
    if (!s) {
      notYours(t);
      const project = t.projectId ? await repo.getProject(t.projectId) : null;
      s = await repo.createSession({
        taskId: t.id, agent: agent ?? agentOf(t, project?.agent) ?? "claude", folder: project?.folder ?? null,
        deviceId: deviceConfig().deviceId, status: "running",
      });
      await repo.addSessionEvent(s.id, "started", "Started outside PacedMind");
    }
    await repo.updateSession(s.id, { status: "running" });
    await repo.addSessionEvent(s.id, "picked_up", `${AGENT_LABEL[s.agent]} read the task over MCP`);
    if (t.status !== "progress") await repo.updateTask(t.id, { status: "progress" });
    return (
      `${await describeTask((await repo.getTask(t.id))!)}\n\nPacedMind session: ${s.id}\n` +
      `Work on this task here. When it is ready for the user to check, call finish_task with task ${t.key}, ` +
      `session ${s.id} and a one-line note about what changed. Do not mark it done yourself.`
    );
  });

  tool(server, "finish_task", {
    title: "Finish task",
    description: "For agents: tell PacedMind the work on a task is finished and ready for the user to check.",
    input: z.object({
      task: taskRef,
      session: z.string().optional(),
      note: z.string().describe("One line about what changed"),
    }),
    kind: "write",
  }, async ({ task, session, note }) => {
    const t = await findTask(task);
    const s = (await ownSession(t, session)) ?? (callerSession() ? null : await activeSession(t.id, session));
    if (s) {
      await repo.updateSession(s.id, { status: "finished", finishedAt: nowStamp(), note });
      await repo.addSessionEvent(s.id, "finished", note);
    }
    await repo.updateTask(t.id, { status: "review" });
    const { continueWith, started } = await afterFinished(t.id);
    const lines = [`Recorded. ${t.key} is finished and waits for the user's check.`];
    for (const r of started) {
      if (r.ok && r.session) lines.push(`PacedMind started ${(await repo.getTask(r.session.taskId))?.key} in a new ${AGENT_LABEL[r.session.agent]} session.`);
    }
    if (continueWith) {
      const next = await repo.createSession({
        taskId: continueWith.id, agent: s?.agent ?? "claude", folder: s?.folder ?? null, deviceId: s?.deviceId ?? null, status: "running",
        cliSessionId: s?.cliSessionId ?? null, continuesSessionId: s?.id ?? null,
      });
      await repo.addSessionEvent(next.id, "started", `Continues session ${s?.id ?? ""} in the same terminal`);
      // The terminal's token now works for the next task.
      const me = callerSession();
      if (me) moveSessionToken(me.sessionId, next.id, continueWith.id);
      await repo.updateTask(continueWith.id, { status: "progress" });
      lines.push(`\nNext in this same session: ${continueWith.key} · ${continueWith.title}.`);
      lines.push(`Call start_task with task ${continueWith.key} and session ${next.id}, then keep working.`);
    } else {
      lines.push("You can stop here.");
      // A session PacedMind started is done with PacedMind now: its token stops working.
      const me = callerSession();
      if (me) {
        revokeSessionTokens([me.sessionId]);
        forgetSessionFiles([me.sessionId]);
      }
    }
    return lines.join("\n");
  });
}
