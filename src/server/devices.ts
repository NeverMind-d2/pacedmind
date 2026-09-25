import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dbPath } from "./db";
import * as repo from "./repo";
import { plainCommand, runCommand, runFile } from "./shell";
import { nowStamp } from "@/lib/dates";
import type { AgentId, AgentTools, Device, McpLink } from "@/lib/types";

/*
 * The devices PacedMind runs on. Each installation keeps its id next to its database and registers itself in the
 * devices table with what it found: the Claude Code and Codex command-line tools, their desktop apps, and whether
 * those apps can reach PacedMind's MCP server. Sessions run on a device in a terminal or a desktop app.
 */

const idFile = () => path.join(path.dirname(dbPath()), "device.json");
const g = globalThis as unknown as { __organizerDeviceId?: string; __organizerDeviceCheck?: Promise<Device> | null };

/** This installation's device id. It lives next to the database, so renaming the computer keeps it. */
export function thisDeviceId(): string {
  if (g.__organizerDeviceId) return g.__organizerDeviceId;
  let id: string | null = null;
  try {
    id = String(JSON.parse(fs.readFileSync(idFile(), "utf8")).id ?? "");
  } catch {
    // Not created yet.
  }
  if (!id || !/^[a-z0-9-]{8,64}$/.test(id)) {
    id = `device-${crypto.randomBytes(6).toString("hex")}`;
    fs.mkdirSync(path.dirname(idFile()), { recursive: true });
    fs.writeFileSync(idFile(), JSON.stringify({ id }, null, 2));
  }
  g.__organizerDeviceId = id;
  return id;
}

/** This computer as PacedMind knows it. The first call registers it; the agents are found by checkThisDevice(). */
export function thisDevice(): Device {
  const id = thisDeviceId();
  const known = repo.getDevice(id);
  if (known) return known;
  repo.saveDevice({ id, name: os.hostname(), platform: process.platform });
  return repo.getDevice(id)!;
}

/** The device a task's sessions run on: its own, else its project's, else this one. Unknown ids fall back to this one. */
export function deviceFor(taskDeviceId: string | null, projectDeviceId: string | null | undefined): Device {
  const id = taskDeviceId ?? projectDeviceId ?? null;
  return (id && repo.getDevice(id)) || thisDevice();
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
    : [...bins.map((b) => path.join(b, "codex")), "/Applications/ChatGPT.app/Contents/Resources/codex", "/Applications/Codex.app/Contents/Resources/codex"];
}

const versionOf = (out: string | null) => out?.match(/\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/)?.[0] ?? null;

async function cliVersion(agent: AgentId, command: string): Promise<AgentTools["cli"]> {
  if (plainCommand(command)) {
    const version = versionOf(await runCommand(`${command.trim()} --version`, 15_000));
    if (version) return { version };
  }
  // The default command didn't answer: look where the installers put it.
  if (command.trim() !== agent) return null;
  for (const place of cliPlaces(agent).filter((p) => fs.existsSync(p))) {
    const version = versionOf(await runCommand(`"${place}" --version`, 15_000));
    if (version) return { version, path: place };
  }
  return null;
}

/** The command that runs an agent's CLI on this device: the one from Settings, or where PacedMind found it. */
export function cliCommand(agent: AgentId, device: Device): string {
  const s = repo.getSettings();
  const command = agent === "claude" ? s.claudeCommand : s.codexCommand;
  const found = device.agents[agent].cli?.path;
  return found && command.trim() === agent ? `"${found}"` : command;
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

/** Whether Claude Code (and so the Claude app's Code sessions) has PacedMind's MCP server for all projects. */
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
function codexOrganizerTable(): string | null {
  try {
    const toml = fs.readFileSync(path.join(codexHome(), "config.toml"), "utf8");
    return toml.match(/^\[mcp_servers\.organizer\][^\n]*(?:\n(?!\[(?!mcp_servers\.organizer\.))[^\n]*)*/m)?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Whether Codex (and so the Codex app) has PacedMind's MCP server with a token it can use without PacedMind's terminal. */
function codexMcp(url: string, token: string): McpLink {
  const table = codexOrganizerTable();
  if (!table) return "missing";
  const at = table.match(/^\s*url\s*=\s*["']([^"']+)["']/m)?.[1];
  return at === url && table.includes(token) ? "connected" : "elsewhere";
}

/**
 * Looks for the agents on this computer and saves what it found. Runs when the server starts, every half hour,
 * and when you ask for it in Settings; calls while one runs share it.
 */
export function checkThisDevice(url: string): Promise<Device> {
  g.__organizerDeviceCheck ??= (async () => {
    const s = repo.getSettings();
    const [claude, codex, apps] = await Promise.all([cliVersion("claude", s.claudeCommand), cliVersion("codex", s.codexCommand), desktopApps()]);
    const agents: Device["agents"] = {
      claude: { cli: claude, app: apps.claude, mcp: claudeMcp(url, s.mcpToken) },
      codex: { cli: codex, app: apps.codex, mcp: codexMcp(url, s.mcpToken) },
    };
    const id = thisDeviceId();
    repo.saveDevice({ id, name: os.hostname(), platform: process.platform, agents, checkedAt: nowStamp() });
    return repo.getDevice(id)!;
  })().finally(() => {
    g.__organizerDeviceCheck = null;
  });
  return g.__organizerDeviceCheck;
}

/* ---------- connecting the agents' own sessions to PacedMind ---------- */

/**
 * Adds PacedMind's MCP server to Claude Code for all projects (user scope), where the Claude app's Code sessions
 * find it too. Same as `npm run connect`, for this server. Returns why it failed, or null.
 */
export async function connectClaude(url: string, token: string): Promise<string | null> {
  if (!/^[\w-]+$/.test(token)) return "PacedMind's MCP token has characters the command line can't take. Regenerate it first.";
  const claude = cliCommand("claude", thisDevice());
  // Start from a clean entry, so the address and token are current. It's fine when there was none.
  await runCommand(`${claude} mcp remove organizer --scope user`, 30_000);
  const out = await runCommand(`${claude} mcp add --transport http --scope user organizer ${url} --header "Authorization: Bearer ${token}"`, 30_000);
  return out === null ? "Claude Code didn't take the server. Check that `claude` runs in a terminal, then try again." : null;
}

/**
 * Adds PacedMind's MCP server to Codex's config.toml, which the Codex CLI and app share, with the token in a header:
 * the app has no ORGANIZER_TOKEN to read it from. The old file is kept as config.toml.pacedmind-backup. Returns why
 * it failed, or null.
 */
export function connectCodex(url: string, token: string): string | null {
  const file = path.join(codexHome(), "config.toml");
  try {
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const eol = before.includes("\r\n") ? "\r\n" : "\n";
    // The old [mcp_servers.organizer] table and its sub-tables, up to the next table.
    const rest = before.replace(/^\[mcp_servers\.organizer(?:\.[^\]\r\n]*)?\][^\n]*(?:\n(?!\[)[^\n]*)*\n?/gm, "").trimEnd();
    const table = ["[mcp_servers.organizer]", `url = "${url}"`, `http_headers = { Authorization = "Bearer ${token}" }`].join(eol);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (before) fs.writeFileSync(`${file}.pacedmind-backup`, before);
    fs.writeFileSync(file, `${rest ? rest + eol + eol : ""}${table}${eol}`);
    return null;
  } catch (e) {
    return `Couldn't write ${file}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
