import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as repo from "./repo";
import { agentCommandFor, deviceConfig, thisPlatform } from "./device";
import { plainCommand, runCommand, runFile } from "./shell";
import { NO_AGENT_TOOLS, type AgentId, type AgentTools, type Device, type McpLink } from "@/lib/types";

/*
 * This computer and the others signed in to the account. Each desktop app registers itself in the account's
 * devices (requests.ts) and looks for the agents here: the Claude Code and Codex command-line tools, their
 * desktop apps, and whether those apps can reach PacedMind's MCP server. What it finds stays in memory for
 * starting sessions here, and a copy without paths goes to the cloud, so Settings on every computer shows it.
 * Sessions run on a computer in a terminal or an agent's desktop app.
 */

const g = globalThis as unknown as {
  __pacedmindTools?: Device["agents"];
  __pacedmindToolsAt?: string;
  __pacedmindCheck?: Promise<Device["agents"]> | null;
  /** The computer id the latest tools were saved for. */
  __pacedmindToolsSaved?: string;
};

/** This computer's id in the account's list, once registered (null before that, and in the web app). */
export const thisDeviceId = (): string | null => deviceConfig().deviceId;

/** What this computer found of the agents; nothing until the first check finished. */
export const localTools = (): Device["agents"] => g.__pacedmindTools ?? { claude: NO_AGENT_TOOLS, codex: NO_AGENT_TOOLS };

/** When this computer last looked for the agents; null until the first check finished. */
export const toolsCheckedAt = (): string | null => g.__pacedmindToolsAt ?? null;

/** This computer as the app shows it: its entry in the account's list, with what it found of the agents itself. */
export async function thisDevice(): Promise<Device> {
  const d = deviceConfig();
  const row = d.deviceId ? await repo.getDevice(d.deviceId).catch(() => null) : null;
  return {
    id: d.deviceId ?? "", name: row?.name ?? d.name, platform: row?.platform ?? thisPlatform(), remoteStart: row?.remoteStart ?? d.remoteStart,
    agents: localTools(), createdAt: row?.createdAt ?? "", lastSeenAt: row?.lastSeenAt ?? null,
    checkedAt: g.__pacedmindToolsAt ?? row?.checkedAt ?? null, revokedAt: row?.revokedAt ?? null,
  };
}

/** The computer a task's sessions run on: its own, else its project's. Null means the computer that starts them. */
export const deviceIdFor = (taskDeviceId: string | null, projectDeviceId: string | null | undefined): string | null =>
  taskDeviceId ?? projectDeviceId ?? null;

/** Whether sessions for that computer may start here. */
export const runsHere = (deviceId: string | null) => !deviceId || deviceId === thisDeviceId();

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
    : [...bins.map((b) => path.join(b, "codex")), "/Applications/ChatGPT.app/Contents/Resources/codex", "/Applications/Codex.app/Contents/Resources/codex"];
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
  for (const place of cliPlaces(agent).filter((p) => QUOTABLE_PATH.test(p) && fs.existsSync(p))) {
    const version = versionOf(await runCommand(`"${place}" --version`, 15_000));
    if (version) return { version, path: place };
  }
  return null;
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

/** Installed desktop apps by agent, with their versions when the system tells them. */
async function desktopApps(): Promise<Record<AgentId, AgentTools["app"]>> {
  const found: Record<AgentId, AgentTools["app"]> = { claude: null, codex: null };
  if (process.platform === "win32") {
    // Both apps install as MSIX packages; older Claude installs live in AppData\Local\AnthropicClaude.
    const out = await runFile("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "Get-AppxPackage | Where-Object { $_.Name -in @('Claude', 'OpenAI.Codex') } | ForEach-Object { \"$($_.Name)=$($_.Version)\" }",
    ], 20_000);
    for (const line of (out ?? "").split(/\r?\n/)) {
      const [name, version] = line.trim().split("=");
      if (name === "Claude") found.claude = { version: version || null };
      if (name === "OpenAI.Codex") found.codex = { version: version || null };
    }
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

/** Whether Claude Code (and so the Claude app's Code sessions) has PacedMind's MCP server for all projects, with the owner token. */
function claudeMcp(url: string, token: string): McpLink {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(claudeDir(), ".claude.json"), "utf8"));
    const entry = config?.mcpServers?.organizer;
    if (!entry) return "missing";
    return entry.url === url && entry.headers?.Authorization === `Bearer ${token}` ? "connected" : "elsewhere";
  } catch {
    return "missing";
  }
}

/** The [mcp_servers.organizer] table of Codex's config.toml with its sub-tables, or null. */
export function codexOrganizerTable(): string | null {
  try {
    const toml = fs.readFileSync(path.join(/*turbopackIgnore: true*/ codexHome(), "config.toml"), "utf8");
    return toml.match(/^\[mcp_servers\.organizer\][^\n]*(?:\n(?!\[(?!mcp_servers\.organizer\.))[^\n]*)*/m)?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Whether Codex (and so the Codex app) has PacedMind's MCP server with the owner token, so it works without PacedMind's terminal. */
function codexMcp(url: string, token: string): McpLink {
  const table = codexOrganizerTable();
  if (!table) return "missing";
  const at = table.match(/^\s*url\s*=\s*["']([^"']+)["']/m)?.[1];
  return at === url && table.includes(token) ? "connected" : "elsewhere";
}

/**
 * Looks for the agents on this computer and keeps what it found. Runs when the server starts, every half hour,
 * and when you ask for it in Settings; calls while one runs share it. Once this computer is signed in, the
 * account's list gets a copy without paths.
 */
export function checkThisDevice(url: string): Promise<Device["agents"]> {
  g.__pacedmindCheck ??= (async () => {
    const d = deviceConfig();
    const [claude, codex, apps] = await Promise.all([
      cliVersion("claude", agentCommandFor("claude")), cliVersion("codex", agentCommandFor("codex")), desktopApps(),
    ]);
    const agents: Device["agents"] = {
      claude: { cli: claude, app: apps.claude, mcp: claudeMcp(url, d.ownerToken) },
      codex: { cli: codex, app: apps.codex, mcp: codexMcp(url, d.ownerToken) },
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

/** Saves what this computer found to its entry in the account, once per check and computer (after signing in, too). */
export async function saveToolsOnce() {
  const id = thisDeviceId();
  if (!id || !g.__pacedmindTools || g.__pacedmindToolsSaved === id) return;
  await repo.saveDeviceTools(id, g.__pacedmindTools);
  g.__pacedmindToolsSaved = id;
}
