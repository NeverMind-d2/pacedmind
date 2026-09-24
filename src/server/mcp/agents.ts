import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { tx } from "../db";
import { afterFinished, nextReadyTask } from "../flow";
import { startSession } from "../launcher";
import { closeSession, edgeWouldLoop, flowNeedsTidy, placeInFlow, removeFromFlow, tidyFlow } from "../ops";
import * as repo from "../repo";
import { nowStamp } from "@/lib/dates";
import { AGENT_LABEL, STATUS_LABEL, type AgentId, type EdgeMode, type Session, type Task } from "@/lib/types";
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

function sessionLine(s: Session): string {
  const t = repo.getTask(s.taskId);
  const at = (s.finishedAt ?? s.endedAt ?? s.startedAt).replace("T", " ");
  return `Session ${s.id} · ${t ? `${t.key} ${t.title}` : `task #${s.taskId}`} · ${AGENT_LABEL[s.agent]} · ${SESSION_TEXT[s.status]} · ${at}${s.note ? ` · ${s.note}` : ""}`;
}

/** The agent a task runs with: its own, else its project's, else Claude Code. */
const agentFor = (t: Task): AgentId => t.agent ?? (t.projectId ? repo.getProject(t.projectId)?.agent : null) ?? "claude";

function activeSession(taskId: number, sessionId?: string | null) {
  if (sessionId) {
    const s = repo.getSession(sessionId);
    if (s && s.taskId === taskId) return s;
  }
  return repo.listSessions("task_id = ? AND status IN ('starting', 'running')", taskId)[0] ?? null;
}

export function registerAgentTools(server: McpServer) {
  /* ---------- flows ---------- */

  tool(server, "get_flow", {
    title: "Get project flow",
    description:
      "A project's flow: which tasks agent sessions work on, in which agent lane, and which task starts after which (and how). Also whether the flow may start sessions on its own.",
    input: z.object({ project: projectRef }),
    kind: "read",
  }, ({ project }) => {
    const n = names();
    const p = findProject(project);
    const tasks = repo.listTasks("project_id = ?", p.id);
    const inFlow = tasks.filter((t) => t.flowX !== null && t.flowY !== null).sort((a, b) => (a.flowY ?? 0) - (b.flowY ?? 0));
    const edges = repo.listEdges();
    const keyOf = new Map(tasks.map((t) => [t.id, t.key]));
    const next = repo.listProjects().filter((x) => x.afterProjectId === p.id);
    const lines = [
      `Flow for ${p.name} (id ${p.id}) · ${p.flowOn ? "on: sessions start on their own when their turn comes" : "off: nothing starts on its own"}`,
      p.afterProjectId ? `Starts after project ${n.project(p.afterProjectId)}.` : null,
      next.length ? `Then: ${next.map((x) => x.name).join(", ")}.` : null,
    ];
    for (const agent of ["claude", "codex"] as AgentId[]) {
      const lane = inFlow.filter((t) => agentFor(t) === agent);
      if (!lane.length) continue;
      lines.push(`\n${AGENT_LABEL[agent]} lane:`);
      for (const t of lane) {
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
    const ready = nextReadyTask(p.id);
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
  }, (args) => {
    const from = findTask(args.from);
    const to = findTask(args.to);
    if (from.id === to.id) fail("A task can't come after itself.");
    if (!from.projectId || from.projectId !== to.projectId) fail("Both tasks have to be in the same project; flows are per project.");
    if (edgeWouldLoop(from.id, to.id)) fail(`${to.key} already leads to ${from.key}, so this would make a loop.`);
    const mode: EdgeMode = MODE_OF[args.mode ?? "auto"];
    const at = mode === "time" ? (args.at ? when(args.at, "required") : fail("at_time needs at, e.g. \"2026-09-26T09:00\".")) : null;
    tx(() => {
      const fromAgent = agentFor(from);
      if (from.flowX === null || from.flowY === null) placeInFlow(from.id, fromAgent);
      // "Same session" continues in the previous task's terminal, so it runs with that task's agent.
      const toAgent = mode === "session" ? fromAgent : agentFor(to);
      if (to.flowX === null || to.flowY === null || (mode === "session" && agentFor(to) !== fromAgent)) placeInFlow(to.id, toAgent, from.id);
      repo.createEdge(from.id, to.id, mode);
      repo.setIncomingMode(to.id, mode, at);
    });
    const project = repo.getProject(from.projectId)!;
    // Keep the canvas reading top to bottom when the new connection points up.
    if (flowNeedsTidy(from.id, to.id)) tidyFlow(project.id);
    return [
      `${from.key} → ${to.key}: ${to.key} ${MODE_TEXT[mode]}${at ? ` (${at.replace("T", " ")})` : ""}.`,
      project.flowOn ? null : `${project.name}'s flow is off, so nothing starts on its own until it's turned on (update_project with flow_on true).`,
    ].filter(Boolean).join("\n");
  });

  tool(server, "disconnect_tasks", {
    title: "Disconnect tasks",
    description: "Remove the connection that makes one task start after another.",
    input: z.object({ from: taskRef, to: taskRef }),
    kind: "delete",
  }, ({ from, to }) => {
    const a = findTask(from);
    const b = findTask(to);
    const edge = repo.listEdges().find((e) => e.fromTaskId === a.id && e.toTaskId === b.id);
    if (!edge) fail(`${b.key} doesn't start after ${a.key}.`);
    repo.deleteEdge(edge.id);
    return `${b.key} no longer starts after ${a.key}.`;
  });

  tool(server, "add_to_flow", {
    title: "Add task to flow",
    description: "Put a project task on the flow canvas, at the end of an agent's lane, so an agent session can work on it.",
    input: z.object({ task: taskRef, agent: agentSchema.optional().describe("Defaults to the task's or project's agent") }),
    kind: "write",
  }, ({ task, agent }) => {
    const t = findTask(task);
    if (!t.projectId) fail(`${t.key} isn't in a project. Flows belong to projects; move it into one first.`);
    const a = agent ?? agentFor(t);
    placeInFlow(t.id, a);
    return `${t.key} is in the ${AGENT_LABEL[a]} lane of ${names().project(t.projectId)}'s flow.`;
  });

  tool(server, "remove_from_flow", {
    title: "Remove task from flow",
    description: "Take a task off the flow canvas together with its connections. The task itself stays.",
    input: z.object({ task: taskRef }),
    kind: "delete",
  }, ({ task }) => {
    const t = findTask(task);
    removeFromFlow(t.id);
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
  }, (args) => {
    const where = args.status === "waiting" ? "status = 'finished'" : args.status === "running" ? "status IN ('starting', 'running')" : "1 = 1";
    const task = args.task ? findTask(args.task) : null;
    const project = args.project ? findProject(args.project) : null;
    const inProject = project ? new Set(repo.listTasks("project_id = ?", project.id).map((t) => t.id)) : null;
    const sessions = repo.listSessions(where).filter((s) => (!task || s.taskId === task.id) && (!inProject || inProject.has(s.taskId)));
    if (!sessions.length) return "No sessions match.";
    return sessions.slice(0, args.limit ?? 20).map(sessionLine).join("\n");
  });

  tool(server, "start_session", {
    title: "Start agent session",
    description:
      "Open a new terminal on the user's computer with Claude Code or Codex working on a task, in the project's folder. Only when the user asks for it.",
    input: z.object({ task: taskRef, agent: agentSchema.optional() }),
    kind: "launch",
  }, ({ task, agent }) => {
    const t = findTask(task);
    const r = startSession(t.id, agent);
    if (!r.ok || !r.session) fail(r.error ?? "The session didn't start.");
    return `Started ${t.key} in ${AGENT_LABEL[r.session.agent]} (session ${r.session.id}). A terminal opened on the user's computer.`;
  });

  tool(server, "close_session", {
    title: "Close agent session",
    description: "Mark a running session as closed, e.g. when its terminal was closed or it got stuck. The task goes back to Todo.",
    input: z.object({ session: z.string().describe("Session id from list_sessions") }),
    kind: "delete",
  }, ({ session }) => {
    const s = findSession(session);
    closeSession(s.id);
    return sessionLine(repo.getSession(s.id)!);
  });

  /* ---------- the session protocol for agents working on a task ---------- */

  tool(server, "get_next_task", {
    title: "Get next task",
    description: "The next task in a project that is ready to be worked on (the tasks it waits for are finished).",
    input: z.object({ project: projectRef }),
    kind: "read",
  }, ({ project }) => {
    const p = findProject(project);
    const t = nextReadyTask(p.id);
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
  }, ({ task, session, agent }) => {
    const t = findTask(task);
    let s = activeSession(t.id, session);
    if (!s) {
      const project = t.projectId ? repo.getProject(t.projectId) : null;
      s = repo.createSession({ taskId: t.id, agent: agent ?? t.agent ?? "claude", folder: project?.folder ?? null, status: "running" });
      repo.addSessionEvent(s.id, "started", "Started outside PacedMind");
    }
    repo.updateSession(s.id, { status: "running" });
    repo.addSessionEvent(s.id, "picked_up", `${AGENT_LABEL[s.agent]} read the task over MCP`);
    if (t.status !== "progress") repo.updateTask(t.id, { status: "progress" });
    return (
      `${describeTask(repo.getTask(t.id)!)}\n\nPacedMind session: ${s.id}\n` +
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
  }, ({ task, session, note }) => {
    const t = findTask(task);
    const s = activeSession(t.id, session);
    if (s) {
      repo.updateSession(s.id, { status: "finished", finishedAt: nowStamp(), note });
      repo.addSessionEvent(s.id, "finished", note);
    }
    repo.updateTask(t.id, { status: "review" });
    const { continueWith, started } = afterFinished(t.id);
    const lines = [`Recorded. ${t.key} is finished and waits for the user's check.`];
    for (const r of started) {
      if (r.ok && r.session) lines.push(`PacedMind started ${repo.getTask(r.session.taskId)?.key} in a new ${AGENT_LABEL[r.session.agent]} session.`);
    }
    if (continueWith) {
      const next = repo.createSession({
        taskId: continueWith.id, agent: s?.agent ?? "claude", folder: s?.folder ?? null, status: "running",
        cliSessionId: s?.cliSessionId ?? null, continuesSessionId: s?.id ?? null,
      });
      repo.addSessionEvent(next.id, "started", `Continues session ${s?.id ?? ""} in the same terminal`);
      repo.updateTask(continueWith.id, { status: "progress" });
      lines.push(`\nNext in this same session: ${continueWith.key} · ${continueWith.title}.`);
      lines.push(`Call start_task with task ${continueWith.key} and session ${next.id}, then keep working.`);
    } else {
      lines.push("You can stop here.");
    }
    return lines.join("\n");
  });
}
