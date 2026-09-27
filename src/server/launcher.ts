import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { trustCheck, trustForClaude } from "./claude-trust";
import { trustForCodex } from "./codex-trust";
import { cliCommand, deviceIdFor, localTools, runsHere, thisDeviceId, toolsCheckedAt } from "./devices";
import { folderProblem, repoRoot } from "./folders";
import { AGENT_ALLOWED_TOOLS } from "./mcp/agent-tools";
import * as repo from "./repo";
import { MODE } from "./supabase";
import { activeDevice } from "./scope";
import { dataDir, deviceConfig, issueSessionToken, projectFolder, projectServers } from "./device";
import { claudeServers, codexServersOff } from "./extras";
import { HOST_SESSION_VARS, agentEnv, execLine, openUrl } from "./shell";
import { nowStamp } from "@/lib/dates";
import { terminalFor } from "@/lib/terminals";
import {
  AGENT_LABEL, APP_LABEL, CLOUD_LABEL, LIVE_STATUSES, TRUST_FIRST, agentOf, canRun, surfaceOf,
  type AgentId, type Session, type Surface, type Task, type TerminalId,
} from "@/lib/types";

/*
 * Opens Claude Code or Codex: in a terminal or the agent's desktop app on this computer, or in the agent's cloud.
 * This is the one place PacedMind runs anything on your computer, so it trusts nothing that comes from the cloud:
 * the task's key, title and ids are checked or reduced to plain characters before they reach a command line or a
 * link, and the command, terminal and folders come from this computer's own settings (device.ts), never from a
 * session's or task's record. Each terminal session gets its own MCP token, which only works for that session's
 * tools and stops working when the session ends. The desktop apps use your own connection (Settings → Connect),
 * and cloud sessions can't reach PacedMind at all.
 *
 * Only the desktop app's own window, the flows it switched on and requests you allowed call startSession
 * (see the callers): the hosted web app and agents over MCP can only ask (requests.ts).
 */

export interface LaunchResult {
  ok: boolean;
  session?: Session;
  error?: string;
  /** What happened, for a toast. */
  message?: string;
}

/** Where agents reach this server. Next sets PORT to the port it listens on (the app uses 4319, `npm run dev` 4320). */
export function baseUrl(): string {
  const port = Number(process.env.PORT);
  return `http://127.0.0.1:${Number.isInteger(port) && port > 0 && port < 65536 ? port : 4319}`;
}

export function mcpUrl(): string {
  return `${baseUrl()}/api/mcp`;
}

/** Where you follow cloud sessions. */
export const CLOUD_HOME: Record<AgentId, string> = { claude: "https://claude.ai/code", codex: "https://chatgpt.com/codex" };

const TASK_KEY = /^[A-Z][A-Z0-9]{1,7}-[1-9][0-9]{0,8}$/;
const SESSION_ID = /^[0-9a-f]{16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The only links a Codex cloud session's record may send the browser to. */
const CODEX_TASK_URL = /^https:\/\/chatgpt\.com\/codex\/tasks\/[\w-]+$/;

/**
 * Keeps text safe for .cmd files, Windows Terminal and shell scripts, inside double quotes: letters, digits,
 * spaces and . , : _ - · / only. Line breaks become spaces first, so lines don't run together.
 */
const safe = (s: string, max = 400) => s.replace(/\s+/g, " ").replace(/[^\p{L}\p{N} .,:_\-·/]/gu, "").replace(/ {2,}/g, " ").trim().slice(0, max);

export function kickoffPrompt(task: Task, sessionId: string): string {
  return safe(
    `PacedMind task ${task.key}, session ${sessionId}. Call the organizer MCP tool start_task with task ${task.key} and session ${sessionId}, then follow the instructions it returns.`,
  );
}

/**
 * The first message when an agent goes back to a task because the user asked for changes or answered its questions
 * (see requestChanges in ops.ts).
 */
export function changesPrompt(task: Task, sessionId: string): string {
  return safe(
    `PacedMind task ${task.key}, session ${sessionId}: the user reviewed your work and wrote back. Call the organizer MCP tool start_task with task ${task.key} and session ${sessionId} to read it, then follow the instructions it returns.`,
  );
}

/**
 * The first message of a cloud session. The cloud can't reach PacedMind on this computer, so the task comes along
 * in full and the agent hands the work back as a branch and a pull request. Codex cloud reads it from its input;
 * on a command line (`claude --cloud`) it's reduced to plain characters like everything else there.
 */
export function cloudPrompt(task: Task): string {
  const subs = task.subtasks.map((s) => `- [${s.done ? "x" : " "}] ${s.title}`);
  return [
    `Task ${task.key}: ${task.title}`,
    task.description.trim(),
    task.doneWhen.length ? `Done when:\n${task.doneWhen.map((c) => `- ${c}`).join("\n")}` : "",
    subs.length ? `Sub-tasks:\n${subs.join("\n")}` : "",
    `Work on a new branch named agent/${task.key.toLowerCase()} and open a pull request when it's ready for review. ` +
      "This task comes from PacedMind, which you can't reach from here, so don't look for its tools.",
  ].filter(Boolean).join("\n\n").slice(0, 6000);
}

function sessionDir(id: string): string {
  if (!SESSION_ID.test(id)) throw new Error("Invalid session id");
  const dir = path.join(/*turbopackIgnore: true*/ dataDir(), "sessions", id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function writePrivate(file: string, text: string, mode = 0o600) {
  fs.writeFileSync(file, text, { mode });
}

/** Where the hooks' curl puts the server's answer: nothing a hook prints may reach the agent (UserPromptSubmit's goes into the conversation). */
const DEV_NULL = process.platform === "win32" ? "NUL" : "/dev/null";

/**
 * The session's token as a header line, in a file only you can read, for Codex's notify (`curl -H @file`), so the
 * token isn't on a command line for as long as Codex runs. Each launch has its own file and removes the older ones: a
 * terminal still open from an earlier launch then has no token to send.
 */
function writeHookAuth(dir: string, token: string): string {
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".auth")) fs.rmSync(path.join(dir, f), { force: true });
  const file = path.join(dir, `hooks-${crypto.randomBytes(4).toString("hex")}.auth`);
  writePrivate(file, `Authorization: Bearer ${token}\n`);
  return file;
}

/**
 * Claude Code runs hooks of type "http" itself, since before 2.1.84: no process per tool call, and nothing to go wrong
 * once the session's files are gone. An older one, as far as this computer found, gets curl.
 */
function httpHooks(): boolean {
  const v = localTools().claude.cli?.version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!v) return true;
  const [major, minor, patch] = v.slice(1).map(Number);
  return major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 84)));
}

/**
 * One of a Claude Code conversation's hooks: a POST to the session's route with the session's token, from Claude Code
 * itself, or from curl for an older one (with `body`, curl passes on the JSON the agent gives the hook). Nothing it
 * gets back reaches the agent: the routes answer without a body, and curl's goes nowhere.
 */
function claudeHook(url: string, token: string, body: boolean) {
  if (httpHooks()) return { type: "http", url, headers: { Authorization: `Bearer ${token}` }, timeout: 10 };
  const data = body ? ` -H "Content-Type: application/json" --data-binary @-` : "";
  return { type: "command", command: `curl -s -m 5 -o ${DEV_NULL} -X POST -H "Authorization: Bearer ${token}"${data} "${url}"`, timeout: 10 };
}

/**
 * The MCP config and the hooks for one Claude Code conversation (`cli`). SessionEnd closes the session when its
 * terminal closes; the others tell PacedMind when the agent waits for you, asks for your permission, or goes back to
 * work (signals.ts). The hooks name their conversation, and each conversation has its own settings file, so a
 * terminal still open on an older conversation of the session says nothing about it. `servers`: the other MCP
 * servers the session gets when its project picks them (Settings), which it then gets alone (--strict-mcp-config).
 * Like the token, their definitions stay in files only you can read, deleted when the session ends.
 */
function writeClaudeConfig(dir: string, sessionId: string, cli: string, token: string, servers: Record<string, unknown> | null) {
  const mcp = { mcpServers: { ...(servers ?? {}), organizer: { type: "http", url: mcpUrl(), headers: { Authorization: `Bearer ${token}` } } } };
  const route = `${baseUrl()}/api/sessions/${sessionId}`;
  const signal = (kind: string, body: boolean, matcher?: string) => [{
    ...(matcher ? { matcher } : {}), hooks: [claudeHook(`${route}/signal?kind=${kind}&cli=${cli}`, token, body)],
  }];
  const settings = {
    hooks: {
      SessionEnd: [{ hooks: [claudeHook(`${route}/ended?cli=${cli}`, token, false)] }],
      Stop: signal("stop", true),
      Notification: signal("notify", true, "permission_prompt|idle_prompt|elicitation_dialog|agent_needs_input"),
      UserPromptSubmit: signal("prompt", false),
      PostToolUse: signal("tool", false),
    },
  };
  const mcpFile = path.join(dir, "mcp.json");
  const settingsFile = path.join(dir, `settings-${cli}.json`);
  writePrivate(mcpFile, JSON.stringify(mcp, null, 2));
  writePrivate(settingsFile, JSON.stringify(settings, null, 2));
  return { mcpFile, settingsFile };
}

/**
 * Codex's `notify` for a session: when a turn ends, curl posts what Codex passes it (the turn as JSON, appended as the
 * last argument, here the value of --data-raw) to the session's signal route. No shell runs it, so what the agent said
 * never meets a command line. It stands in for the user's own notify setting while the session runs. Empty when the
 * folder's path has characters the quoting below can't carry.
 */
function codexNotify(dir: string, sessionId: string, token: string): string {
  const auth = writeHookAuth(dir, token);
  if (/['"%$`!\r\n]/.test(auth)) return "";
  const args = ["curl", "-s", "-m", "5", "-o", DEV_NULL, "-H", `@${auth}`, "-H", "Content-Type: application/json",
    `${baseUrl()}/api/sessions/${sessionId}/signal?kind=turn`, "--data-raw"];
  return ` -c "notify=[${args.map((a) => `'${a}'`).join(",")}]"`;
}

/**
 * The command line that opens the agent in a terminal in `folder` (without folder/title handling). start: a new
 * conversation with the kickoff message. resume: back into the last conversation. changes: a new conversation whose
 * first message says the user wrote back; start_task hands it the changes and the last report. (An interactive
 * Claude Code that resumes a conversation answers its first message before PacedMind's MCP server is back, drops the
 * tools the conversation had, and gives up.) Also returns the Claude Code conversation it runs (null for Codex).
 *
 * When the task's project picks the MCP servers its sessions get here (Settings), Claude Code gets those alone
 * (--strict-mcp-config, which also leaves out the plugins' servers) and Codex has the others switched off.
 */
function agentCommand(dir: string, session: Session, task: Task, kind: "start" | "resume" | "changes", token: string, folder: string): {
  command: string; conversation: string | null;
} {
  const exe = cliCommand(session.agent);
  const prompt = kind === "changes" ? changesPrompt(task, session.id) : kickoffPrompt(task, session.id);
  const servers = projectServers(task.projectId);
  if (session.agent === "codex") {
    // PacedMind's MCP server for this session, whatever config.toml says; the token comes from ORGANIZER_TOKEN,
    // which the terminal script sets. Settings → Connect puts the owner token in the same table as a header, so
    // the headers are cleared: the session must only ever send its own token.
    const mcp = [
      `-c mcp_servers.organizer.url="${mcpUrl()}"`, `-c mcp_servers.organizer.bearer_token_env_var="ORGANIZER_TOKEN"`,
      "-c mcp_servers.organizer.http_headers={}", "-c mcp_servers.organizer.env_http_headers={}", "-c mcp_servers.organizer.enabled=true",
      ...(servers ? codexServersOff(folder, servers).map((name) => `-c mcp_servers.${name}.enabled=false`) : []),
    ].join(" ") + codexNotify(dir, session.id, token);
    return { command: kind === "resume" ? `${exe} ${mcp} resume --last` : `${exe} ${mcp} "${prompt}"`, conversation: null };
  }
  const last = session.cliSessionId && UUID.test(session.cliSessionId) ? session.cliSessionId : null;
  // A start and a resume run the conversation the session names (a start's was made with the session); changes get
  // a new one.
  const conversation = last && kind !== "changes" ? last : crypto.randomUUID();
  const { mcpFile, settingsFile } = writeClaudeConfig(dir, session.id, conversation, token, servers && claudeServers(folder, servers));
  const allowed = AGENT_ALLOWED_TOOLS.map((t) => `mcp__organizer__${t}`).join(",");
  const base = `${exe} --mcp-config "${mcpFile}"${servers ? " --strict-mcp-config" : ""} --settings "${settingsFile}" --allowedTools ${allowed}`;
  if (last && kind === "resume") return { command: `${base} --resume ${last}`, conversation };
  return { command: `${base} --session-id ${conversation} -n "${safe(`${task.key} ${task.title}`, 80)}" "${prompt}"`, conversation };
}

/**
 * Sends a task to Codex cloud from the task's folder: `codex cloud exec` reads the task from its input, prints the
 * new task's link and returns. It runs out of sight; the session records the link, or why it failed. The
 * environment was checked against the same pattern the database keeps (repo.CODEX_ENV).
 */
function sendToCodexCloud(session: Session, task: Task, folder: string, env: string) {
  const line = `${cliCommand("codex")} cloud exec --env "${env}" -`;
  void execLine(line, { cwd: folder, input: cloudPrompt(task), timeout: 120_000 }).then(async ({ code, stdout, stderr }) => {
    const url = stdout.match(/https:\/\/chatgpt\.com\/codex\/tasks\/[\w-]+/)?.[0];
    if (code === 0 && url) {
      await repo.updateSession(session.id, { status: "running", url });
      await repo.addSessionEvent(session.id, "started", `Codex cloud took it on in the ${safe(env, 100)} environment`);
      return;
    }
    const why = ((stderr || stdout).trim().split(/\r?\n/).filter(Boolean).pop() ?? `codex cloud exec stopped (${code})`).slice(0, 2000);
    await repo.updateSession(session.id, { status: "failed", endedAt: nowStamp(), note: why });
    await repo.addSessionEvent(session.id, "failed", why);
  }).catch((e) => console.error("[organizer] Codex cloud send failed", e));
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

/** Opens a terminal in `folder` that runs `command`; `token` (a session's MCP token) goes into its ORGANIZER_TOKEN. */
function openTerminal(dir: string, folder: string, title: string, command: string, token: string | null, terminal: TerminalId): string | null {
  const env = agentEnv();
  try {
    if (process.platform === "win32") {
      const script = path.join(dir, "start.cmd");
      writePrivate(script, [
        "@echo off", "chcp 65001 >nul", `title ${title}`, `cd /d "${folder}"`, ...HOST_SESSION_VARS.map((v) => `set ${v}=`),
        ...(token ? [`set ORGANIZER_TOKEN=${token}`] : []), command, "",
      ].join("\r\n"));
      if (terminalFor(terminal, "win32").value === "wt") {
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
    if (process.platform === "darwin") return openMacTerminal(dir, folder, title, token, command, terminal);
    const script = path.join(dir, "start.sh");
    writePrivate(script, [
      "#!/bin/sh", `cd "${folder}"`, `unset ${HOST_SESSION_VARS.join(" ")}`, ...(token ? [`export ORGANIZER_TOKEN=${token}`] : []), command, "",
    ].join("\n"), 0o700);
    spawn("x-terminal-emulator", ["-e", script], { detached: true, stdio: "ignore", env }).unref();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function openCmdWindow(title: string, script: string, env: NodeJS.ProcessEnv) {
  spawn("cmd.exe", ["/c", `start "${title}" cmd /k "${script}"`], { detached: true, stdio: "ignore", windowsVerbatimArguments: true, env }).unref();
}

/**
 * macOS: a .command file opens in a new Terminal or iTerm window. Terminal runs it from a login shell,
 * so the agent finds the user's own PATH, and `open` needs no permission to control another app.
 * The escape sequence names the window. Without iTerm installed, the session opens in Terminal.
 */
function openMacTerminal(dir: string, folder: string, title: string, token: string | null, command: string, terminal: TerminalId): string | null {
  const script = path.join(dir, "start.command");
  writePrivate(script, [
    "#!/bin/sh", `printf '\\033]0;%s\\007' "${title}"`, `cd "${folder}" || exit 1`, `unset ${HOST_SESSION_VARS.join(" ")}`,
    ...(token ? [`export ORGANIZER_TOKEN=${token}`] : []), command, "",
  ].join("\n"), 0o700);
  const apps = terminalFor(terminal, "darwin").value === "iterm" ? ["iTerm", "Terminal"] : ["Terminal"];
  let error = "";
  for (const app of apps) {
    try {
      execFileSync("open", ["-a", app, script], { stdio: "pipe", env: agentEnv() });
      return null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  return `Couldn't open a terminal: ${error}`;
}

/**
 * Whether Claude Code, opened in a terminal in `folder`, first asks whether you trust it (claude-trust.ts). Checked
 * before the terminal opens, so the answer can't have come in yet.
 */
const asksTrust = (agent: AgentId, folder: string) => agent === "claude" && !!trustCheck()?.(folder);

/**
 * Answers the agent's question whether you trust the folder before it starts there, when this computer's setting says
 * so (device.ts `trustFolders`), so the session never waits for it in its terminal.
 */
function trustAhead(agent: AgentId, folder: string) {
  if (!deviceConfig().trustFolders) return;
  try {
    if (agent === "claude") trustForClaude(folder);
    else trustForCodex(folder);
  } catch (e) {
    console.error("[organizer] couldn't answer the folder question ahead", e);
  }
}

/** A message about a terminal that just opened, and what to answer in it first when Claude Code asks about the folder. */
const withTrust = (message: string, asks: boolean) => (asks ? `${message.replace(/\.?$/, ".")} ${TRUST_FIRST}` : message);

/**
 * Where a task's sessions run here: its own folder on this computer, else its project's, else a scratch folder per
 * task. All three come from this computer's settings.
 */
export function plannedFolder(task: { key: string; projectId: string | null; folder: string | null }): string | null {
  if (!TASK_KEY.test(task.key)) return null;
  return task.folder ?? projectFolder(task.projectId) ?? path.join(dataDir(), "workspaces", task.key.toLowerCase());
}

function resolveFolder(task: Task): { folder?: string; error?: string } {
  const own = task.folder;
  const set = own ?? projectFolder(task.projectId);
  if (set) {
    const problem = folderProblem(set);
    if (problem) return { error: `Can't use the folder ${set}: ${problem} Change it ${own ? "in the task's details" : "in Settings"}.` };
    return { folder: set };
  }
  const folder = plannedFolder(task)!;
  fs.mkdirSync(folder, { recursive: true });
  return { folder };
}

/** Deletes the files of sessions that ended (their MCP config holds a token that no longer works anyway). */
export function forgetSessionFiles(sessionIds: string[]) {
  for (const id of sessionIds) {
    if (!SESSION_ID.test(id)) continue;
    try {
      fs.rmSync(path.join(/*turbopackIgnore: true*/ dataDir(), "sessions", id), { recursive: true, force: true });
    } catch {
      // A terminal still reading its start script keeps it; it goes with the next cleanup.
    }
  }
}

/** Refuses what the cloud could have shaped to break out of a command line or a folder path. */
function checkTask(task: Task): string | null {
  if (!TASK_KEY.test(task.key)) return `The task key ${safe(task.key, 20)} isn't in the expected shape, so PacedMind won't start it.`;
  return null;
}

/** Where a session of `agent` runs that way, in words. */
function place(surface: Surface, agent: AgentId): string {
  const here = safe(deviceConfig().name, 80) || "this computer";
  if (surface === "desktop") return `the ${APP_LABEL[agent]} on ${here}`;
  if (surface === "cloud") return CLOUD_LABEL[agent];
  return `a terminal on ${here}`;
}

/** Why this computer can't run an agent's session that way, or null (also before it looked for the agents). */
function surfaceProblem(agent: AgentId, surface: Surface): string | null {
  const tools = localTools()[agent];
  if (!toolsCheckedAt() || canRun(tools, surface)) return null;
  if (surface === "desktop") return `The ${APP_LABEL[agent]} isn't installed on this computer.`;
  const cli = agent === "claude" ? "Claude Code CLI (claude)" : "Codex CLI (codex)";
  return surface === "cloud"
    ? `${CLOUD_LABEL[agent]} sessions start from the ${cli}, which isn't installed on this computer.`
    : `The ${cli} isn't installed on this computer.${tools.app ? ` Run it in the ${APP_LABEL[agent]} instead.` : ""}`;
}

/** Where a task's session would run here, as startSession decides it: for requests you are asked about. */
export function plannedSurface(task: Task, agent: AgentId): Surface {
  return surfaceOf(task.runIn, toolsCheckedAt() ? localTools()[agent] : undefined);
}

/* One launch at a time, so two paths (a flow and a click, say) can't both start the same task. */
const g = globalThis as unknown as { __pacedmindLaunchLock?: Promise<unknown> };
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = (g.__pacedmindLaunchLock ?? Promise.resolve()).then(fn, fn);
  g.__pacedmindLaunchLock = run.catch(() => undefined);
  return run;
}

/** Why the session was started, for its history. */
export type LaunchReason = "you" | "flow" | "approved" | "remote";

const REASON_TEXT: Record<LaunchReason, string> = {
  you: "you started it here",
  flow: "its flow started it",
  approved: "you allowed a request",
  remote: "a request with a fresh 2FA code",
};

/**
 * Starts a session for a task where the task says: in a terminal or the agent's desktop app on this computer, or in
 * the agent's cloud. Only for the desktop app: call it from the app's own window, a flow switched on here, or a
 * request that this computer's settings allow. A task that runs on another computer starts there. With `expect`
 * (what you allowed), it refuses when the task, agent, folder or way it runs changed since.
 */
export function startSession(
  taskId: number,
  options: { agent?: AgentId; surface?: Surface; reason: LaunchReason; expect?: { key: string; agent: AgentId; folder: string; surface: Surface } },
): Promise<LaunchResult> {
  return exclusive(async () => {
    if (MODE !== "desktop") return { ok: false, error: "Sessions start in the PacedMind desktop app." };
    const device = await activeDevice();
    const task = await repo.getTask(taskId);
    if (!task) return { ok: false, error: "Task not found" };
    const bad = checkTask(task);
    if (bad) return { ok: false, error: bad };
    if (task.agent === "human") return { ok: false, error: `${task.key} is marked as yours. Hand it to Claude Code or Codex before starting a session.` };
    if ((await repo.listSessions({ taskId: task.id, status: LIVE_STATUSES })).length) {
      return { ok: false, error: `${task.key} already has a running session` };
    }
    const project = task.projectId ? await repo.getProject(task.projectId) : null;
    const agent: AgentId = options.agent ?? agentOf(task, project?.agent) ?? "claude";
    if (agent !== "claude" && agent !== "codex") return { ok: false, error: "Unknown agent" };
    const runsOn = deviceIdFor(task.deviceId, project?.deviceId);
    if (!runsHere(runsOn)) {
      const other = runsOn ? await repo.getDevice(runsOn) : null;
      return { ok: false, error: `${task.key} runs on ${other ? safe(other.name, 80) : "another computer"}. Start it there, or pick this computer in its details.` };
    }
    const surface = options.surface ?? plannedSurface(task, agent);
    const problem = surfaceProblem(agent, surface);
    if (problem) return { ok: false, error: problem };
    const env = project?.codexEnv?.trim() ?? "";
    if (surface === "cloud" && agent === "codex") {
      if (!env) return { ok: false, error: `Pick the Codex cloud environment ${project ? project.name : "this task"} runs in first: its label from chatgpt.com/codex/settings/environments.` };
      const envProblem = repo.codexEnvProblem(env);
      if (envProblem) return { ok: false, error: `The Codex cloud environment can't go on a command line. ${envProblem}` };
    }
    const { folder, error } = resolveFolder(task);
    if (!folder) return { ok: false, error };
    // The cloud works on a copy of the repository (from GitHub, or uploaded), so there has to be one.
    if (surface === "cloud" && !repoRoot(folder)) {
      return { ok: false, error: `${CLOUD_LABEL[agent]} works on a git repository, and ${folder} isn't in one. Give ${task.key} or its project a repository folder.` };
    }
    const e = options.expect;
    if (e && (e.key !== task.key || e.agent !== agent || e.folder !== folder || e.surface !== surface)) {
      return { ok: false, error: `${task.key} changed after you allowed it (its task, agent, folder or where it runs). Ask for the session again.` };
    }

    const session = await repo.createSession({
      taskId: task.id, agent, surface, folder, deviceId: device.deviceId, branch: `agent/${task.key.toLowerCase()}`,
      cliSessionId: agent === "claude" && surface === "terminal" ? crypto.randomUUID() : null,
    });
    if (task.agent !== agent) await repo.updateTask(task.id, { agent });
    return launch(session, task, folder, env, options.reason, device.terminal);
  });
}

/** Opens a session that was just created, on this computer. */
async function launch(session: Session, task: Task, folder: string, env: string, reason: LaunchReason, terminal: TerminalId): Promise<LaunchResult> {
  const agent = session.agent;
  const dir = sessionDir(session.id);
  const where = place(session.surface, agent);
  const title = safe(`${task.key} · ${session.surface === "cloud" ? CLOUD_LABEL[agent] : AGENT_LABEL[agent]}`, 60);
  // Codex cloud runs out of sight and asks nothing; everything else starts the agent in the folder here.
  if (!(session.surface === "cloud" && agent === "codex")) trustAhead(agent, folder);
  const trust = session.surface !== "desktop" && asksTrust(agent, folder);
  let failed: string | null = null;
  if (session.surface === "desktop") {
    failed = openUrl(desktopLink(agent, folder, kickoffPrompt(task, session.id)));
  } else if (session.surface === "cloud" && agent === "codex") {
    sendToCodexCloud(session, task, folder, env);
  } else if (session.surface === "cloud") {
    // In a terminal you can watch: `claude --cloud` shows the cloud session being set up, and its link.
    failed = openTerminal(dir, folder, title, `${cliCommand(agent)} --cloud "${safe(cloudPrompt(task), 3000)}"`, null, terminal);
  } else {
    const token = issueSessionToken(session.id, task.id);
    failed = openTerminal(dir, folder, title, agentCommand(dir, session, task, "start", token, folder).command, token, terminal);
  }
  if (failed) {
    await repo.updateSession(session.id, { status: "failed", endedAt: session.startedAt, note: failed.slice(0, 2000) });
    await repo.addSessionEvent(session.id, "failed", failed.slice(0, 2000));
    return { ok: false, error: failed };
  }
  let message: string;
  if (session.surface === "desktop") {
    // The app writes the first message; the session starts when you send it and the agent checks in.
    await repo.addSessionEvent(session.id, "opened", `Opened in ${where} (${REASON_TEXT[reason]}). Send the first message there to start.`);
    message = `Opened ${task.key} in the ${APP_LABEL[agent]}. Send the first message there to start.`;
  } else if (session.surface === "cloud" && agent === "codex") {
    await repo.addSessionEvent(session.id, "sending", `Sending it to ${where}: ${REASON_TEXT[reason]}`);
    message = `Sending ${task.key} to ${where}`;
  } else if (session.surface === "cloud") {
    await repo.updateSession(session.id, { status: "running", url: CLOUD_HOME[agent] });
    await repo.addSessionEvent(session.id, "started", `Sent to ${where} from a terminal in ${path.basename(folder)}: ${REASON_TEXT[reason]}`);
    message = `Sending ${task.key} to ${where}. The terminal shows its link.`;
  } else {
    await repo.updateSession(session.id, { status: "running" });
    await repo.addSessionEvent(session.id, "started", `Started ${AGENT_LABEL[agent]} in ${where}: ${REASON_TEXT[reason]}`);
    message = `Started ${task.key} in a new terminal`;
  }
  if (task.status === "todo" || task.status === "backlog") await repo.updateTask(task.id, { status: "progress" });
  return { ok: true, session: (await repo.getSession(session.id))!, message: withTrust(message, trust) };
}

/**
 * Why this computer can't pick a session up again (resumeSession), or null. `to` "desktop" moves a Claude Code
 * conversation from a terminal into the Claude app (for other sessions it shows the agent's app).
 */
export function resumeProblem(session: Session, to?: Surface): string | null {
  if (MODE !== "desktop") return "Resume it from the PacedMind desktop app, which opens terminals on your computer.";
  if (!SESSION_ID.test(session.id)) return "Session not found";
  if (to === "cloud") return "A session can't move into the cloud. Start a new one there instead.";
  // Cloud sessions can be picked up from any computer; the others only where they ran.
  if (session.surface !== "cloud" && session.deviceId && session.deviceId !== thisDeviceId()) return "That session ran on another computer. Resume it there.";
  // Its terminal is still open: a second one on the same conversation would get in its way.
  if (!to && session.surface === "terminal" && LIVE_STATUSES.includes(session.status)) {
    return "That session is still running in its terminal. Close it in PacedMind first if its terminal is gone.";
  }
  return null;
}

/**
 * Picks a session up again: a terminal session reopens its terminal (Claude resumes the same conversation), a
 * desktop session shows its app, and a cloud session opens in a terminal with `claude --teleport` (Claude) or on
 * the web (Codex). The folder comes from this computer, never from the session's record in the cloud.
 */
export function resumeSession(sessionId: string, to?: Surface): Promise<LaunchResult> {
  return exclusive(async () => {
    if (MODE !== "desktop") return { ok: false, error: "Resume it from the PacedMind desktop app, which opens terminals on your computer." };
    if (!SESSION_ID.test(sessionId)) return { ok: false, error: "Session not found" };
    const device = await activeDevice();
    const session = await repo.getSession(sessionId);
    if (!session) return { ok: false, error: "Session not found" };
    const problem = resumeProblem(session, to);
    if (problem) return { ok: false, error: problem };
    const task = await repo.getTask(session.taskId);
    if (!task) return { ok: false, error: "The task is gone" };
    const bad = checkTask(task);
    if (bad) return { ok: false, error: bad };
    const { folder, error } = resolveFolder(task);
    if (!folder) return { ok: false, error };
    const dir = sessionDir(session.id);
    const title = safe(`${task.key} · ${AGENT_LABEL[session.agent]}`, 60);
    const surface = to ?? session.surface;
    trustAhead(session.agent, folder);
    const trust = surface !== "desktop" && asksTrust(session.agent, folder);
    let failed: string | null;
    let text: string;
    if (surface === "desktop") {
      // A Claude Code conversation from a terminal can move into the Claude app.
      const cli = session.cliSessionId && UUID.test(session.cliSessionId) ? session.cliSessionId : null;
      failed = openUrl(session.agent === "claude" && cli && session.surface === "terminal"
        ? `claude://resume?session=${encodeURIComponent(cli)}` : desktopHome(session.agent));
      text = `Opened in the ${APP_LABEL[session.agent]}`;
    } else if (session.surface === "cloud") {
      if (session.agent === "claude") {
        failed = openTerminal(dir, folder, safe(`${task.key} · teleport`, 60), `${cliCommand("claude")} --teleport`, null, device.terminal);
        text = "Opened a terminal to pull the cloud session in (claude --teleport)";
      } else {
        failed = openUrl(session.url && CODEX_TASK_URL.test(session.url) ? session.url : CLOUD_HOME.codex);
        text = `Opened ${CLOUD_LABEL.codex}`;
      }
    } else {
      const token = issueSessionToken(session.id, task.id);
      const { command, conversation } = agentCommand(dir, session, task, "resume", token, folder);
      // Live again before its terminal opens, so however fast the agent calls, its token works: a closed session
      // runs again, and with no conversation to go back to, a new one started.
      const before = { status: session.status, endedAt: session.endedAt, cliSessionId: session.cliSessionId };
      await repo.updateSession(session.id, {
        endedAt: null, cliSessionId: conversation, ...(session.status === "closed" || session.status === "failed" ? { status: "running" as const } : {}),
      });
      failed = openTerminal(dir, folder, title, command, token, device.terminal);
      if (failed) await repo.updateSession(session.id, before);
      text = "Reopened in a terminal";
    }
    if (failed) return { ok: false, error: failed };
    await repo.addSessionEvent(session.id, "resumed", text);
    return { ok: true, session: (await repo.getSession(session.id))!, message: withTrust(text, trust) };
  });
}

/**
 * Why a session's agent can't take changes through PacedMind wherever it's asked from, or null: changes reach the agent
 * through start_task, which cloud sessions can't call, and the apps start new conversations.
 */
export function changesSurfaceProblem(session: Session): string | null {
  if (session.surface === "terminal") return null;
  const where = session.surface === "cloud" ? CLOUD_LABEL[session.agent] : `the ${APP_LABEL[session.agent]}`;
  return `This session runs in ${where}. Open it there and write your changes to the agent.`;
}

/** Why this computer can't reopen a session for changes, because it runs elsewhere, or null. */
export function reopenProblem(session: Session): string | null {
  if (MODE !== "desktop") return "Ask for changes in the PacedMind desktop app, which opens terminals on your computer.";
  const surface = changesSurfaceProblem(session);
  if (surface) return surface;
  if (session.deviceId && session.deviceId !== thisDeviceId()) return "This session ran on another computer. Ask for the changes in PacedMind there.";
  return null;
}

/**
 * Sends a terminal session back to work on changes the user asked for, or with answers to its questions (see
 * requestChanges in ops.ts). It reopens in a new conversation with a first message that says so, and start_task hands
 * it what you wrote and its last report. A Claude Code conversation has its own id, so a terminal still open on the
 * old one doesn't get in the way.
 */
export function reopenForChanges(sessionId: string): Promise<LaunchResult> {
  return exclusive(async () => {
    if (!SESSION_ID.test(sessionId)) return { ok: false, error: "Session not found" };
    const device = await activeDevice();
    const session = await repo.getSession(sessionId);
    if (!session) return { ok: false, error: "Session not found" };
    const task = await repo.getTask(session.taskId);
    if (!task) return { ok: false, error: "The task is gone" };
    const bad = checkTask(task);
    if (bad) return { ok: false, error: bad };
    const elsewhere = reopenProblem(session);
    if (elsewhere) return { ok: false, error: elsewhere };
    const { folder, error } = resolveFolder(task);
    if (!folder) return { ok: false, error };
    const dir = sessionDir(session.id);
    const token = issueSessionToken(session.id, task.id);
    const { command, conversation } = agentCommand(dir, session, task, "changes", token, folder);
    // The new conversation counts before its terminal opens, so a terminal still open on the old one can't end the session.
    if (conversation !== session.cliSessionId) await repo.updateSession(session.id, { cliSessionId: conversation });
    trustAhead(session.agent, folder);
    const trust = asksTrust(session.agent, folder);
    const failed = openTerminal(dir, folder, safe(`${task.key} · ${AGENT_LABEL[session.agent]}`, 60), command, token, device.terminal);
    if (failed) {
      if (conversation !== session.cliSessionId) await repo.updateSession(session.id, { cliSessionId: session.cliSessionId });
      return { ok: false, error: failed };
    }
    return { ok: true, session: (await repo.getSession(session.id))!, message: withTrust(`Sent to ${AGENT_LABEL[session.agent]} in a new terminal`, trust) };
  });
}
