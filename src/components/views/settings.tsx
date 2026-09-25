"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  checkDeviceAction, connectAgentAction, createProjectAction, importLegacyAction, resetDataAction, rotateMcpTokenAction, updateDeviceSettingsAction,
  updateProjectAction, updateSettingsAction,
} from "@/app/actions";
import {
  changePasswordAction, deleteAccountAction, removeFactorAction, revokeDeviceAction, signOutAction, signOutEverywhereAction,
} from "@/app/auth/actions";
import { projectColor } from "@/lib/colors";
import { TERMINALS, terminalFor } from "@/lib/terminals";
import {
  AGENT_LABEL, APP_LABEL, platformName,
  type AgentId, type Area, type Device, type DeviceSettings, type Project, type RemoteStart, type Settings,
} from "@/lib/types";
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

const REMOTE_TEXT: Record<RemoteStart, string> = {
  off: "Sessions asked for from the web app or another computer are refused.",
  ask: "Sessions asked for from the web app or another computer wait here until you allow them.",
  auto: "Sessions asked for from the web app or another computer start right away. Asking always takes a fresh two-factor code.",
};

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

/** One agent on a computer: its CLI, its desktop app, and whether sessions PacedMind didn't start can report back. */
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
        {part(!!t.app, t.app ? `${APP_LABEL[agent]}${t.app.version ? ` ${t.app.version}` : ""}` : `No ${APP_LABEL[agent]}`)}
        <span className="text-faint">·</span>
        {part(t.mcp === "connected", MCP_TEXT[t.mcp])}
      </span>
      {here && t.mcp !== "connected" && (t.cli || t.app || agent === "codex") && (
        <Button size="sm" disabled={pending} onClick={() => onConnect(agent)}
          title={agent === "claude"
            ? "Adds PacedMind's MCP server to Claude Code for all projects, with your token, so the Claude app's sessions can report back"
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
const codeInput = cx(input, "max-w-[96px] flex-none text-center font-mono tracking-[0.2em]");
const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(() => toast(`${what} copied`), () => toast("Couldn't copy", "error"));
}

function seen(iso: string | null): string {
  if (!iso) return "never";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 2) return "now";
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export interface AccountView {
  email: string | null;
  factors: { id: string; name: string; added: string }[];
  backupCodes: boolean;
}

export function SettingsView({ settings, projects, areas, account, devices, thisDeviceId, device, mcp, legacy, sessionsCount, platform }: {
  settings: Settings; projects: Project[]; areas: Area[]; account: AccountView;
  /** The computers signed in to the account, this one first. */
  devices: Device[];
  /** This computer's id in the account's list; null in the web app, or until it registered. */
  thisDeviceId: string | null;
  /** This computer's own settings; null in the web app. */
  device: DeviceSettings | null;
  /** Null in the web app: agents connect to the desktop app, where their terminals run. */
  mcp: { url: string; token: string } | null;
  /** What this computer's local database from before accounts holds, if there is one. */
  legacy: { file: string; areas: number; projects: number; tasks: number } | null;
  sessionsCount: number;
  /** The server's system, which decides the terminals sessions can open in. */
  platform: NodeJS.Platform;
}) {
  const { run, pending } = useAction();
  const router = useRouter();
  const [showToken, setShowToken] = useState(false);
  const [importing, setImporting] = useState(false);
  const defaultArea = areas.find((a) => a.key === "DEV")?.id ?? areas[0]?.id ?? "";
  const [newProject, setNewProject] = useState({ name: "", areaId: defaultArea, folder: "", agent: "claude" as AgentId | null });
  const [password, setPassword] = useState({ current: "", next: "", again: "", code: "" });
  const [removing, setRemoving] = useState<{ id: string; code: string } | null>(null);
  const [deleting, setDeleting] = useState({ email: "", code: "" });
  const save = (patch: Partial<Settings>) => run(() => updateSettingsAction(patch), "Saved");
  const saveDevice = (patch: Parameters<typeof updateDeviceSettingsAction>[0]) => run(() => updateDeviceSettingsAction(patch));
  const token = mcp?.token ?? "";
  const claudeCmd = mcp ? `claude mcp add --transport http --scope user organizer ${mcp.url} --header "Authorization: Bearer ${token}"` : "";
  // A header rather than bearer_token_env_var: the Codex app has no ORGANIZER_TOKEN to read.
  const codexToml = mcp ? `# ~/.codex/config.toml\n[mcp_servers.organizer]\nurl = "${mcp.url}"\nhttp_headers = { Authorization = "Bearer ${token}" }` : "";
  const connect = (agent: AgentId) => {
    const what = agent === "claude" ? "Claude Code, for all projects" : "Codex's config.toml";
    if (confirm(`Add PacedMind (${mcp?.url ?? "this computer"}) to ${what}, with your token? Sessions you start yourself, and those in the ${APP_LABEL[agent]}, will report to this PacedMind.`)) {
      run(() => connectAgentAction(agent));
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line pl-5 pr-4">
        <Icon name="settings" className="text-mut" />
        <h1 className="text-[14px] font-semibold text-strong">Settings</h1>
        <span className="text-mut2">Account, security, this computer and planning</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1180px] grid-cols-2 gap-10 px-10 py-8">
          <div className="flex flex-col gap-7">
            <Section title="Account" note="Your tasks, projects and calendar are stored in your PacedMind account.">
              <Row label="Signed in as">
                <span className="flex-1 truncate text-[12.5px] text-fg2">{account.email ?? "Unknown"}</span>
                <Button size="sm" onClick={() => run(() => signOutAction())}>Sign out</Button>
              </Row>
              <Row label="Everywhere">
                <span className="flex-1 text-[12.5px] text-fg3">Sign out every browser and computer, this one too.</span>
                <Button size="sm" onClick={() => confirm("Sign out everywhere, including here?") && run(() => signOutEverywhereAction())}>Sign out all</Button>
              </Row>
            </Section>

            <Section title="Two-factor sign-in"
              note="Every sign-in asks for a code from an authenticator app, because PacedMind can start agents on your computers. Keep a second authenticator in case you lose your phone.">
              {account.factors.map((f) => (
                <Row key={f.id} label={f.name}>
                  <span className="flex-1 text-[12.5px] text-fg3">Added {f.added}</span>
                  {removing?.id === f.id ? (
                    <>
                      <input className={codeInput} value={removing.code} onChange={(e) => setRemoving({ id: f.id, code: digits(e.target.value) })}
                        placeholder="Code" aria-label="A code from your other authenticator" inputMode="numeric" autoComplete="one-time-code" />
                      <Button size="sm" disabled={pending} onClick={() => run(() => removeFactorAction(f.id, removing.code).then((r) => { if (r.ok) setRemoving(null); return r; }))}>Remove</Button>
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>Cancel</Button>
                    </>
                  ) : (
                    <Button size="sm" disabled={account.factors.length < 2} title={account.factors.length < 2 ? "Add another authenticator first" : undefined}
                      onClick={() => setRemoving({ id: f.id, code: "" })}>Remove</Button>
                  )}
                </Row>
              ))}
              <Row label="Add">
                <span className="flex-1 text-[12.5px] text-fg3">{account.factors.length < 2 ? "Add a second authenticator as a backup." : "Another phone or password manager."}</span>
                <Button size="sm" onClick={() => router.push("/login/setup?add=1")}>Add authenticator</Button>
              </Row>
              {account.backupCodes && (
                <Row label="Backup codes"><span className="text-[12.5px] text-fg3">Set up</span></Row>
              )}
            </Section>

            <Section title="Password" note="Changing it needs your current password and a current two-factor code, and signs out your other devices.">
              <Row label="Current">
                <input type="password" className={input} value={password.current} onChange={(e) => setPassword((p) => ({ ...p, current: e.target.value }))}
                  autoComplete="current-password" maxLength={72} aria-label="Current password" />
              </Row>
              <Row label="New password">
                <input type="password" className={input} value={password.next} onChange={(e) => setPassword((p) => ({ ...p, next: e.target.value }))}
                  autoComplete="new-password" maxLength={72} placeholder="At least 12 characters" aria-label="New password" />
              </Row>
              <Row label="Again">
                <input type="password" className={input} value={password.again} onChange={(e) => setPassword((p) => ({ ...p, again: e.target.value }))}
                  autoComplete="new-password" maxLength={72} aria-label="New password again" />
              </Row>
              <Row label="Code">
                <input className={codeInput} value={password.code} onChange={(e) => setPassword((p) => ({ ...p, code: digits(e.target.value) }))}
                  placeholder="000000" inputMode="numeric" autoComplete="one-time-code" aria-label="Two-factor code" />
                <span className="flex-1" />
                <Button disabled={pending || !password.current || !password.next || password.code.length !== 6} onClick={() => {
                  if (password.next !== password.again) return toast("The two passwords don't match", "error");
                  run(() => changePasswordAction(password.current, password.next, password.code)
                    .then((r) => { if (r.ok) setPassword({ current: "", next: "", again: "", code: "" }); return r; }));
                }}>Change password</Button>
              </Row>
            </Section>

            <Section id="devices" title="Computers"
              action={device && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => checkDeviceAction())}><Icon name="refresh" size={12} />Check again</Button>}
              note="Computers with the PacedMind desktop app signed in to your account, and what each found of Claude Code and Codex (it looks when it starts and every half hour). Connected, the agents' desktop apps report back like terminal sessions. Signing a computer out ends its session at once, and its agents lose access to PacedMind.">
              {devices.length === 0 && <Row label="None yet"><span className="text-[12.5px] text-fg3">Sign in to the desktop app to add a computer.</span></Row>}
              {devices.map((d) => {
                const here = !!thisDeviceId && d.id === thisDeviceId;
                return (
                  <div key={d.id} className="flex flex-col gap-1 border-b border-line px-3.5 py-2.5 last:border-b-0">
                    <div className="flex h-7 items-center gap-2.5">
                      <Icon name="laptop" size={14} className="text-mut" />
                      <span className="truncate text-[13px] font-medium text-fg">{d.name}</span>
                      <span className="flex-1 truncate text-[12px] text-mut2">
                        {platformName(d.platform)}{here ? " · this computer" : ` · seen ${seen(d.lastSeenAt)}`}
                      </span>
                      <Button size="sm" onClick={() => confirm(`Sign ${d.name} out of PacedMind? Its agents lose access right away.`) && run(() => revokeDeviceAction(d.id))}>Sign out</Button>
                    </div>
                    {d.checkedAt
                      ? (["claude", "codex"] as AgentId[]).map((a) => <AgentTools key={a} agent={a} device={d} here={here} pending={pending} onConnect={connect} />)
                      : <p className="pb-1 text-[12px] text-mut2">{here ? "Looking for Claude Code and Codex…" : "Hasn't looked for Claude Code and Codex yet."}</p>}
                  </div>
                );
              })}
            </Section>

            <Section title="Appearance">
              <Row label="Theme"><ThemeSelector /></Row>
            </Section>

            <Section title="Delete account" note="Deletes your account and everything in it: areas, projects, tasks, calendar, sessions and computers. It can't be undone.">
              <Row label="Your email">
                <input className={input} value={deleting.email} onChange={(e) => setDeleting((d) => ({ ...d, email: e.target.value }))} placeholder={account.email ?? ""} aria-label="Type your email to confirm" />
              </Row>
              <Row label="Code">
                <input className={codeInput} value={deleting.code} onChange={(e) => setDeleting((d) => ({ ...d, code: digits(e.target.value) }))}
                  placeholder="000000" inputMode="numeric" autoComplete="one-time-code" aria-label="Two-factor code" />
                <span className="flex-1" />
                <Button disabled={pending || deleting.code.length !== 6 || !deleting.email}
                  onClick={() => confirm("Delete your PacedMind account and all its data for good?") && run(() => deleteAccountAction(deleting.code, deleting.email))}>
                  Delete account
                </Button>
              </Row>
            </Section>
          </div>

          <div className="flex flex-col gap-7">
            {!device && (
              <Section title="Agent sessions" note="Claude Code and Codex run in terminals on your computers, so they connect to the PacedMind desktop app. From here you can ask a computer to start a session; it needs a fresh two-factor code, and the computer decides by its own setting.">
                <Row label="Status"><span className="text-[12.5px] text-fg3">Handled by the desktop app</span></Row>
              </Section>
            )}

            {device && <>
              <Section title="This computer"
                note={device.encrypted
                  ? "What runs here is decided here. Agent commands, project and task folders, flow switches and access tokens stay on this computer, encrypted with a key from the operating system's keychain."
                  : "What runs here is decided here. Agent commands, project and task folders, flow switches and access tokens stay on this computer. This development server keeps them unencrypted in data/."}>
                <Row label="Name">
                  <input className={input} defaultValue={device.name} maxLength={80} aria-label="This computer's name"
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== device.name && saveDevice({ name: e.target.value })} />
                </Row>
                <Row label="From elsewhere">
                  <Segmented value={device.remoteStart} onChange={(v) => saveDevice({ remoteStart: v })}
                    options={[{ value: "off", label: "Refuse" }, { value: "ask", label: "Ask me" }, { value: "auto", label: "Start" }]} />
                </Row>
                <div className="border-t border-line px-3.5 py-2.5 text-[12px] leading-relaxed text-mut2">{REMOTE_TEXT[device.remoteStart]} Agents asking over MCP always wait for you.</div>
              </Section>

              <Section title="Starting sessions">
                {TERMINALS[platform] && (
                  <Row label="Terminal">
                    <Segmented value={terminalFor(device.terminal, platform).value} onChange={(v) => saveDevice({ terminal: v })}
                      options={TERMINALS[platform]!} />
                  </Row>
                )}
                <Row label="Claude command">
                  <input className={input} defaultValue={device.claudeCommand} aria-label="Claude command"
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== device.claudeCommand && saveDevice({ claudeCommand: e.target.value })} />
                </Row>
                <Row label="Codex command">
                  <input className={input} defaultValue={device.codexCommand} aria-label="Codex command"
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== device.codexCommand && saveDevice({ codexCommand: e.target.value })} />
                </Row>
              </Section>
            </>}

            {mcp && <>
              <Section title="MCP server" note="Claude Code and Codex use this to read your tasks and to tell PacedMind when a session picks up a task and when it's finished. Sessions PacedMind starts in a terminal get their own token, which works only for their task and only while they run.">
                <Row label="Address">
                  <span className="flex-1 truncate font-mono text-[12px] text-fg2">{mcp.url}</span>
                  <Button size="sm" onClick={() => copy(mcp.url, "Address")}>Copy</Button>
                </Row>
                <Row label="Your token">
                  <span className="flex-1 truncate font-mono text-[12px] text-fg2">{showToken ? token : `${token.slice(0, 5)}${"•".repeat(16)}${token.slice(-4)}`}</span>
                  <Button size="sm" onClick={() => setShowToken((s) => !s)}>{showToken ? "Hide" : "Show"}</Button>
                  <Button size="sm" onClick={() => copy(token, "Token")}>Copy</Button>
                  <Button size="sm" onClick={() => confirm("Make a new token? Agents set up with the old one lose access until you connect them again.") && run(() => rotateMcpTokenAction())}>New token</Button>
                </Row>
              </Section>

              <Section title="Connect your agents" note="For Claude Code and Codex you start yourself, and for sessions in their desktop apps. Anyone with your token can use PacedMind from this computer, so keep it out of shared files.">
                <div className="flex flex-col gap-2.5 border-b border-line p-3.5">
                  <div className="flex items-center gap-2.5">
                    <AgentIcon agent="claude" size={14} className="text-fg3" />
                    <span className="flex-1 text-[13px] font-medium text-fg">Claude Code</span>
                    <Button size="sm" disabled={pending} onClick={() => connect("claude")}>Connect</Button>
                    <Button size="sm" onClick={() => copy(claudeCmd, "Command")}>Copy command</Button>
                  </div>
                  <p className="text-[12px] text-mut2">Connect adds PacedMind to Claude Code for all your projects, with your token, without showing it. The Claude app&apos;s Code sessions use it too.</p>
                </div>
                <div className="flex flex-col gap-2.5 p-3.5">
                  <div className="flex items-center gap-2.5">
                    <AgentIcon agent="codex" size={14} className="text-fg3" />
                    <span className="flex-1 text-[13px] font-medium text-fg">Codex</span>
                    <Button size="sm" disabled={pending} onClick={() => connect("codex")}>Connect</Button>
                    <Button size="sm" onClick={() => copy(codexToml, "Config")}>Copy config</Button>
                  </div>
                  <pre className="whitespace-pre-wrap break-all rounded-md border border-line bg-input px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-fg3">{showToken ? codexToml : codexToml.replace(token, "•".repeat(16))}</pre>
                  <p className="text-[12px] text-mut2">The Codex CLI and the Codex app share this file. Sessions started from PacedMind don&apos;t need it: they get their own token.</p>
                </div>
              </Section>

              <Section title="Tools agents can use"
                note={<>Sessions started from PacedMind may read, add and update tasks, and report on their own task; nothing else, whatever they&apos;re asked. Starting a session or sending one back with changes over MCP waits for you to allow it here. Run <span className="font-mono">npm run skills</span> to install the PacedMind skills for Claude Code and Codex.</>}>
                {TOOL_GROUPS.map(([group, names]) => (
                  <div key={group} className="flex items-start gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0">
                    <span className="w-[72px] shrink-0 text-[12.5px] text-mut2">{group}</span>
                    <span className="min-w-0 flex-1 font-mono text-[11.5px] leading-relaxed text-fg3">{names.join(", ")}</span>
                  </div>
                ))}
              </Section>
            </>}

            <Section title={device ? "Projects on this computer" : "Projects"}
              action={device && <Button size="sm" variant="ghost" onClick={() => setImporting(true)}><Icon name="download" size={12} />Import from Claude and Codex</Button>}
              note={device
                ? "A session works in its task's own folder on this computer, else its project's; without either it gets a scratch folder. A flow only starts sessions by itself when it's on here. Changing a folder turns the flow off."
                : "Folders and flows are set in the desktop app, on the computer where the sessions run."}>
              {projects.map((p) => (
                <div key={p.id} className="flex flex-col gap-2 border-b border-line px-3.5 py-3 last:border-b-0">
                  <div className="flex items-center gap-2.5">
                    <Dot color={projectColor(p, areas)} size={7} />
                    <span className="flex-1 truncate text-[13px] text-fg">{p.name}</span>
                    <Menu align="right" width={170}
                      trigger={<button type="button" className="flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] text-mut hover:bg-hover">{p.agent ? AGENT_LABEL[p.agent] : "No agent"}<Icon name="chevronDown" size={11} /></button>}
                      items={[{ value: null as AgentId | null, label: "No agent" }, { value: "claude" as AgentId | null, label: "Claude Code" }, { value: "codex" as AgentId | null, label: "Codex" }]}
                      onSelect={(v) => run(() => updateProjectAction(p.id, { agent: v }), "Saved")} />
                    {device && <>
                      <span className="text-[12px] text-mut2">Flow</span>
                      <Switch on={p.flowOn} label={`Flow for ${p.name}`} onChange={(v) => run(() => updateProjectAction(p.id, { flowOn: v }), v ? "Flow on" : "Flow paused")} />
                    </>}
                  </div>
                  {device && (
                    <input className={cx(input, "font-mono text-[11.5px]")} defaultValue={p.folder ?? ""} placeholder={platform === "win32" ? "C:\\path\\to\\repo" : "/path/to/repo"} aria-label={`Folder for ${p.name}`}
                      onBlur={(e) => (e.target.value.trim() || null) !== p.folder && run(() => updateProjectAction(p.id, { folder: e.target.value.trim() || null }), "Folder saved")} />
                  )}
                </div>
              ))}
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
                  {device && <input className={cx(input, "font-mono text-[11.5px]")} placeholder="Folder (optional)" value={newProject.folder} onChange={(e) => setNewProject((n) => ({ ...n, folder: e.target.value }))} aria-label="Project folder" />}
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

            <Section title="Data" note={`Stored in your account, not on this computer. Images agents attach stay on the computer they were saved on. ${sessionsCount} sessions recorded so far.`}>
              {legacy && legacy.tasks + legacy.projects > 0 && (
                <Row label="This computer">
                  <span className="flex-1 truncate text-[12.5px] text-fg3" title={legacy.file}>
                    {legacy.tasks} tasks and {legacy.projects} projects from before accounts
                  </span>
                  <Button onClick={() => confirm("Import them into your account? This works on an account without projects or tasks, and replaces its areas with the ones from this computer.")
                    && run(() => importLegacyAction())}>Import</Button>
                </Row>
              )}
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
