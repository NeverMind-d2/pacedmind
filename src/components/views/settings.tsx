"use client";

import Link from "next/link";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  connectAgentAction, createProjectAction, importLegacyAction, resetDataAction, rotateMcpTokenAction, updateDeviceSettingsAction,
  setProjectServersAction, updateProjectAction, updateSettingsAction,
} from "@/app/actions";
import {
  changePasswordAction, deleteAccountAction, removeFactorAction, signOutAction, signOutEverywhereAction,
} from "@/app/auth/actions";
import { projectColor } from "@/lib/colors";
import { OLD_ANCHORS, type SettingsGroup, type SettingsSection } from "@/lib/settings-menu";
import { TERMINALS, terminalFor } from "@/lib/terminals";
import {
  AGENT_LABEL, APP_LABEL, deviceOnline,
  type AgentId, type AgentTools, type Area, type Device, type DeviceSettings, type FolderExtras, type Project, type ProjectAgentsView,
  type RemoteStart, type Settings,
} from "@/lib/types";
import { AgentIcon, AreaMark, Icon, type IconName } from "../icons";
import { ImportProjects } from "../import-projects";
import { PushSettings, type PushDevice } from "../push-settings";
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
  ["Sessions", ["list_sessions", "start_session", "close_session", "request_changes", "get_next_task", "start_task", "attach_image", "report_progress", "ask_user", "finish_task"]],
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const APPROVAL: Record<string, string> = { true: "allowed", false: "refused", null: "asks first" };

/** What agents get in a project's folder besides what they have everywhere, in a few words each; empty for nothing. */
function folderLines(h: FolderExtras): string[] {
  return [
    h.claudeMcp.length ? `Claude Code MCP servers from .mcp.json: ${h.claudeMcp.map((s) => `${s.name} (${APPROVAL[String(s.approved)]})`).join(", ")}` : null,
    h.claudeLocal.length ? `Claude Code MCP servers for this folder: ${h.claudeLocal.join(", ")}` : null,
    h.codexMcp.length ? `Codex MCP servers: ${h.codexMcp.join(", ")}` : null,
    h.plugins.length ? `Plugins: ${h.plugins.join(", ")}` : null,
    h.skills ? `${h.skills} ${h.skills === 1 ? "skill" : "skills"} in .claude/skills` : null,
    h.hooks.length ? `Hooks on ${h.hooks.join(", ")}` : null,
    h.instructions.length ? `Reads ${h.instructions.join(" and ")}` : null,
  ].filter((l): l is string => !!l);
}

/**
 * A project's agents on this computer: what they get in its folder (extras.ts), and which MCP servers besides
 * PacedMind its sessions get. "Only these" gives Claude Code just the ones picked (--strict-mcp-config, so none from
 * plugins either) and switches the others off for Codex; PacedMind's own server always stays.
 */
function ProjectAgents({ name, view, onServers }: { name: string; view: ProjectAgentsView; onServers: (names: string[] | null) => void }) {
  const [open, setOpen] = useState(false);
  const lines = view.extras ? folderLines(view.extras) : [];
  const all = [...new Set([...view.choices.claude, ...view.choices.codex, ...(view.servers ?? [])])].sort();
  const chosen = view.servers;
  const whose = (n: string) => [view.choices.claude.includes(n) ? "Claude Code" : null, view.choices.codex.includes(n) ? "Codex" : null].filter(Boolean).join(", ");
  const summary = chosen === null ? "all they have here" : chosen.length ? `only ${chosen.join(", ")}` : "none besides PacedMind";
  return (
    <div className="flex flex-col gap-1.5 text-[12px] leading-snug text-mut2">
      {lines.length > 0 && (
        <div className="flex flex-col gap-0.5" title="Read from the folder's own files and Claude Code's settings for it, on this computer">
          {lines.map((l) => <span key={l} className="break-words">{l}</span>)}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>MCP servers for its sessions: <span className="text-fg3">{summary}</span></span>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded px-1 text-fg3 hover:bg-hover hover:text-fg2">
          {open ? "Done" : "Change"}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-2 rounded-md border border-line2 bg-raised p-2.5">
          <Segmented value={chosen === null ? "all" : "some"}
            options={[{ value: "all", label: "All of them" }, { value: "some", label: "Only these" }]}
            onChange={(v) => onServers(v === "all" ? null : chosen ?? [])} />
          {chosen !== null && (all.length ? all.map((n) => (
            <div key={n} className="flex items-center gap-2.5">
              <Switch on={chosen.includes(n)} label={`${n} for ${name}`} onChange={(on) => onServers(on ? [...chosen, n] : chosen.filter((x) => x !== n))} />
              <span className="font-mono text-[11.5px] text-fg2">{n}</span>
              <span className="text-[11.5px] text-mut2">{whose(n)}</span>
            </div>
          )) : <span>Claude Code and Codex have no other MCP servers here.</span>)}
          <span className="text-[11.5px]">
            {chosen === null
              ? "Sessions get every MCP server Claude Code and Codex have in this folder, as when you start them yourself."
              : "Claude Code gets only these, and none from plugins; Codex has the others switched off. PacedMind's own server always stays."}
          </span>
        </div>
      )}
    </div>
  );
}

const REMOTE_TEXT: Record<RemoteStart, string> = {
  off: "Sessions asked for from the web app or another computer are refused.",
  ask: "Sessions asked for from the web app or another computer wait here until you allow them.",
  auto: "Sessions asked for from the web app or another computer start right away. Asking always takes a fresh two-factor code.",
};

/** A group of rows on a Settings page; the first on a page often goes without a title, which the page has. */
function Section({ title, action, children, note }: { title?: string; action?: ReactNode; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      {(title || action) && (
        <div className="flex min-h-6 items-center gap-2">
          <h3 className="flex-1 text-[13px] font-semibold text-fg2">{title}</h3>
          {action}
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-line2">{children}</div>
      {note && <p className="text-[12px] leading-relaxed text-mut2">{note}</p>}
    </section>
  );
}

/** What this computer found of an agent, in a line: "CLI 2.1.282 · Claude app 1.4". */
function foundHere(agent: AgentId, t: AgentTools): string {
  const parts = [t.cli && `CLI ${t.cli.version}`, t.app && `${APP_LABEL[agent]}${t.app.version ? ` ${t.app.version}` : ""}`].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Not found";
}

/** A label and its controls; on a phone the label goes above them. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-b border-line px-3.5 last:border-b-0 max-sm:flex-col max-sm:items-stretch max-sm:gap-1.5 max-sm:py-2.5">
      <span className="w-[120px] shrink-0 text-[12.5px] text-mut2 max-sm:w-auto">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

/** A note under the rows above it, inside the same box. */
function Hint({ children }: { children: ReactNode }) {
  return <div className="border-t border-line px-3.5 py-2.5 text-[12px] leading-relaxed text-mut2">{children}</div>;
}

const input = "h-7 min-w-0 flex-1 rounded-md border border-line2 bg-input px-2 text-[12.5px] text-fg2 outline-none focus:border-line-strong";
const codeInput = cx(input, "max-w-[96px] flex-none text-center font-mono tracking-[0.2em]");
const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(() => toast(`${what} copied`), () => toast("Couldn't copy", "error"));
}

function ComputersLink() {
  return (
    <Link href="/computers" className="flex h-6 items-center gap-1 rounded-md px-2 text-[12px] text-mut hover:bg-hover hover:text-fg2">
      Open Computers<Icon name="chevronRight" size={11} strokeWidth={2.2} />
    </Link>
  );
}

const PAGE_ICON: Record<SettingsSection, IconName> = {
  account: "user", security: "shield", data: "database",
  appearance: "palette", notifications: "bell", planning: "calendar",
  computer: "laptop", sessions: "terminal", projects: "folder", mcp: "plug",
};

/**
 * Settings' frame: the menu of its pages (a row above the page on narrow screens) and the page picked there.
 * /settings alone opens the first page, or the one an old link's anchor names (/settings#connect).
 */
export function SettingsShell({ menu, children }: { menu: SettingsGroup[]; children: ReactNode }) {
  const current = useSelectedLayoutSegment();
  const router = useRouter();
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    if (current) return;
    const ids: string[] = menu.flatMap((g) => g.pages.map((p) => p.id));
    const anchor = window.location.hash.slice(1);
    const want = OLD_ANCHORS[anchor] ?? anchor;
    router.replace(`/settings/${ids.includes(want) ? want : ids[0]}`);
  }, [current, menu, router]);
  // In the row on narrow screens, the page picked may be out of sight.
  useEffect(() => {
    nav.current?.querySelector("[aria-current=page]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line pl-5 pr-4">
        <Icon name="settings" className="text-mut" />
        <h1 className="text-[14px] font-semibold text-strong">Settings</h1>
      </div>
      <div className="flex min-h-0 flex-1 max-lg:flex-col">
        <nav ref={nav} aria-label="Settings"
          className="flex w-[216px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-line px-2.5 py-4 max-lg:w-auto max-lg:flex-row max-lg:gap-1 max-lg:overflow-x-auto max-lg:border-b max-lg:border-r-0 max-lg:px-3 max-lg:py-2">
          {menu.map((g, i) => (
            <div key={g.label ?? i} className="flex flex-col gap-px max-lg:contents">
              {g.label && <div className="flex h-[26px] items-center px-2 text-[12px] font-medium text-mut2 max-lg:hidden">{g.label}</div>}
              {g.pages.map((p) => {
                const on = current === p.id;
                return (
                  <Link key={p.id} href={`/settings/${p.id}`} aria-current={on ? "page" : undefined}
                    className={cx("flex h-[30px] shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-2 text-fg3 hover:bg-hover", on && "bg-sel text-strong")}>
                    <Icon name={PAGE_ICON[p.id]} size={15} className={on ? "text-fg2" : "text-mut"} />
                    {p.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/** A Settings page: its title and line, then its sections. */
export function SettingsContent({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-7 px-10 py-8 max-md:px-4 max-md:py-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-[16px] font-semibold text-strong">{title}</h2>
        <p className="text-[12.5px] text-mut2">{hint}</p>
      </div>
      {children}
    </div>
  );
}

export interface AccountView {
  email: string | null;
  factors: { id: string; name: string; added: string }[];
  backupCodes: boolean;
}

/** Settings → Account: signing in or out, the account's computers, deleting it. */
export function AccountSettings({ account, devices, thisDeviceId }: {
  /** The signed-in account; null without one, when the desktop app keeps this computer's own data. */
  account: AccountView | null;
  /** The computers signed in to the account, this one first. */
  devices: Device[];
  /** This computer's id in the account's list; null in the web app, or until it registered. */
  thisDeviceId: string | null;
}) {
  const { run, pending } = useAction();
  const router = useRouter();
  const [deleting, setDeleting] = useState({ email: "", code: "" });
  if (!account) {
    return (
      <Section title="PacedMind Cloud" note="Your tasks, projects and calendar are stored on this computer. Sign in to PacedMind Cloud to use them on your other computers and in the browser too. Once you're signed in, Settings → Data moves them into your account.">
        <Row label="Account">
          <span className="flex-1 text-[12.5px] text-fg3">Not signed in</span>
          <Button size="sm" onClick={() => router.push("/login")}>Sign in</Button>
        </Row>
      </Section>
    );
  }
  return <>
    <Section note="Your tasks, projects and calendar are stored in your PacedMind account.">
      <Row label="Signed in as">
        <span className="flex-1 truncate text-[12.5px] text-fg2">{account.email ?? "Unknown"}</span>
        <Button size="sm" onClick={() => run(() => signOutAction())}>Sign out</Button>
      </Row>
      <Row label="Everywhere">
        <span className="flex-1 text-[12.5px] text-fg3">Sign out every browser and computer, this one too.</span>
        <Button size="sm" onClick={() => confirm("Sign out everywhere, including here?") && run(() => signOutEverywhereAction())}>Sign out all</Button>
      </Row>
    </Section>

    {/* A summary: the Computers page shows each computer's agents, flows and sessions, and manages them. */}
    <Section title="Computers" action={<ComputersLink />}
      note="The Computers page shows what each computer has of Claude Code and Codex, its flows and its sessions. There you rename computers, choose the default and sign one out.">
      <Row label="Signed in">
        <span className="flex-1 text-[12.5px] text-fg3" suppressHydrationWarning>
          {devices.length
            ? `${devices.length} ${devices.length === 1 ? "computer" : "computers"}, ${devices.filter((d) => d.id === thisDeviceId || deviceOnline(d)).length} online`
            : "None yet. Sign in to the desktop app on a computer to add it."}
        </span>
      </Row>
      {devices.length > 0 && (
        <Row label="Default">
          <span className="flex-1 truncate text-[12.5px] text-fg3">{devices.find((d) => d.isDefault)?.name ?? "None"}</span>
        </Row>
      )}
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
  </>;
}

/** Settings → Security: the account's authenticators and its password. */
export function SecuritySettings({ account }: { account: AccountView }) {
  const { run, pending } = useAction();
  const router = useRouter();
  const [password, setPassword] = useState({ current: "", next: "", again: "", code: "" });
  const [removing, setRemoving] = useState<{ id: string; code: string } | null>(null);
  return <>
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
  </>;
}

/** Settings → Data: where the data is, moving this computer's into the account, starting over. */
export function DataSettings({ account, legacy, sessionsCount }: {
  account: boolean;
  /** What this computer's own data holds, to move into the signed-in account; null without an account. */
  legacy: { file: string; areas: number; projects: number; tasks: number } | null;
  sessionsCount: number;
}) {
  const { run } = useAction();
  return (
    <Section note={account
      ? `Stored in your account, not on this computer. Images agents attach stay on the computer they were saved on. ${sessionsCount} sessions recorded so far.`
      : `Stored on this computer, in PacedMind's data folder. ${sessionsCount} sessions recorded so far.`}>
      {legacy && legacy.tasks + legacy.projects > 0 && (
        <Row label="This computer">
          <span className="flex-1 truncate text-[12.5px] text-fg3" title={legacy.file}>
            {legacy.tasks} tasks and {legacy.projects} projects kept here without an account
          </span>
          <Button onClick={() => confirm("Move them into your account? This works on an account without projects or tasks, and replaces its areas with the ones from this computer. A copy stays on this computer, without its flows.")
            && run(() => importLegacyAction())}>Move to account</Button>
        </Row>
      )}
      <Row label="Reset">
        <Button onClick={() => confirm("Replace everything with the sample data?") && run(() => resetDataAction("sample"), "Sample data loaded")}>Load sample data</Button>
        <Button onClick={() => confirm("Delete all tasks, projects, activities and sessions?") && run(() => resetDataAction("empty"), "Workspace cleared")}>Start empty</Button>
      </Row>
    </Section>
  );
}

/** Settings → Appearance. */
export function AppearanceSettings() {
  return (
    <Section>
      <Row label="Theme"><ThemeSelector /></Row>
    </Section>
  );
}

/** Settings → Notifications: web push to the account's browsers. */
export function NotificationSettings({ push }: {
  /** The browsers where notifications are on; `web`: this page can turn them on for its own browser. */
  push: { web: boolean; devices: PushDevice[] };
}) {
  return (
    <Section note="When a session needs you (it asks you something, asks for permission, waits in its terminal or hands its task back), the computer it runs on tells every browser here, also on your phone. The desktop app shows its own notifications.">
      <PushSettings web={push.web} devices={push.devices} />
    </Section>
  );
}

/** Settings → Planning: the hours and days the auto-planner fills. */
export function PlanningSettings({ settings }: { settings: Settings }) {
  const { run } = useAction();
  const save = (patch: Partial<Settings>) => run(() => updateSettingsAction(patch), "Saved");
  return (
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
  );
}

/** Settings → This computer → General: its name, launch requests from elsewhere, and the agents it found. */
export function ComputerSettings({ device, account, found }: {
  device: DeviceSettings;
  account: boolean;
  /** This computer, with what it found of Claude Code and Codex. */
  found: Device;
}) {
  const { run } = useAction();
  const saveDevice = (patch: Parameters<typeof updateDeviceSettingsAction>[0]) => run(() => updateDeviceSettingsAction(patch));
  return <>
    <Section
      note={device.encrypted
        ? "What runs here is decided here. Agent commands, project and task folders, flow switches and access tokens stay on this computer, encrypted with a key from the operating system's keychain."
        : "What runs here is decided here. Agent commands, project and task folders, flow switches and access tokens stay on this computer. This development server keeps them unencrypted in data/."}>
      <Row label="Name">
        <input className={input} defaultValue={device.name} maxLength={80} aria-label="This computer's name"
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== device.name && saveDevice({ name: e.target.value })} />
      </Row>
      {account && <>
        <Row label="From elsewhere">
          <Segmented value={device.remoteStart} onChange={(v) => saveDevice({ remoteStart: v })}
            options={[{ value: "off", label: "Refuse" }, { value: "ask", label: "Ask me" }, { value: "auto", label: "Start" }]} />
        </Row>
        <Hint>{REMOTE_TEXT[device.remoteStart]} Agents asking over MCP always wait for you.</Hint>
      </>}
    </Section>

    <Section title="Agents found here" action={<ComputersLink />}
      note="What PacedMind found here; it looks when it starts and every half hour. The Computers page has more: cloud and sign-in for each agent, and this computer's flows and sessions.">
      {(["claude", "codex"] as AgentId[]).map((a) => (
        <Row key={a} label={AGENT_LABEL[a]}>
          <span className="flex-1 truncate text-[12.5px] text-fg3">{found.checkedAt ? foundHere(a, found.agents[a]) : "Looking…"}</span>
        </Row>
      ))}
    </Section>
  </>;
}

/** Settings → Sessions: how sessions start on this computer; in the web app, where they run. */
export function SessionSettings({ device, account, platform }: {
  /** This computer's own settings; null in the web app. */
  device: DeviceSettings | null;
  account: boolean;
  /** The server's system, which decides the terminals sessions can open in. */
  platform: NodeJS.Platform;
}) {
  const { run } = useAction();
  const saveDevice = (patch: Parameters<typeof updateDeviceSettingsAction>[0]) => run(() => updateDeviceSettingsAction(patch));
  if (!device) {
    return (
      <Section title="Agent sessions" note="Claude Code and Codex run in terminals on your computers, so they connect to the PacedMind desktop app. From here you can ask a computer to start a session; it needs a fresh two-factor code, and the computer decides by its own setting.">
        <Row label="Status"><span className="text-[12.5px] text-fg3">Handled by the desktop app</span></Row>
      </Section>
    );
  }
  return <>
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
      <Row label="Trust session folders">
        <span className="flex-1 text-[12.5px] text-fg3">{device.trustFolders ? "Answered for you" : "You answer in the terminal"}</span>
        <Switch on={device.trustFolders} label="Trust session folders" onChange={(v) => saveDevice({ trustFolders: v })} />
      </Row>
      <Hint>
        Claude Code and Codex ask whether you trust a folder the first time they start there. When this is on, PacedMind says yes for the folder a session starts in, just before it starts, so the session doesn&apos;t wait for you. A yes also lets the agent use that folder&apos;s own settings, hooks and MCP servers.
      </Hint>
    </Section>

    {account && (
      <Section title="Answering agents">
        <Row label="Answer from elsewhere">
          <span className="flex-1 text-[12.5px] text-fg3">{device.remoteAnswers ? "From any of your devices" : "Only on this computer"}</span>
          <Switch on={device.remoteAnswers} label="Answer agents from elsewhere" onChange={(v) => saveDevice({ remoteAnswers: v })} />
        </Row>
        <Hint>
          {device.remoteAnswers
            ? "When Claude Code in a session started here wants your permission for a tool, PacedMind asks you on all your devices too, for up to 10 minutes, while the terminal asks as well: the first answer counts. Questions agents ask with ask_user can be answered from the web app or another computer too, with a two-factor code from the last few minutes. Applies to sessions started from now on."
            : "Agents' questions and permission requests are answered here: in this window, or in the agent's terminal. Turn this on to answer them from your phone or another computer too."}
        </Hint>
      </Section>
    )}
  </>;
}

/** Settings → Projects: each project's agent, and in the desktop app its folder, flow and MCP servers here. */
export function ProjectSettings({ projects, areas, desktop, agents, platform }: {
  projects: Project[]; areas: Area[];
  desktop: boolean;
  /** By project: what agents get in its folder here and which MCP servers its sessions get; null in the web app. */
  agents: Record<string, ProjectAgentsView> | null;
  platform: NodeJS.Platform;
}) {
  const { run } = useAction();
  const [importing, setImporting] = useState(false);
  const defaultArea = areas.find((a) => a.key === "DEV")?.id ?? areas[0]?.id ?? "";
  const [newProject, setNewProject] = useState({ name: "", areaId: defaultArea, folder: "", agent: "claude" as AgentId | null });
  return <>
    <Section
      action={desktop && <Button size="sm" variant="ghost" onClick={() => setImporting(true)}><Icon name="download" size={12} />Import from Claude and Codex</Button>}
      note={desktop
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
            {desktop && <>
              <span className="text-[12px] text-mut2">Flow</span>
              <Switch on={p.flowOn} label={`Flow for ${p.name}`} onChange={(v) => run(() => updateProjectAction(p.id, { flowOn: v }), v ? "Flow on" : "Flow paused")} />
            </>}
          </div>
          {desktop && (
            <input className={cx(input, "font-mono text-[11.5px]")} defaultValue={p.folder ?? ""} placeholder={platform === "win32" ? "C:\\path\\to\\repo" : "/path/to/repo"} aria-label={`Folder for ${p.name}`}
              onBlur={(e) => (e.target.value.trim() || null) !== p.folder && run(() => updateProjectAction(p.id, { folder: e.target.value.trim() || null }), "Folder saved")} />
          )}
          {desktop && agents?.[p.id] && (
            <ProjectAgents name={p.name} view={agents[p.id]} onServers={(names) => run(() => setProjectServersAction(p.id, names), "Saved")} />
          )}
        </div>
      ))}
      <div className="flex flex-col gap-2 bg-raised px-3.5 py-3">
        <div className="text-[12px] text-mut2">New project</div>
        <div className="flex gap-2">
          <input className={input} placeholder="Name" value={newProject.name} onChange={(e) => setNewProject((n) => ({ ...n, name: e.target.value }))} aria-label="Project name" />
          <Menu width={160}
            trigger={<button type="button" className="flex h-7 items-center gap-1.5 rounded-md border border-line2 px-2 text-[12.5px] text-fg2"><Dot color={areas.find((a) => a.id === newProject.areaId)?.color ?? "var(--color-mut2)"} size={7} />{areas.find((a) => a.id === newProject.areaId)?.name}</button>}
            items={areas.map((a) => ({ value: a.id, label: a.name, icon: <AreaMark area={a} size={13} /> }))}
            onSelect={(v) => setNewProject((n) => ({ ...n, areaId: v }))} />
        </div>
        <div className="flex gap-2">
          {desktop && <input className={cx(input, "font-mono text-[11.5px]")} placeholder="Folder (optional)" value={newProject.folder} onChange={(e) => setNewProject((n) => ({ ...n, folder: e.target.value }))} aria-label="Project folder" />}
          <Button onClick={() => {
            run(() => createProjectAction({ ...newProject, folder: newProject.folder.trim() || null }), `Created ${newProject.name}`);
            setNewProject((n) => ({ ...n, name: "", folder: "" }));
          }}>Add project</Button>
        </div>
      </div>
    </Section>
    {importing && <ImportProjects areas={areas} onClose={() => setImporting(false)} />}
  </>;
}

/** Settings → MCP server: its address and token, connecting Claude Code and Codex, and the tools agents get. */
export function McpSettings({ mcp }: { mcp: { url: string; token: string } }) {
  const { run, pending } = useAction();
  const [showToken, setShowToken] = useState(false);
  const token = mcp.token;
  const claudeCmd = `claude mcp add --transport http --scope user pacedmind ${mcp.url} --header "Authorization: Bearer ${token}"`;
  // A header rather than bearer_token_env_var: the Codex app has no ORGANIZER_TOKEN to read.
  const codexToml = `# ~/.codex/config.toml\n[mcp_servers.pacedmind]\nurl = "${mcp.url}"\nhttp_headers = { Authorization = "Bearer ${token}" }`;
  const connect = (agent: AgentId) => {
    const what = agent === "claude" ? "Claude Code, for all projects" : "Codex's config.toml";
    if (confirm(`Add PacedMind (${mcp.url}) to ${what}, with your token? Sessions you start yourself, and those in the ${APP_LABEL[agent]}, will report to this PacedMind.`)) {
      run(() => connectAgentAction(agent));
    }
  };
  return <>
    <Section note="Claude Code and Codex use this to read your tasks and to tell PacedMind when a session picks up a task and when it's finished. Sessions PacedMind starts in a terminal get their own token, which works only for their task and only while they run.">
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
  </>;
}
