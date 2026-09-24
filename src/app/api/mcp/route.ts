import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import * as repo from "@/server/repo";
import { afterDone, afterFinished, nextReadyTask } from "@/server/flow";
import { authorized } from "@/server/auth";
import { nowStamp } from "@/lib/dates";
import { AGENT_LABEL, EDGE_LABEL, PRIORITY_LABEL, STATUS_LABEL, type Priority, type Status, type Task } from "@/lib/types";

const PRIORITIES = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 } as const;
const STATUSES = ["backlog", "todo", "progress", "review", "done", "canceled"] as const;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

function findProject(q?: string | null) {
  if (!q) return null;
  const s = q.toLowerCase();
  return repo.listProjects().find((p) => p.id === s || p.name.toLowerCase() === s || p.name.toLowerCase().includes(s)) ?? null;
}

function describe(t: Task): string {
  const project = t.projectId ? repo.getProject(t.projectId) : null;
  const edges = repo.listEdges();
  const keyOf = (id: number) => repo.getTask(id)?.key ?? `#${id}`;
  const after = edges.filter((e) => e.toTaskId === t.id).map((e) => `${keyOf(e.fromTaskId)} (${EDGE_LABEL[e.mode].toLowerCase()})`);
  const next = edges.filter((e) => e.fromTaskId === t.id).map((e) => `${keyOf(e.toTaskId)} (${EDGE_LABEL[e.mode].toLowerCase()})`);
  return [
    `${t.key} · ${t.title}`,
    `Status: ${STATUS_LABEL[t.status]} · Priority: ${PRIORITY_LABEL[t.priority]}${project ? ` · Project: ${project.name}` : ""}`,
    project?.folder ? `Folder: ${project.folder}` : null,
    t.dueDate || t.plannedDate ? `Due: ${t.dueDate ?? "none"} · Planned: ${t.plannedDate ?? "none"}` : null,
    t.labels.length ? `Labels: ${t.labels.join(", ")}` : null,
    t.description ? `\nDescription:\n${t.description}` : null,
    t.subtasks.length ? `\nSub-tasks:\n${t.subtasks.map((s) => `- [${s.done ? "x" : " "}] ${s.title}`).join("\n")}` : null,
    after.length ? `\nComes after: ${after.join(", ")}` : null,
    next.length ? `Leads to: ${next.join(", ")}` : null,
  ].filter(Boolean).join("\n");
}

function activeSession(taskId: number, sessionId?: string | null) {
  if (sessionId) {
    const s = repo.getSession(sessionId);
    if (s && s.taskId === taskId) return s;
  }
  return repo.listSessions("task_id = ? AND status IN ('starting', 'running')", taskId)[0] ?? null;
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_tasks",
      {
        title: "List tasks",
        description: "List tasks in Organizer, optionally filtered by project (id or name), area or status.",
        inputSchema: z.object({
          project: z.string().optional(),
          area: z.string().optional(),
          status: z.enum(STATUSES).optional(),
          include_done: z.boolean().optional(),
        }),
      },
      async ({ project, area, status, include_done }) => {
        const p = findProject(project);
        const tasks = repo.listTasks().filter((t) =>
          (!p || t.projectId === p.id) && (!area || t.areaId === area.toLowerCase()) && (!status || t.status === status) &&
          (include_done || status || (t.status !== "done" && t.status !== "canceled")));
        if (!tasks.length) return text("No tasks match.");
        return text(tasks.map((t) => `${t.key} · ${STATUS_LABEL[t.status]} · ${t.title}${t.dueDate ? ` · due ${t.dueDate}` : ""}`).join("\n"));
      },
    );

    server.registerTool(
      "get_task",
      {
        title: "Get task",
        description: "Get a task's full details: description, sub-tasks, folder and how it connects to other tasks.",
        inputSchema: z.object({ task: z.string().describe("Task key such as DEV-22") }),
      },
      async ({ task }) => {
        const t = repo.getTask(task);
        return text(t ? describe(t) : `No task ${task}.`);
      },
    );

    server.registerTool(
      "get_next_task",
      {
        title: "Get next task",
        description: "The next task in a project that is ready to be worked on (its previous steps are finished).",
        inputSchema: z.object({ project: z.string().describe("Project id or name") }),
      },
      async ({ project }) => {
        const p = findProject(project);
        if (!p) return text(`No project matches "${project}".`);
        const t = nextReadyTask(p.id);
        return text(t ? describe(t) : `Nothing in ${p.name} is ready right now.`);
      },
    );

    server.registerTool(
      "start_task",
      {
        title: "Start task",
        description: "Tell Organizer you are starting work on a task. Returns the task and what to do when you finish.",
        inputSchema: z.object({
          task: z.string().describe("Task key such as DEV-22"),
          session: z.string().optional().describe("Session id given in your first message, if any"),
          agent: z.enum(["claude", "codex"]).optional(),
        }),
      },
      async ({ task, session, agent }) => {
        const t = repo.getTask(task);
        if (!t) return text(`No task ${task}.`);
        let s = activeSession(t.id, session);
        if (!s) {
          const project = t.projectId ? repo.getProject(t.projectId) : null;
          s = repo.createSession({ taskId: t.id, agent: agent ?? t.agent ?? "claude", folder: project?.folder ?? null, status: "running" });
          repo.addSessionEvent(s.id, "started", "Started outside Organizer");
        }
        repo.updateSession(s.id, { status: "running" });
        repo.addSessionEvent(s.id, "picked_up", `${AGENT_LABEL[s.agent]} read the task over MCP`);
        if (t.status !== "progress") repo.updateTask(t.id, { status: "progress" });
        return text(
          `${describe(repo.getTask(t.id)!)}\n\nOrganizer session: ${s.id}\n` +
          `Work on this task here. When it is ready for the user to check, call finish_task with task ${t.key}, ` +
          `session ${s.id} and a one-line note about what changed. Do not mark it done yourself.`,
        );
      },
    );

    server.registerTool(
      "finish_task",
      {
        title: "Finish task",
        description: "Tell Organizer the work on a task is finished and ready for the user to check.",
        inputSchema: z.object({
          task: z.string(),
          session: z.string().optional(),
          note: z.string().describe("One line about what changed"),
        }),
      },
      async ({ task, session, note }) => {
        const t = repo.getTask(task);
        if (!t) return text(`No task ${task}.`);
        const s = activeSession(t.id, session);
        if (s) {
          repo.updateSession(s.id, { status: "finished", finishedAt: nowStamp(), note });
          repo.addSessionEvent(s.id, "finished", note);
        }
        repo.updateTask(t.id, { status: "review" });
        const { continueWith, started } = afterFinished(t.id);
        const lines = [`Recorded. ${t.key} is finished and waits for the user's check.`];
        for (const r of started) {
          if (r.ok && r.session) lines.push(`Organizer started ${repo.getTask(r.session.taskId)?.key} in a new ${AGENT_LABEL[r.session.agent]} session.`);
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
        return text(lines.join("\n"));
      },
    );

    server.registerTool(
      "create_task",
      {
        title: "Create task",
        description: "Add a task to Organizer.",
        inputSchema: z.object({
          title: z.string(),
          project: z.string().optional(),
          area: z.string().optional(),
          description: z.string().optional(),
          priority: z.enum(["none", "urgent", "high", "medium", "low"]).optional(),
          due: z.string().optional().describe("YYYY-MM-DD or YYYY-MM-DDTHH:mm"),
        }),
      },
      async ({ title, project, area, description, priority, due }) => {
        const p = findProject(project);
        const t = repo.createTask({
          title, projectId: p?.id ?? null, areaId: area?.toLowerCase() ?? p?.areaId ?? null, description,
          priority: priority ? (PRIORITIES[priority] as Priority) : 0, dueDate: due ?? null,
        });
        return text(`Created ${t.key} · ${t.title}${p ? ` in ${p.name}` : ""}.`);
      },
    );

    server.registerTool(
      "update_task",
      {
        title: "Update task",
        description: "Change a task's fields, add sub-tasks or tick them off.",
        inputSchema: z.object({
          task: z.string(),
          title: z.string().optional(),
          description: z.string().optional(),
          status: z.enum(STATUSES).optional(),
          priority: z.enum(["none", "urgent", "high", "medium", "low"]).optional(),
          due: z.string().nullable().optional(),
          add_subtasks: z.array(z.string()).optional(),
          complete_subtasks: z.array(z.string()).optional().describe("Titles of sub-tasks to tick off"),
        }),
      },
      async ({ task, title, description, status, priority, due, add_subtasks, complete_subtasks }) => {
        const t = repo.getTask(task);
        if (!t) return text(`No task ${task}.`);
        repo.updateTask(t.id, {
          title, description, status: status as Status | undefined,
          priority: priority ? (PRIORITIES[priority] as Priority) : undefined, dueDate: due,
        });
        for (const s of add_subtasks ?? []) repo.addSubtask(t.id, s);
        for (const title of complete_subtasks ?? []) {
          const sub = t.subtasks.find((s) => s.title.toLowerCase() === title.toLowerCase());
          if (sub) repo.setSubtaskDone(sub.id, true);
        }
        if (status === "done") afterDone(t.id);
        return text(`Updated ${t.key}.`);
      },
    );
  },
  { serverInfo: { name: "organizer", version: "0.1.0" } },
);

async function guarded(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  return handler(req);
}

export { guarded as GET, guarded as POST, guarded as DELETE };
