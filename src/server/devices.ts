import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pkg from "../../package.json";
import { readAgentCatalog } from "./agent-models";
import type { ModelCatalog } from "@/lib/agent-models";
import * as repo from "./repo";
import { agentCommandFor, deviceConfig, thisPlatform, updateDevice } from "./device";
import { agentExtras, folderExtras, serverChoices } from "./extras";
import { usesCloud } from "./scope";
import { execLine, plainCommand, runCommand, runFile } from "./shell";
import { appVersionOk, loginOf } from "./store/shared";
import { cloudMcpUrl } from "./supabase-config";
import { deviceWithNeeds } from "@/lib/needs";
import {
  MCP_NAME, NO_AGENT_TOOLS, OLD_MCP_NAME, type AgentExtras, type AgentId, type AgentLogin, type AgentTools, type Device, type McpLink,
} from "@/lib/types";

/*
 * This computer and the others signed in to the account. Each desktop app registers itself in the account's
 * devices (requests.ts) and looks for the agents here: the Claude Code and Codex command-line tools, their
 * desktop apps, whether those apps can reach PacedMind's MCP server, and whether each CLI is signed in. What it
 * finds stays in memory for starting sessions here, and a copy without paths, emails or keys goes to the cloud,
 * so Settings on every computer shows it. Sessions run on a computer in a terminal or an agent's desktop app.
 */

/** PacedMind's version here, as this computer reports it to the account (null if it isn't in the shape the database keeps). */
export const APP_VERSION: string | null = appVersionOk(pkg.version) ? pkg.version : null;

const g = globalThis as unknown as {
  __pacedmindTools?: Device["agents"];
  __pacedmindToolsAt?: string;
  __pacedmindCheck?: Promise<Device["agents"]> | null;
  __pacedmindModelChecks?: Partial<Record<AgentId, Promise<ModelCatalog>>>;
  /** The computer id the latest tools were saved for. */
  __pacedmindToolsSaved?: string;
  /** The CLI inside the Codex app's package on Windows, where desktopApps last found the app. */
  __pacedmindCodexAppCli?: string | null;
};

/** This computer's id in the account's list, once registered (null before that, and in the web app). */
export const thisDeviceId = (): string | null => deviceConfig().deviceId;

/** What this computer found of the agents; nothing until the first check finished. */
export const localTools = (): Device["agents"] => g.__pacedmindTools ?? { claude: NO_AGENT_TOOLS, codex: NO_AGENT_TOOLS };

/** When this computer last looked for the agents; null until the first check finished. */
export const toolsCheckedAt = (): string | null => g.__pacedmindToolsAt ?? null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Projects whose flow is switched on here (display only; device.ts decides), sorted: with `cloud`, only the account's
 * (their ids are UUIDs; this computer's own data names projects by slug).
 */
export const flowsOnHere = (cloud = false): string[] => [...new Set(deviceConfig().armed)].filter((id) => !cloud || UUID.test(id)).sort();

/**
 * This computer as the app shows it: its entry in the account's list, with what it found of the agents itself, its
 * own setting for requests from elsewhere, its version and its flows. Without an account it's the only computer (id
 * "", or the id it had in an account before signing out), so the default. Desktop app only: the web app has no
 * computer of its own.
 */
export async function thisDevice(): Promise<Device> {
  const d = deviceConfig();
  const cloud = await usesCloud();
  const row = d.deviceId && cloud ? await repo.getDevice(d.deviceId).catch(() => null) : null;
  return {
    id: d.deviceId ?? "", name: row?.name ?? d.name, platform: row?.platform ?? thisPlatform(), remoteStart: d.remoteStart,
    agents: localTools(), createdAt: row?.createdAt ?? "", lastSeenAt: row?.lastSeenAt ?? null,
    checkedAt: g.__pacedmindToolsAt ?? row?.checkedAt ?? null, revokedAt: row?.revokedAt ?? null,
    isDefault: row ? row.isDefault : !cloud, appVersion: APP_VERSION, flowsOn: flowsOnHere(cloud),
    // The Sessions page looks for this computer's own itself (other-sessions.ts), more often than it reports them.
    otherSessions: [],
  };
}

/** The computer a task's sessions run on: its own, else its project's. Null means the computer that starts them. */
export const deviceIdFor = (taskDeviceId: string | null, projectDeviceId: string | null | undefined): string | null =>
  taskDeviceId ?? projectDeviceId ?? null;

/** Whether sessions for that computer may start here. */
export const runsHere = (deviceId: string | null) => !deviceId || deviceId === thisDeviceId();

/**
 * The computer to offer for a task's session elsewhere (the web app, or a task that runs on another computer): the one
 * the task names, else its project's, else, for a task that needs something (Task.needs), one whose agent has it
 * (online first, the default first), else the account's default. `pinned` when the task or its project named it: its
 * sessions start only there, and a request to another computer is refused.
 */
export function offeredDevice(
  task: { deviceId: string | null; needs: string[] }, project: { deviceId: string | null } | null | undefined, devices: Device[],
  agent: AgentId | null = "claude",
): { deviceId: string | null; pinned: boolean } {
  const named = deviceIdFor(task.deviceId, project?.deviceId);
  if (named) return { deviceId: named, pinned: true };
  const fallback = devices.find((x) => x.isDefault && !x.revokedAt)?.id ?? null;
  const has = task.needs.length && agent ? deviceWithNeeds(task.needs, agent, devices, fallback) : null;
  return { deviceId: has?.id ?? fallback, pinned: false };
}

/**
 * What an agent has on this computer for a session in `folder`, by name: the MCP servers it has everywhere and in the
 * folder, the claude.ai connectors its sessions got from the account it's signed in to, and its plugins. What a task's
 * needs are matched against here (src/lib/needs.ts).
 */
export function toolsHere(agent: AgentId, folder: string | null): string[] {
  const x = localTools()[agent].extras;
  return [...serverChoices(folder)[agent], ...(x?.account ?? []), ...(x?.plugins ?? []), ...(folder ? folderExtras(folder).plugins : [])];
}

/* ---------- looking for the agents ---------- */

const home = os.homedir();
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || home;
const codexHome = () => process.env.CODEX_HOME || path.join(home, ".codex");

/** Where the installers put each CLI, for when it isn't on the PATH PacedMind sees (an app started from the Dock, say). */
function cliPlaces(agent: AgentId): string[] {
  const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  const roaming = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
  if (process.platform === "win32") {
    return agent === "claude"
      ? [path.join(home, ".local", "bin", "claude.exe"), path.join(roaming, "npm", "claude.cmd")]
      : [path.join(local, "Programs", "OpenAI", "Codex", "bin", "codex.exe"), path.join(local, "Microsoft", "WinGet", "Links", "codex.exe"), path.join(roaming, "npm", "codex.cmd")];
  }
  const bins = ["/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".local", "bin")];
  return agent === "claude"
    ? [...bins.map((b) => path.join(b, "claude")), path.join(home, ".claude", "local", "claude")]
    : [
      ...bins.map((b) => path.join(b, "codex")),
      // The ChatGPT app (and the Codex app) carry the CLI inside, where their Codex runs it.
      "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex", "/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex",
      "/Applications/ChatGPT.app/Contents/Resources/codex", "/Applications/Codex.app/Contents/Resources/codex",
    ];
}

const versionOf = (out: string | null) => out?.match(/\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/)?.[0] ?? null;

/** A path a shell can take in double quotes without acting on it. */
const QUOTABLE_PATH = /^[^"%^&|<>!`$\r\n\u0000-\u001f]+$/;

async function cliVersion(agent: AgentId, command: string): Promise<AgentTools["cli"]> {
  if (plainCommand(command)) {
    const version = versionOf(await runCommand(`${command.trim()} --version`, 15_000));
    if (version) return { version };
  }
  // The default command didn't answer: look where the installers put it.
  if (command.trim() !== agent) return null;
  const versionAt = async (place: string) =>
    QUOTABLE_PATH.test(place) && fs.existsSync(place) ? versionOf(await runCommand(`"${place}" --version`, 15_000)) : null;
  for (const place of cliPlaces(agent)) {
    const version = await versionAt(place);
    if (version) return { version, path: place };
  }
  // On Windows the Codex app carries the CLI in its package, whose folder names its version: an update moves it.
  if (process.platform !== "win32" || agent !== "codex" || !g.__pacedmindCodexAppCli) return null;
  if (!fs.existsSync(g.__pacedmindCodexAppCli)) await desktopApps();
  const app = g.__pacedmindCodexAppCli;
  const version = app ? await versionAt(app) : null;
  return app && version ? { version, path: app } : null;
}

/** The command line that runs an agent's CLI here with `args`, as the check found it; null when there's none to run plainly. */
function cliLine(agent: AgentId, cli: AgentTools["cli"], args: string): string | null {
  if (!cli) return null;
  if (cli.path) return QUOTABLE_PATH.test(cli.path) ? `"${cli.path}" ${args}` : null;
  const command = agentCommandFor(agent);
  return plainCommand(command) ? `${command.trim()} ${args}` : null;
}

type Output = { code: number; stdout: string; stderr: string };

/** The keys `claude auth status --json` may say each thing under. Only these are read; the email and organization never are. */
const CLAUDE_KEYS = {
  state: ["loggedIn", "logged_in", "isLoggedIn", "authenticated"],
  method: ["authMethod", "auth_method", "method", "apiProvider"],
  plan: ["subscriptionType", "subscription_type", "subscription", "plan", "planType"],
};

/** A value under one of `keys`, at the top of the object or one level down (e.g. under "account"). */
function field(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  for (const v of Object.values(o)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    for (const k of keys) if ((v as Record<string, unknown>)[k] !== undefined) return (v as Record<string, unknown>)[k];
  }
  return undefined;
}

/** Whether Claude Code is signed in, from `claude auth status --json`. */
function claudeLogin(out: Output): AgentLogin {
  let o: unknown = null;
  try {
    o = JSON.parse(out.stdout.trim());
  } catch {
    // Not JSON: an older CLI, or an error message.
  }
  if (o && typeof o === "object" && !Array.isArray(o)) {
    const flag = field(o as Record<string, unknown>, CLAUDE_KEYS.state);
    const state = flag === true ? "in" : flag === false ? "out" : "unknown";
    if (state === "out") return { state };
    return loginOf({ state, method: field(o as Record<string, unknown>, CLAUDE_KEYS.method), plan: field(o as Record<string, unknown>, CLAUDE_KEYS.plan) });
  }
  return /not (logged|signed) in|log ?in (first|required)/i.test(`${out.stdout}\n${out.stderr}`) ? { state: "out" } : { state: "unknown" };
}

/** Whether Codex is signed in, from `codex login status` (which writes to stderr, and never shows the key in full). */
function codexLogin(out: Output): AgentLogin {
  const text = `${out.stdout}\n${out.stderr}`;
  if (/not logged in/i.test(text)) return { state: "out" };
  if (/logged in using chatgpt/i.test(text)) return { state: "in", method: "chatgpt" };
  if (/logged in using an api key/i.test(text)) return { state: "in", method: "api-key" };
  return /logged in/i.test(text) ? { state: "in" } : { state: "unknown" };
}

/** Asks an agent's CLI whether it's signed in. Its output stays here: only the state, the method and the plan travel. */
async function cliLogin(agent: AgentId, cli: AgentTools["cli"]): Promise<AgentLogin> {
  const line = cliLine(agent, cli, agent === "claude" ? "auth status --json" : "login status");
  if (!line) return { state: "unknown" };
  const out = await execLine(line, { timeout: 15_000 });
  return agent === "claude" ? claudeLogin(out) : codexLogin(out);
}

/**
 * The command that starts an agent's CLI here: the one from this computer's settings, or where this computer
 * found it. Never anything from the cloud.
 */
export function cliCommand(agent: AgentId): string {
  const command = agentCommandFor(agent);
  const found = localTools()[agent].cli?.path;
  return found && command === agent && QUOTABLE_PATH.test(found) ? `"${found}"` : command;
}

/** The agent's CLI itself, without the options Settings may add: where PacedMind found it, else its name. */
export function cliBinary(agent: AgentId): string {
  const found = localTools()[agent].cli?.path;
  return found && QUOTABLE_PATH.test(found) ? `"${found}"` : agent;
}

/**
 * Installed desktop apps by agent, with their versions when the system tells them. On Windows it also notes where the
 * Codex app keeps its CLI, for cliVersion.
 */
async function desktopApps(): Promise<Record<AgentId, AgentTools["app"]>> {
  const found: Record<AgentId, AgentTools["app"]> = { claude: null, codex: null };
  if (process.platform === "win32") {
    // Both apps install as MSIX packages; older Claude installs live in AppData\Local\AnthropicClaude.
    const out = await runFile("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "Get-AppxPackage | Where-Object { $_.Name -in @('Claude', 'OpenAI.Codex') } | ForEach-Object { \"$($_.Name)|$($_.Version)|$($_.InstallLocation)\" }",
    ], 20_000);
    let codexCli: string | null = null;
    for (const line of (out ?? "").split(/\r?\n/)) {
      const [name, version, dir] = line.trim().split("|");
      if (name === "Claude") found.claude = { version: version || null };
      if (name === "OpenAI.Codex") {
        found.codex = { version: version || null };
        if (dir && path.isAbsolute(dir)) codexCli = path.join(dir, "app", "resources", "codex.exe");
      }
    }
    if (out !== null) g.__pacedmindCodexAppCli = codexCli;
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    if (!found.claude && fs.existsSync(path.join(local, "AnthropicClaude", "claude.exe"))) found.claude = { version: null };
    return found;
  }
  if (process.platform === "darwin") {
    // The Codex app became the ChatGPT app (still com.openai.codex); the older ChatGPT app is com.openai.chat.
    const bundles: [AgentId, string, string][] = [
      ["claude", "Claude.app", "com.anthropic.claudefordesktop"], ["codex", "ChatGPT.app", "com.openai.codex"], ["codex", "Codex.app", "com.openai.codex"],
    ];
    for (const [agent, name, id] of bundles) {
      if (found[agent]) continue;
      for (const app of [path.join("/Applications", name), path.join(home, "Applications", name)]) {
        let plist: string;
        try {
          plist = fs.readFileSync(path.join(app, "Contents", "Info.plist"), "utf8");
        } catch {
          continue;
        }
        const key = (k: string) => plist.match(new RegExp(`<key>${k}</key>\\s*<string>([^<]+)</string>`))?.[1] ?? null;
        if (key("CFBundleIdentifier") === id) found[agent] = { version: key("CFBundleShortVersionString") };
      }
    }
  }
  return found;
}

/** Claude Code's user-scope entry for PacedMind's MCP server under `name`, or undefined. */
export function claudeMcpEntry(name: string): { url?: unknown; headers?: { Authorization?: unknown } } | undefined {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(claudeDir(), ".claude.json"), "utf8"));
    const entry = config?.mcpServers?.[name];
    return entry && typeof entry === "object" ? entry : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether Claude Code (and so the Claude app's Code sessions) has PacedMind's MCP server for all projects: this computer's,
 * with the owner token, as "pacedmind" or still as "organizer", its old name; or PacedMind Cloud's, which it signs in to
 * itself (OAuth), while this computer is signed in to the account too.
 */
function claudeMcp(url: string, token: string, signedIn: boolean): McpLink {
  const ours = (e: ReturnType<typeof claudeMcpEntry>) => e?.url === url && e?.headers?.Authorization === `Bearer ${token}`;
  const now = claudeMcpEntry(MCP_NAME);
  if (now?.url === cloudMcpUrl()) return signedIn ? "cloud" : "elsewhere";
  if (now) return ours(now) ? "connected" : "elsewhere";
  const old = claudeMcpEntry(OLD_MCP_NAME);
  if (old) return ours(old) ? "old" : "elsewhere";
  return "missing";
}

/** The [mcp_servers.<name>] table of Codex's config.toml with its sub-tables, or null. */
export function codexMcpTable(name: string): string | null {
  try {
    const toml = fs.readFileSync(path.join(/*turbopackIgnore: true*/ codexHome(), "config.toml"), "utf8");
    return toml.match(new RegExp(`^\\[mcp_servers\\.${name}\\][^\\n]*(?:\\n(?!\\[(?!mcp_servers\\.${name}\\.))[^\\n]*)*`, "m"))?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether Codex (and so the Codex app) has PacedMind's MCP server, so it works without PacedMind's terminal: this
 * computer's with the owner token, as "pacedmind" or still as "organizer"; or PacedMind Cloud's (OAuth).
 */
function codexMcp(url: string, token: string, signedIn: boolean): McpLink {
  const urlOf = (table: string) => table.match(/^\s*url\s*=\s*["']([^"']+)["']/m)?.[1];
  const ours = (table: string) => urlOf(table) === url && table.includes(token);
  const now = codexMcpTable(MCP_NAME);
  if (now && urlOf(now) === cloudMcpUrl()) return signedIn ? "cloud" : "elsewhere";
  if (now) return ours(now) ? "connected" : "elsewhere";
  const old = codexMcpTable(OLD_MCP_NAME);
  if (old) return ours(old) ? "old" : "elsewhere";
  return "missing";
}

/**
 * How Claude Code and Codex here reach PacedMind right now, from their config files (cheap reads), for Settings and the
 * offer after signing in: what the last check found can be from before you signed in. `url`: this server's MCP address.
 */
export function mcpLinks(url: string, signedIn: boolean): Record<AgentId, McpLink> {
  const token = deviceConfig().ownerToken;
  return { claude: claudeMcp(url, token, signedIn), codex: codexMcp(url, token, signedIn) };
}

/**
 * Looks for the agents on this computer and keeps what it found. Runs when the server starts, every half hour,
 * and when you ask for it in Settings; calls while one runs share it. Once this computer is signed in, the
 * account's list gets a copy without paths.
 */
export function checkThisDevice(url: string): Promise<Device["agents"]> {
  g.__pacedmindCheck ??= (async () => {
    const d = deviceConfig();
    // Codex's CLI after the apps: on Windows it can be the one inside the Codex app.
    const looking = desktopApps();
    const [claude, codex, apps, signedIn] = await Promise.all([
      cliVersion("claude", agentCommandFor("claude")), looking.then(() => cliVersion("codex", agentCommandFor("codex"))), looking,
      usesCloud().catch(() => false),
    ]);
    const [claudeIn, codexIn] = await Promise.all([cliLogin("claude", claude), cliLogin("codex", codex)]);
    const [claudeModels, codexModels] = await Promise.all([
      readAgentCatalog("claude", claudeIn.state === "in" ? cliLine("claude", claude, "") : null),
      readAgentCatalog("codex", codexIn.state === "in" ? cliLine("codex", codex, "") : null),
    ]);
    const agents: Device["agents"] = {
      claude: { cli: claude, app: apps.claude, mcp: claudeMcp(url, d.ownerToken, signedIn), login: claudeIn, models: claudeModels, extras: withAccount("claude", agentExtras("claude")) },
      codex: { cli: codex, app: apps.codex, mcp: codexMcp(url, d.ownerToken, signedIn), login: codexIn, models: codexModels, extras: withAccount("codex", agentExtras("codex")) },
    };
    g.__pacedmindTools = agents;
    g.__pacedmindToolsAt = new Date().toISOString();
    g.__pacedmindToolsSaved = undefined;
    await saveToolsOnce().catch(() => {});
    return agents;
  })().finally(() => {
    g.__pacedmindCheck = null;
  });
  return g.__pacedmindCheck;
}

/** Fresh account capabilities when a picker opens and before every explicit model launch. No disk cache. */
export function refreshAgentModels(agent: AgentId): Promise<ModelCatalog> {
  const checks = g.__pacedmindModelChecks ??= {};
  return checks[agent] ??= (async () => {
    const cli = await cliVersion(agent, agentCommandFor(agent));
    const login = await cliLogin(agent, cli);
    const models = await readAgentCatalog(agent, login.state === "in" ? cliLine(agent, cli, "") : null);
    const before = localTools();
    g.__pacedmindTools = { ...before, [agent]: { ...before[agent], cli, login, models } };
    g.__pacedmindToolsSaved = undefined;
    await saveToolsOnce().catch(() => {});
    return models;
  })().finally(() => { delete checks[agent]; });
}

/** An agent's extras with what its sessions here last got from the account its CLI is signed in to (noteAccountServers). */
function withAccount(agent: AgentId, extras: AgentExtras): AgentExtras {
  const seen = deviceConfig().fromAccount?.[agent];
  return seen ? { ...extras, account: seen.names, accountAt: seen.at } : extras;
}

/**
 * A session PacedMind started here, with all the MCP servers its agent has (no project's pick), said which ones come
 * from the account its CLI is signed in to (Claude Code's claude.ai connectors, sortReported). No file names those, and
 * the CLI on another computer can be signed in to another account with others, so this computer keeps what its own
 * sessions got and tells the account's list of computers when it changed.
 */
export async function noteAccountServers(agent: AgentId, names: string[]) {
  const d = deviceConfig();
  const before = d.fromAccount?.[agent];
  const at = new Date().toISOString();
  updateDevice({ fromAccount: { ...(d.fromAccount ?? {}), [agent]: { names, at } } });
  const tools = g.__pacedmindTools;
  if (!tools?.[agent].extras) return;
  g.__pacedmindTools = { ...tools, [agent]: { ...tools[agent], extras: withAccount(agent, tools[agent].extras!) } };
  if (before && before.names.join("\n") === names.join("\n")) return;
  g.__pacedmindToolsSaved = undefined;
  await saveToolsOnce().catch(() => {});
}

/** Saves what this computer found to its entry in the account, once per check and computer (after signing in, too). */
export async function saveToolsOnce() {
  const id = thisDeviceId();
  if (!id || !g.__pacedmindTools || g.__pacedmindToolsSaved === id) return;
  await repo.saveDeviceTools(id, g.__pacedmindTools);
  g.__pacedmindToolsSaved = id;
}
