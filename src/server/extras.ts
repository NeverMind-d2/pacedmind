import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeConfig, claudeFolderEntry } from "./claude-trust";
import type { AgentExtras, AgentId, FolderExtras } from "@/lib/types";

/*
 * What Claude Code and Codex give their sessions besides PacedMind, read from their own config files on this computer:
 * the MCP servers, plugins, skills and hooks they have everywhere (agentExtras, part of what this computer found of
 * the agents in devices.ts) and what a project's folder adds (folderExtras, Settings). It never runs them: `claude
 * mcp list` starts every server it checks, and a folder's servers run code from that folder. Only names leave here,
 * since a server's command, address, headers and environment can hold keys; a name that doesn't look like one is left
 * out. PacedMind's own server (organizer) isn't listed: every session has it.
 *
 * Also where the launcher gets the definitions of the servers a project lets its sessions have (serversFor), read
 * from the same files when a session starts.
 */

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const home = os.homedir();
/** Claude Code's settings and skills (~/.claude); its config file (~/.claude.json) is claude-trust.ts's. */
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
const codexHome = () => process.env.CODEX_HOME || path.join(home, ".codex");

/** A name as the config files have it, and as the cloud keeps it: plain characters, and short. */
const NAME = /^[\w.@:+-]{1,48}$/;
export const isServerName = (name: string) => NAME.test(name) && name !== "organizer";

const names = (xs: Iterable<string>, max = 12) => [...new Set([...xs].filter(isServerName))].sort().slice(0, max);

function readJson(file: string): Json | null {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8"));
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8");
  } catch {
    return null;
  }
}

const keysOf = (v: unknown) => (isObject(v) ? Object.keys(v) : []);

/** How many skills a folder holds: its subfolders with a SKILL.md. */
function skillCount(dir: string): number {
  try {
    return fs.readdirSync(/*turbopackIgnore: true*/ dir).filter((n) => fs.existsSync(path.join(dir, n, "SKILL.md"))).length;
  } catch {
    return 0;
  }
}

/** The events a Claude Code settings file has hooks for. */
const hookEvents = (settings: Json | null) =>
  keysOf(settings?.hooks).filter((k) => Array.isArray((settings!.hooks as Json)[k]) && ((settings!.hooks as Json)[k] as unknown[]).length > 0);

/** The plugins a Claude Code settings file turns on ("name@marketplace": true), by name. */
const enabledPlugins = (settings: Json | null) =>
  Object.entries(isObject(settings?.enabledPlugins) ? settings.enabledPlugins : {}).filter(([, on]) => on === true).map(([id]) => id.split("@")[0]);

/** The [mcp_servers.<name>] tables of a Codex config.toml that aren't switched off. */
function tomlServers(toml: string | null): string[] {
  if (!toml) return [];
  const out: string[] = [];
  const header = /^\s*\[mcp_servers\.(?:"([^"\r\n]+)"|([A-Za-z0-9_-]+))\]\s*$/gm;
  for (let m = header.exec(toml); m; m = header.exec(toml)) {
    const body = toml.slice(header.lastIndex).split(/^\s*\[/m)[0];
    if (!/^\s*enabled\s*=\s*false\b/m.test(body)) out.push(m[1] ?? m[2]);
  }
  return out;
}

/** The events Codex has hooks for, in a config.toml ([[hooks.Stop]]) or a hooks.json. */
function codexHooks(toml: string | null, json: Json | null): string[] {
  const out = [...(toml ?? "").matchAll(/^\s*\[\[hooks\.([A-Za-z]+)\]\]/gm)].map((m) => m[1]);
  const table = isObject(json?.hooks) ? json.hooks : json;
  return [...out, ...keysOf(table).filter((k) => /^[A-Z][A-Za-z]+$/.test(k))];
}

/** What an agent's sessions get everywhere on this computer besides PacedMind. */
export function agentExtras(agent: AgentId): AgentExtras {
  if (agent === "claude") {
    const settings = readJson(path.join(claudeHome(), "settings.json"));
    return {
      mcp: names(keysOf(claudeConfig()?.mcpServers)),
      plugins: names(enabledPlugins(settings)),
      skills: skillCount(path.join(claudeHome(), "skills")),
      hooks: names(hookEvents(settings)),
    };
  }
  const toml = readText(path.join(codexHome(), "config.toml"));
  return {
    mcp: names(tomlServers(toml)),
    plugins: [],
    skills: skillCount(path.join(codexHome(), "skills")),
    hooks: names(codexHooks(toml, readJson(path.join(codexHome(), "hooks.json")))),
  };
}

/** What the agents get in `folder` on top of what they have everywhere. */
export function folderExtras(folder: string): FolderExtras {
  const config = claudeConfig();
  const entry = claudeFolderEntry(config, folder);
  const shared = readJson(path.join(folder, ".claude", "settings.json"));
  const local = readJson(path.join(folder, ".claude", "settings.local.json"));
  const user = readJson(path.join(claudeHome(), "settings.json"));
  const approval = projectServerApproval(entry, [local, shared, user]);
  const codexToml = readText(path.join(folder, ".codex", "config.toml"));
  return {
    claudeMcp: names(keysOf(readJson(path.join(folder, ".mcp.json"))?.mcpServers), 20).map((name) => ({ name, approved: approval(name) })),
    claudeLocal: names(keysOf(entry?.mcpServers)),
    codexMcp: names(tomlServers(codexToml)),
    skills: skillCount(path.join(folder, ".claude", "skills")),
    hooks: names([...hookEvents(shared), ...hookEvents(local), ...codexHooks(codexToml, readJson(path.join(folder, ".codex", "hooks.json")))]),
    plugins: names([...enabledPlugins(shared), ...enabledPlugins(local)]),
    instructions: [
      fs.existsSync(path.join(folder, "CLAUDE.md")) || fs.existsSync(path.join(folder, ".claude", "CLAUDE.md")) ? "CLAUDE.md" : null,
      fs.existsSync(path.join(folder, "AGENTS.md")) ? "AGENTS.md" : null,
    ].filter((f): f is string => !!f),
  };
}

/**
 * Whether Claude Code may use a server from a folder's .mcp.json there: true once you allowed it (or all of the
 * folder's), false when you refused it, null while it would still ask. Claude Code keeps the answers in its own
 * entry for the folder, and settings files can give them too.
 */
function projectServerApproval(entry: Json | null, settings: (Json | null)[]): (name: string) => boolean | null {
  const sources = [entry, ...settings];
  const list = (key: string) => new Set(sources.flatMap((s) => (Array.isArray(s?.[key]) ? (s[key] as unknown[]).filter((x) => typeof x === "string") : [])));
  const on = list("enabledMcpjsonServers");
  const off = list("disabledMcpjsonServers");
  const all = sources.some((s) => s?.enableAllProjectMcpServers === true);
  return (name) => (off.has(name) ? false : on.has(name) || all ? true : null);
}

/** The MCP servers a session in `folder` could have besides PacedMind, by agent: what a project's list picks from. */
export function serverChoices(folder: string | null): Record<AgentId, string[]> {
  const f = folder ? folderExtras(folder) : null;
  return {
    claude: names([
      ...agentExtras("claude").mcp, ...(f?.claudeLocal ?? []), ...(f?.claudeMcp.filter((s) => s.approved).map((s) => s.name) ?? []),
    ], 40),
    codex: names([...agentExtras("codex").mcp, ...(f?.codexMcp ?? [])], 40),
  };
}

/**
 * The definitions of the Claude Code MCP servers `wanted` from what Claude Code has for `folder`: yours (everywhere),
 * the folder's own in its config (local scope), and the folder's .mcp.json ones you allowed there. For a session
 * that only gets those (the launcher's --strict-mcp-config); a name it doesn't find is left out.
 */
export function claudeServers(folder: string, wanted: string[]): Json {
  const config = claudeConfig();
  const entry = claudeFolderEntry(config, folder);
  const approval = projectServerApproval(entry, [
    readJson(path.join(folder, ".claude", "settings.local.json")), readJson(path.join(folder, ".claude", "settings.json")),
    readJson(path.join(claudeHome(), "settings.json")),
  ]);
  const project = readJson(path.join(folder, ".mcp.json"))?.mcpServers;
  const out: Json = {};
  for (const name of wanted) {
    if (!isServerName(name)) continue;
    const local = isObject(entry?.mcpServers) ? entry.mcpServers[name] : undefined;
    const mine = isObject(config?.mcpServers) ? config.mcpServers[name] : undefined;
    const theirs = isObject(project) && approval(name) === true ? project[name] : undefined;
    // Claude Code's own order: the folder's (local) first, then the project's, then yours.
    const def = [local, theirs, mine].find(isObject);
    if (def) out[name] = def;
  }
  return out;
}

/** The Codex MCP servers in `folder`'s reach that a session shouldn't get: every one but `wanted` (and PacedMind's). */
export function codexServersOff(folder: string, wanted: string[]): string[] {
  const keep = new Set(wanted);
  const all = [...tomlServers(readText(path.join(codexHome(), "config.toml"))), ...tomlServers(readText(path.join(folder, ".codex", "config.toml")))];
  return [...new Set(all)].filter((n) => /^[A-Za-z0-9_-]{1,48}$/.test(n) && n !== "organizer" && !keep.has(n));
}
