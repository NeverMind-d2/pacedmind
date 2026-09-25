import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { dbPath } from "./db";
import { cliCommand, deviceFor, thisDevice, thisDeviceId } from "./devices";
import { folderProblem } from "./folders";
import { AGENT_ALLOWED_TOOLS } from "./mcp/agent-tools";
import * as repo from "./repo";
import { agentEnv, cmdQuote, execLine, openUrl, shQuote } from "./shell";
import { nowStamp } from "@/lib/dates";
import {
  AGENT_LABEL, APP_LABEL, CLOUD_LABEL, agentOf, canRun, surfaceOf, type AgentId, type Device, type Session, type Surface, type Task,
} from "@/lib/types";

export interface LaunchResult {
  ok: boolean;
  session?: Session;
  error?: string;
  /** What happened, for a toast. */
  message?: string;
}

/** Where agents reach this server. Next sets PORT to the port it listens on (the app uses 4319, `npm run dev` 4320). */
export function baseUrl(): string {
  return `http://127.0.0.1:${process.env.PORT || repo.getSettings().port}`;
}

export function mcpUrl(): string {
  return `${baseUrl()}/api/mcp`;
}

/** Where you follow cloud sessions. */
export const CLOUD_HOME: Record<AgentId, string> = { claude: "https://claude.ai/code", codex: "https://chatgpt.com/codex" };

const dataDir = () => path.dirname(dbPath());
/** Keeps text safe for .cmd files, Windows Terminal and shell scripts. */
const safe = (s: string, max = 400) => s.replace(/[^\p{L}\p{N} .,:_-]/gu, "").replace(/\s+/g, " ").trim().slice(0, max);

/** The first message of a session PacedMind starts: the agent picks the task up over MCP. */
export function kickoffPrompt(task: Task, sessionId: string): string {
  return safe(
    `PacedMind task ${task.key}, session ${sessionId}: ${safe(task.title, 120)}. Call the organizer MCP tool start_task with task ${task.key} and session ${sessionId}, then follow the instructions it returns.`,
    600,
  );
}

/**
 * The first message of a cloud session. The cloud can't reach PacedMind on this computer, so the task comes along
 * in full and the agent hands the work back as a branch and a pull request.
 */
export function cloudPrompt(task: Task): string {
  const subs = task.subtasks.map((s) => `- [${s.done ? "x" : " "}] ${s.title}`);
  return [
    `Task ${task.key}: ${task.title}`,
    task.description.trim(),
    subs.length ? `Sub-tasks:\n${subs.join("\n")}` : "",
    `Work on a new branch named agent/${task.key.toLowerCase()} and open a pull request when it's ready for review. ` +
      "This task comes from PacedMind, which you can't reach from here, so don't look for its tools.",
  ].filter(Boolean).join("\n\n").slice(0, 6000);
}

function sessionDir(id: string): string {
  const dir = path.join(dataDir(), "sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeClaudeConfig(dir: string, sessionId: string, token: string) {
  const mcp = { mcpServers: { organizer: { type: "http", url: mcpUrl(), headers: { Authorization: `Bearer ${token}` } } } };
  const ended = `curl -s -X POST -H "Authorization: Bearer ${token}" ${baseUrl()}/api/sessions/${sessionId}/ended`;
  const settings = { hooks: { SessionEnd: [{ hooks: [{ type: "command", command: ended }] }] } };
  const mcpFile = path.join(dir, "mcp.json");
  const settingsFile = path.join(dir, "settings.json");
  fs.writeFileSync(mcpFile, JSON.stringify(mcp, null, 2));
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  return { mcpFile, settingsFile };
}

/** Builds the agent command line for a terminal session (without folder/title handling). */
function agentCommand(agent: AgentId, dir: string, session: Session, task: Task, resume: boolean): string {
  const s = repo.getSettings();
  const cli = cliCommand(agent, thisDevice());
  if (agent === "claude") {
    const { mcpFile, settingsFile } = writeClaudeConfig(dir, session.id, s.mcpToken);
    const allowed = AGENT_ALLOWED_TOOLS.map((t) => `mcp__organizer__${t}`).join(",");
    const base = `${cli} --mcp-config "${mcpFile}" --settings "${settingsFile}" --allowedTools ${allowed}`;
    if (resume && session.cliSessionId) return `${base} --resume ${session.cliSessionId}`;
    const name = safe(`${task.key} ${task.title}`, 80);
    return `${base} --session-id ${session.cliSessionId} -n "${name}" "${kickoffPrompt(task, session.id)}"`;
  }
  // PacedMind's MCP server for this session, whatever config.toml says; the token comes from ORGANIZER_TOKEN,
  // which the terminal script sets.
  const mcp = `-c mcp_servers.organizer.url="${mcpUrl()}" -c mcp_servers.organizer.bearer_token_env_var="ORGANIZER_TOKEN"`;
  if (resume) return `${cli} ${mcp} resume --last`;
  return `${cli} ${mcp} "${kickoffPrompt(task, session.id)}"`;
}

/** A Codex cloud environment is picked by its label or id; anything else can't go on a command line. */
const plainEnv = (env: string) => /^[\w .:-]{1,100}$/.test(env);

/**
 * Sends a task to Codex cloud from the task's folder: `codex cloud exec` reads the task from stdin, prints the new
 * task's link and returns. It runs out of sight; the session records the link, or why it failed.
 */
function sendToCodexCloud(session: Session, task: Task, env: string) {
  const line = `${cliCommand("codex", thisDevice())} cloud exec --env "${env}" -`;
  void execLine(line, { cwd: session.folder ?? undefined, input: cloudPrompt(task), timeout: 120_000 }).then(({ code, stdout, stderr }) => {
    const url = stdout.match(/https:\/\/chatgpt\.com\/codex\/tasks\/[\w-]+/)?.[0];
    if (code === 0 && url) {
      repo.updateSession(session.id, { status: "running", url });
      repo.addSessionEvent(session.id, "started", `Codex cloud took it on in the ${env} environment`);
      return;
    }
    const why = (stderr || stdout).trim().split(/\r?\n/).filter(Boolean).pop() ?? `codex cloud exec stopped (${code})`;
    repo.updateSession(session.id, { status: "failed", endedAt: nowStamp(), note: why });
    repo.addSessionEvent(session.id, "failed", why);
  });
}

/** The link that opens a new session in the agent's desktop app, in the folder, with the first message written. */
function desktopLink(agent: AgentId, folder: string, prompt: string): string {
  const q = new URLSearchParams(agent === "claude" ? { folder, q: prompt } : { path: folder, prompt });
  return agent === "claude" ? `claude://code/new?${q}` : `codex://new?${q}`;
}

/** The link that shows the agent's desktop app, where a session it runs waits. */
export function desktopHome(agent: AgentId): string {
  return agent === "claude" ? "claude://code/needs-input" : "codex://launch";
}

function openTerminal(dir: string, folder: string, title: string, command: string): string | null {
  const token = repo.getSettings().mcpToken;
  const env = agentEnv();
  try {
    if (process.platform === "win32") {
      const script = path.join(dir, "start.cmd");
      fs.writeFileSync(
        script,
        ["@echo off", "chcp 65001 >nul", `title ${title}`, `cd /d "${folder}"`, `set ORGANIZER_TOKEN=${token}`, command, ""].join("\r\n"),
      );
      if (repo.getSettings().terminal === "wt") {
        const child = spawn("wt.exe", ["-w", "organizer", "new-tab", "--title", title, "-d", folder, "cmd", "/k", script], {
          detached: true, stdio: "ignore", env,
        });
        child.on("error", () => openCmdWindow(title, script, env));
        child.unref();
      } else {
        openCmdWindow(title, script, env);
      }
      return null;
    }
    const script = path.join(dir, "start.sh");
    fs.writeFileSync(script, ["#!/bin/sh", `cd "${folder}"`, `export ORGANIZER_TOKEN=${token}`, command, ""].join("\n"), { mode: 0o755 });
    const child = process.platform === "darwin"
      ? spawn("open", ["-a", "Terminal", script], { detached: true, stdio: "ignore", env })
      : spawn("x-terminal-emulator", ["-e", script], { detached: true, stdio: "ignore", env });
    child.unref();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function openCmdWindow(title: string, script: string, env: NodeJS.ProcessEnv) {
  spawn("cmd.exe", ["/c", `start "${title}" cmd /k "${script}"`], { detached: true, stdio: "ignore", windowsVerbatimArguments: true, env }).unref();
}

/** The folder a task works in: its own, else its project's, else a scratch folder next to the database. */
export function taskFolder(task: Task): { folder?: string; own: boolean; error?: string } {
  const project = task.projectId ? repo.getProject(task.projectId) : null;
  const folder = task.folder ?? project?.folder ?? null;
  if (folder) {
    const problem = folderProblem(folder);
    if (problem) return { own: !!task.folder, error: `Can't use the folder ${folder}: ${problem}` };
    return { folder, own: !!task.folder };
  }
  const scratch = path.join(dataDir(), "workspaces", task.key.toLowerCase());
  fs.mkdirSync(scratch, { recursive: true });
  return { folder: scratch, own: false };
}

/** Whether a folder is in a git repository: it or a folder above it has a .git. */
function inGitRepo(folder: string): boolean {
  for (let dir = path.resolve(folder); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git"))) return true;
    if (path.dirname(dir) === dir) return false;
  }
}

const where: Record<Surface, (agent: AgentId, device: Device) => string> = {
  terminal: (agent, device) => `a terminal on ${device.name}`,
  desktop: (agent, device) => `the ${APP_LABEL[agent]} on ${device.name}`,
  cloud: (agent) => CLOUD_LABEL[agent],
};

/** Why a device can't run an agent's session that way, or null. */
function surfaceProblem(agent: AgentId, surface: Surface, device: Device): string | null {
  const tools = device.agents[agent];
  if (!device.checkedAt || canRun(tools, surface)) return null;
  if (surface === "desktop") return `The ${APP_LABEL[agent]} isn't installed on ${device.name}.`;
  const cli = agent === "claude" ? "Claude Code CLI (claude)" : "Codex CLI (codex)";
  return surface === "cloud"
    ? `${CLOUD_LABEL[agent]} sessions start from the ${cli}, which isn't installed on ${device.name}.`
    : `The ${cli} isn't installed on ${device.name}.${tools.app ? ` Run it in the ${APP_LABEL[agent]} instead.` : ""}`;
}

/**
 * Starts a session for a task where the task says: in a terminal or the agent's desktop app on its device, or in
 * the agent's cloud. A session for another device waits until that device picks it up.
 */
export function startSession(taskId: number, opts: { agent?: AgentId; surface?: Surface } = {}): LaunchResult {
  const task = repo.getTask(taskId);
  if (!task) return { ok: false, error: "Task not found" };
  const active = repo.listSessions("task_id = ? AND status IN ('starting', 'running')", task.id);
  if (active.length) return { ok: false, error: `${task.key} already has a running session` };
  const project = task.projectId ? repo.getProject(task.projectId) : null;
  if (task.agent === "human") return { ok: false, error: `${task.key} is marked as yours. Hand it to Claude Code or Codex before starting a session.` };
  const agent: AgentId = opts.agent ?? agentOf(task, project?.agent) ?? "claude";
  const device = deviceFor(task.deviceId, project?.deviceId);
  const surface = opts.surface ?? surfaceOf(task.runIn, device.agents[agent]);
  const here = device.id === thisDeviceId();
  const problem = here ? surfaceProblem(agent, surface, device) : null;
  if (problem) return { ok: false, error: problem };
  const env = project?.codexEnv?.trim() ?? "";
  if (surface === "cloud" && agent === "codex" && !plainEnv(env)) {
    return {
      ok: false,
      error: env
        ? `The Codex cloud environment "${env}" has characters that can't go on a command line. Use its label or id.`
        : `Pick the Codex cloud environment ${project ? `${project.name}` : "this task"} runs in first: its label from chatgpt.com/codex/settings/environments.`,
    };
  }
  // Folders are checked on the device they're on.
  const { folder, error } = here || surface === "cloud" ? taskFolder(task) : { folder: task.folder ?? project?.folder ?? undefined, error: undefined };
  if (!folder) return { ok: false, error: error ?? `${task.key} has no folder on ${device.name}` };
  // The cloud works on a copy of the repository (from GitHub, or uploaded), so there has to be one.
  if (surface === "cloud" && !inGitRepo(folder)) {
    return { ok: false, error: `${CLOUD_LABEL[agent]} works on a git repository, and ${folder} isn't in one. Give ${task.key} or its project a repository folder.` };
  }

  const session = repo.createSession({
    taskId: task.id, agent, surface, deviceId: surface === "cloud" ? null : device.id, folder, branch: `agent/${task.key.toLowerCase()}`,
    cliSessionId: agent === "claude" && surface === "terminal" ? crypto.randomUUID() : null,
  });
  if (task.agent !== agent) repo.updateTask(task.id, { agent });
  if (!here && surface !== "cloud") {
    repo.addSessionEvent(session.id, "queued", `Waiting for ${device.name} to open it`);
    return { ok: true, session, message: `${task.key} starts when ${device.name} picks it up` };
  }
  return launch(session, task, device, env);
}

/** Opens a session that was just created, on this device. */
function launch(session: Session, task: Task, device: Device, env = ""): LaunchResult {
  const agent = session.agent;
  const folder = session.folder!;
  const dir = sessionDir(session.id);
  const place = where[session.surface](agent, device);
  let failed: string | null = null;
  if (session.surface === "desktop") {
    failed = openUrl(desktopLink(agent, folder, kickoffPrompt(task, session.id)));
  } else if (session.surface === "cloud" && agent === "codex") {
    sendToCodexCloud(session, task, env);
  } else if (session.surface === "cloud") {
    // In a terminal you can watch: `claude --cloud` shows the cloud session being set up, and its link.
    const quote = process.platform === "win32" ? cmdQuote : shQuote;
    failed = openTerminal(dir, folder, `${task.key} · ${CLOUD_LABEL[agent]}`, `${cliCommand(agent, device)} --cloud ${quote(cloudPrompt(task))}`);
  } else {
    failed = openTerminal(dir, folder, `${task.key} · ${AGENT_LABEL[agent]}`, agentCommand(agent, dir, session, task, false));
  }
  if (failed) {
    repo.updateSession(session.id, { status: "failed", endedAt: session.startedAt, note: failed });
    repo.addSessionEvent(session.id, "failed", failed);
    return { ok: false, error: failed };
  }
  let message: string;
  if (session.surface === "desktop") {
    // The app writes the first message; the session starts when you send it and the agent checks in.
    repo.addSessionEvent(session.id, "opened", `Opened in ${place}. Send the first message there to start.`);
    message = `Opened ${task.key} in the ${APP_LABEL[agent]}. Send the first message there to start.`;
  } else if (session.surface === "cloud" && agent === "codex") {
    repo.addSessionEvent(session.id, "sending", `Sending it to ${place}`);
    message = `Sending ${task.key} to ${place}`;
  } else if (session.surface === "cloud") {
    repo.updateSession(session.id, { status: "running", url: CLOUD_HOME[agent] });
    repo.addSessionEvent(session.id, "started", `Sent to ${place} from a terminal in ${path.basename(folder)}`);
    message = `Sending ${task.key} to ${place}. The terminal shows its link.`;
  } else {
    repo.updateSession(session.id, { status: "running" });
    repo.addSessionEvent(session.id, "started", `Started ${AGENT_LABEL[agent]} in ${place}`);
    message = `Started ${task.key} in a new terminal`;
  }
  if (task.status === "todo" || task.status === "backlog") repo.updateTask(task.id, { status: "progress" });
  return { ok: true, session: repo.getSession(session.id)!, message };
}

/** Opens sessions that another device queued for this one. Runs with the background tick. */
export function launchQueued() {
  const me = thisDeviceId();
  for (const s of repo.listSessions("status = 'starting' AND device_id = ?", me)) {
    const events = repo.sessionEvents(s.id);
    if (events[events.length - 1]?.kind !== "queued") continue;
    const task = repo.getTask(s.taskId);
    if (!task) continue;
    launch(s, task, deviceFor(me, null));
  }
}

/**
 * Picks a session up again: a terminal session reopens its terminal (Claude resumes the same conversation), a
 * desktop session shows its app, and a cloud session opens in a terminal with `claude --teleport` (Claude) or on
 * the web (Codex).
 */
export function resumeSession(sessionId: string, surface?: Surface): LaunchResult {
  const session = repo.getSession(sessionId);
  if (!session) return { ok: false, error: "Session not found" };
  const task = repo.getTask(session.taskId);
  if (!task || !session.folder) return { ok: false, error: "The task or its folder is gone" };
  const to = surface ?? session.surface;
  const dir = sessionDir(session.id);
  let failed: string | null;
  let text: string;
  if (to === "desktop") {
    // A Claude Code conversation from a terminal can move into the Claude app.
    const link = session.agent === "claude" && session.cliSessionId && session.surface === "terminal"
      ? `claude://resume?session=${encodeURIComponent(session.cliSessionId)}`
      : desktopHome(session.agent);
    failed = openUrl(link);
    text = `Opened in the ${APP_LABEL[session.agent]}`;
  } else if (session.surface === "cloud") {
    if (session.agent === "claude") {
      failed = openTerminal(dir, session.folder, `${task.key} · teleport`, `${cliCommand("claude", thisDevice())} --teleport`);
      text = "Opened a terminal to pull the cloud session in (claude --teleport)";
    } else {
      failed = openUrl(session.url ?? CLOUD_HOME.codex);
      text = `Opened ${CLOUD_LABEL.codex}`;
    }
  } else {
    failed = openTerminal(dir, session.folder, `${task.key} · ${AGENT_LABEL[session.agent]}`, agentCommand(session.agent, dir, session, task, true));
    text = "Reopened in a terminal";
  }
  if (failed) return { ok: false, error: failed };
  repo.addSessionEvent(session.id, "resumed", text);
  return { ok: true, session, message: text };
}
