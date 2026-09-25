"use client";

import { useState, type ReactNode } from "react";
import { format } from "date-fns";
import {
  checkDeviceAction, connectAgentAction, createProjectAction, resetDataAction, updateProjectAction, updateSettingsAction,
} from "@/app/actions";
import { projectColor } from "@/lib/colors";
import { parseLocal } from "@/lib/dates";
import { TERMINALS, terminalFor } from "@/lib/terminals";
import { AGENT_LABEL, APP_LABEL, platformName, type AgentId, type Area, type Device, type Project, type Settings } from "@/lib/types";
import { AgentIcon, Icon } from "../icons";
import { ImportProjects } from "../import-projects";
import { ThemeSelector } from "../theme";
import { Button, Dot, Menu, Segmented, Switch, cx, toast, useAction } from "../ui";

/** The MCP server's tools by purpose (src/server/mcp). */
const TOOL_GROUPS: [string, string[]][] = [
  ["Overview", ["get_overview", "get_settings", "update_settings"]],
  ["Areas", ["list_areas", "create_area", "update_area", "delete_area"]],
  ["Projects", ["list_projects", "get_project", "create_project", "update_project", "delete_project", "reorder_tasks"]],
  ["Tasks", ["list_tasks", "get_task", "create_task", "create_tasks", "update_task", "bulk_update_tasks", "delete_task"]],
  ["Calendar", ["list_events", "create_event", "update_event", "delete_event", "get_agenda", "reschedule_day"]],
  ["Flows", ["get_flow", "connect_tasks", "disconnect_tasks", "add_to_flow", "remove_from_flow"]],
  ["Sessions", ["list_sessions", "start_session", "close_session", "request_changes", "get_next_task", "start_task", "attach_image", "finish_task"]],
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Section({ id, title, action, children, note }: { id?: string; title: string; action?: ReactNode; children: ReactNode; note?: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-2.5">
      <div className="flex min-h-6 items-center gap-2">
        <h2 className="flex-1 text-[13px] font-semibold text-fg2">{title}</h2>
        {action}
      </div>
      <div className="overflow-hidden rounded-lg border border-line2">{children}</div>
      {note && <p className="text-[12px] leading-relaxed text-mut2">{note}</p>}
    </section>
  );
}

const MCP_TEXT = { connected: "Reports to PacedMind", elsewhere: "Reports to another PacedMind", missing: "Not connected" } as const;

/** One agent on a device: its CLI, its desktop app, and whether sessions PacedMind didn't start can report back. */
function AgentTools({ agent, device, here, pending, onConnect }: {
  agent: AgentId; device: Device; here: boolean; pending: boolean; onConnect: (agent: AgentId) => void;
}) {
  const t = device.agents[agent];
  const part = (on: boolean, text: string) => <span className={on ? "text-fg3" : "text-dim"}>{text}</span>;
  return (
    <div className="flex min-h-9 items-center gap-2.5 text-[12.5px]">
      <AgentIcon agent={agent} size={14} className="text-fg3" />
      <span className="w-[92px] shrink-0 text-fg2">{AGENT_LABEL[agent]}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
        {part(!!t.cli, t.cli ? `CLI ${t.cli.version}` : "No CLI")}
        <span className="text-faint">·</span>
        {part(!!t.app, t.app ? `${APP_LABEL[agent]}${t.app.version ? ` ${t.app.version}` : ""}` : `No ${APP_LABEL[agent].toLowerCase()}`)}
        <span className="text-faint">·</span>
        {part(t.mcp === "connected", MCP_TEXT[t.mcp])}
      </span>
      {here && t.mcp !== "connected" && (t.cli || t.app || agent === "codex") && (
        <Button size="sm" disabled={pending} onClick={() => onConnect(agent)}
          title={agent === "claude"
            ? "Adds PacedMind's MCP server to Claude Code for all projects, so the Claude app's sessions can report back"
            : "Adds PacedMind's MCP server to ~/.codex/config.toml (kept as config.toml.pacedmind-backup), so the Codex app's sessions can report back"}>
          Connect
        </Button>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-b border-line px-3.5 last:border-b-0">
      <span className="w-[120px] shrink-0 text-[12.5px] text-mut2">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

const input = "h-7 min-w-0 flex-1 rounded-md border border-line2 bg-input px-2 text-[12.5px] text-fg2 outline-none focus:border-line-strong";

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(() => toast(`${what} copied`), () => toast("Couldn't copy", "error"));
}

export function SettingsView({ settings, projects, areas, devices, thisDeviceId, mcpUrl, dbFile, sessionsCount, platform }: {
  settings: Settings; projects: Project[]; areas: Area[]; devices: Device[]; thisDeviceId: string; mcpUrl: string; dbFile: string;
  sessionsCount: number;
  /** The server's system, which decides the terminals sessions can open in. */
  platform: NodeJS.Platform;
}) {
  const { run, pending } = useAction();
  const [showToken, setShowToken] = useState(false);
  const [importing, setImporting] = useState(false);
  const [newProject, setNewProject] = useState({ name: "", areaId: "dev", folder: "", agent: "claude" as AgentId | null });
  const save = (patch: Partial<Settings>) => run(() => updateSettingsAction(patch), "Saved");
  const token = settings.mcpToken;
  const claudeCmd = `claude mcp add --transport http --scope user organizer ${mcpUrl} --header "Authorization: Bearer ${token}"`;
  // A header rather than bearer_token_env_var: the Codex app has no ORGANIZER_TOKEN to read.
  const codexToml = `# ~/.codex/config.toml\n[mcp_servers.organizer]\nurl = "${mcpUrl}"\nhttp_headers = { Authorization = "Bearer ${token}" }`;
  const connect = (agent: AgentId) => {
    const what = agent === "claude" ? "Claude Code, for all projects" : "Codex's config.toml";
    if (confirm(`Add PacedMind (${mcpUrl}) to ${what}? Sessions you start yourself, and those in the ${APP_LABEL[agent]}, will report to this PacedMind.`)) {
      run(() => connectAgentAction(agent));
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line pl-5 pr-4">
        <Icon name="settings" className="text-mut" />
        <h1 className="text-[14px] font-semibold text-strong">Settings</h1>
        <span className="text-mut2">Appearance, sessions, MCP and planning</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1180px] grid-cols-2 gap-10 px-10 py-8">
          <div className="flex flex-col gap-7">
            <Section title="Appearance">
              <Row label="Theme"><ThemeSelector /></Row>
            </Section>

            <Section id="devices" title="Devices"
              action={<Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => checkDeviceAction())}><Icon name="refresh" size={12} />Check again</Button>}
              note="Sessions run in a terminal or an agent's desktop app on a computer with PacedMind, or in the agent's cloud. PacedMind looks for Claude Code and Codex when it starts and every half hour. Connected, the desktop apps report back like terminal sessions.">
              {devices.map((d) => {
                const here = d.id === thisDeviceId;
                return (
                  <div key={d.id} className="flex flex-col gap-1 border-b border-line px-3.5 py-2.5 last:border-b-0">
                    <div className="flex h-7 items-center gap-2.5">
                      <Icon name="laptop" size={14} className="text-mut" />
                      <span className="truncate text-[13px] font-medium text-fg">{d.name}</span>
                      <span className="truncate text-[12px] text-mut2">
                        {platformName(d.platform)}{here ? " · this computer" : ` · seen ${format(parseLocal(d.seenAt), "d MMM HH:mm")}`}
                      </span>
                    </div>
                    {d.checkedAt
                      ? (["claude", "codex"] as AgentId[]).map((a) => <AgentTools key={a} agent={a} device={d} here={here} pending={pending} onConnect={connect} />)
                      : <p className="pb-1 text-[12px] text-mut2">Looking for Claude Code and Codex…</p>}
                  </div>
                );
              })}
            </Section>
            <Section title="MCP server" note="Claude Code and Codex use this to read your tasks and to tell PacedMind when a session picks up a task and when it's finished.">
              <Row label="Status">
                <span className="flex items-center gap-2 text-[12.5px] text-fg3"><span className="h-1.5 w-1.5 rounded-full bg-fg3" />Running with this app</span>
              </Row>
              <Row label="Address">
                <span className="flex-1 truncate font-mono text-[12px] text-fg2">{mcpUrl}</span>
                <Button size="sm" onClick={() => copy(mcpUrl, "Address")}>Copy</Button>
              </Row>
              <Row label="Access token">
                <span className="flex-1 truncate font-mono text-[12px] text-fg2">{showToken ? token : `${token.slice(0, 4)}${"•".repeat(16)}${token.slice(-4)}`}</span>
                <Button size="sm" onClick={() => setShowToken((s) => !s)}>{showToken ? "Hide" : "Show"}</Button>
                <Button size="sm" onClick={() => copy(token, "Token")}>Copy</Button>
                <Button size="sm" onClick={() => {
                  if (!confirm("Make a new token? Agents set up with the old one lose access until you update them.")) return;
                  const bytes = crypto.getRandomValues(new Uint8Array(18));
                  save({ mcpToken: `org_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}` });
                }}>Regenerate</Button>
              </Row>
            </Section>

            <Section title="Connect your agents" note="Sessions you start from PacedMind are connected automatically. Set this up once to use PacedMind from sessions you start yourself.">
              <div className="flex flex-col gap-2.5 border-b border-line p-3.5">
                <div className="flex items-center gap-2.5">
                  <AgentIcon agent="claude" size={14} className="text-fg3" />
                  <span className="flex-1 text-[13px] font-medium text-fg">Claude Code</span>
                  <Button size="sm" onClick={() => copy(claudeCmd, "Command")}>Copy command</Button>
                </div>
                <pre className="whitespace-pre-wrap break-all rounded-md border border-line bg-input px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-fg3">{claudeCmd}</pre>
              </div>
              <div className="flex flex-col gap-2.5 p-3.5">
                <div className="flex items-center gap-2.5">
                  <AgentIcon agent="codex" size={14} className="text-fg3" />
                  <span className="flex-1 text-[13px] font-medium text-fg">Codex</span>
                  <Button size="sm" onClick={() => copy(codexToml, "Config")}>Copy config</Button>
                </div>
                <pre className="whitespace-pre-wrap break-all rounded-md border border-line bg-input px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-fg3">{codexToml}</pre>
                <p className="text-[12px] text-mut2">The Codex CLI and the Codex app share this file. Sessions started from PacedMind don&apos;t need it.</p>
              </div>
            </Section>

            <Section title="Starting sessions">
              {TERMINALS[platform] && (
                <Row label="Terminal">
                  <Segmented value={terminalFor(settings.terminal, platform).value} onChange={(v) => save({ terminal: v })}
                    options={TERMINALS[platform]} />
                </Row>
              )}
              <Row label="Claude command">
                <input className={input} defaultValue={settings.claudeCommand} aria-label="Claude command"
                  onBlur={(e) => e.target.value.trim() && e.target.value !== settings.claudeCommand && save({ claudeCommand: e.target.value.trim() })} />
              </Row>
              <Row label="Codex command">
                <input className={input} defaultValue={settings.codexCommand} aria-label="Codex command"
                  onBlur={(e) => e.target.value.trim() && e.target.value !== settings.codexCommand && save({ codexCommand: e.target.value.trim() })} />
              </Row>
            </Section>

            <Section title="Tools agents can use"
              note={<>Sessions started from PacedMind may read, add and update tasks without asking; anything else asks in their terminal first. Run <span className="font-mono">npm run skills</span> to install the PacedMind skills for Claude Code and Codex.</>}>
              {TOOL_GROUPS.map(([group, names]) => (
                <div key={group} className="flex items-start gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0">
                  <span className="w-[72px] shrink-0 text-[12.5px] text-mut2">{group}</span>
                  <span className="min-w-0 flex-1 font-mono text-[11.5px] leading-relaxed text-fg3">{names.join(", ")}</span>
                </div>
              ))}
            </Section>
          </div>

          <div className="flex flex-col gap-7">
            <Section title="Projects and folders"
              action={<Button size="sm" variant="ghost" onClick={() => setImporting(true)}><Icon name="download" size={12} />Import from Claude and Codex</Button>}
              note="A session works in its task's own folder, else its project's. Tasks without either get a scratch folder next to the database.">
              {projects.map((p) => {
                return (
                  <div key={p.id} className="flex flex-col gap-2 border-b border-line px-3.5 py-3 last:border-b-0">
                    <div className="flex items-center gap-2.5">
                      <Dot color={projectColor(p, areas)} size={7} />
                      <span className="flex-1 truncate text-[13px] text-fg">{p.name}</span>
                      <Menu align="right" width={170}
                        trigger={<button type="button" className="flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] text-mut hover:bg-hover">{p.agent ? AGENT_LABEL[p.agent] : "No agent"}<Icon name="chevronDown" size={11} /></button>}
                        items={[{ value: null as AgentId | null, label: "No agent" }, { value: "claude" as AgentId | null, label: "Claude Code" }, { value: "codex" as AgentId | null, label: "Codex" }]}
                        onSelect={(v) => run(() => updateProjectAction(p.id, { agent: v }), "Saved")} />
                      <span className="text-[12px] text-mut2">Flow</span>
                      <Switch on={p.flowOn} label={`Flow for ${p.name}`} onChange={(v) => run(() => updateProjectAction(p.id, { flowOn: v }), v ? "Flow on" : "Flow paused")} />
                    </div>
                    <input className={cx(input, "font-mono text-[11.5px]")} defaultValue={p.folder ?? ""} placeholder="C:\path\to\repo" aria-label={`Folder for ${p.name}`}
                      onBlur={(e) => (e.target.value.trim() || null) !== p.folder && run(() => updateProjectAction(p.id, { folder: e.target.value.trim() || null }), "Folder saved")} />
                  </div>
                );
              })}
              <div className="flex flex-col gap-2 bg-raised px-3.5 py-3">
                <div className="text-[12px] text-mut2">New project</div>
                <div className="flex gap-2">
                  <input className={input} placeholder="Name" value={newProject.name} onChange={(e) => setNewProject((n) => ({ ...n, name: e.target.value }))} aria-label="Project name" />
                  <Menu width={160}
                    trigger={<button type="button" className="flex h-7 items-center gap-1.5 rounded-md border border-line2 px-2 text-[12.5px] text-fg2"><Dot color={areas.find((a) => a.id === newProject.areaId)?.color ?? "var(--color-mut2)"} size={7} />{areas.find((a) => a.id === newProject.areaId)?.name}</button>}
                    items={areas.map((a) => ({ value: a.id, label: a.name, icon: <Dot color={a.color} size={7} /> }))}
                    onSelect={(v) => setNewProject((n) => ({ ...n, areaId: v }))} />
                </div>
                <div className="flex gap-2">
                  <input className={cx(input, "font-mono text-[11.5px]")} placeholder="Folder (optional)" value={newProject.folder} onChange={(e) => setNewProject((n) => ({ ...n, folder: e.target.value }))} aria-label="Project folder" />
                  <Button onClick={() => {
                    run(() => createProjectAction({ ...newProject, folder: newProject.folder.trim() || null }), `Created ${newProject.name}`);
                    setNewProject((n) => ({ ...n, name: "", folder: "" }));
                  }}>Add project</Button>
                </div>
              </div>
            </Section>

            <Section title="Auto-plan" note="The week view fills free focus time between these hours, around your fixed activities.">
              <Row label="Focus hours">
                <input type="time" className={cx(input, "max-w-[110px]")} defaultValue={settings.workStart} aria-label="Start of focus time" onBlur={(e) => save({ workStart: e.target.value })} />
                <span className="text-mut2">to</span>
                <input type="time" className={cx(input, "max-w-[110px]")} defaultValue={settings.workEnd} aria-label="End of focus time" onBlur={(e) => save({ workEnd: e.target.value })} />
              </Row>
              <Row label="Keep free">
                <input type="time" className={cx(input, "max-w-[110px]")} defaultValue={settings.lunchStart} aria-label="Break start" onBlur={(e) => save({ lunchStart: e.target.value })} />
                <span className="text-mut2">to</span>
                <input type="time" className={cx(input, "max-w-[110px]")} defaultValue={settings.lunchEnd} aria-label="Break end" onBlur={(e) => save({ lunchEnd: e.target.value })} />
              </Row>
              <Row label="Work days">
                {DAYS.map((d, i) => {
                  const n = i + 1;
                  const on = settings.workDays.includes(n);
                  return (
                    <button key={d} type="button" aria-pressed={on}
                      onClick={() => save({ workDays: on ? settings.workDays.filter((x) => x !== n) : [...settings.workDays, n].sort() })}
                      className={cx("h-7 w-10 rounded-md border text-[12px]", on ? "border-line-strong bg-sel text-strong" : "border-line2 text-mut2")}>{d}</button>
                  );
                })}
              </Row>
            </Section>

            <Section title="Data" note={`Everything is stored in one SQLite file on this computer. ${sessionsCount} sessions recorded so far.`}>
              <Row label="Database">
                <span className="flex-1 truncate font-mono text-[11.5px] text-fg3">{dbFile}</span>
              </Row>
              <Row label="Reset">
                <Button onClick={() => confirm("Replace everything with the sample data?") && run(() => resetDataAction("sample"), "Sample data loaded")}>Load sample data</Button>
                <Button onClick={() => confirm("Delete all tasks, projects, activities and sessions?") && run(() => resetDataAction("empty"), "Workspace cleared")}>Start empty</Button>
              </Row>
            </Section>
          </div>
        </div>
      </div>
      {importing && <ImportProjects areas={areas} onClose={() => setImporting(false)} />}
    </div>
  );
}
