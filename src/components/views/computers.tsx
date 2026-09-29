"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { checkDeviceAction, connectAgentAction, renameDeviceAction, setDefaultDeviceAction, updateDeviceSettingsAction } from "@/app/actions";
import { revokeDeviceAction } from "@/app/auth/actions";
import { parseLocal, toDateStr } from "@/lib/dates";
import { REMOTE_START_LABEL, REMOTE_START_OPTIONS, fromElsewhereText, remoteCodeLabel } from "@/lib/from-elsewhere";
import {
  AGENT_LABEL, APP_LABEL, CLOUD_LABEL, deviceOnline, mcpReaches, platformName,
  type AgentId, type AgentTools, type Device, type RemoteStart, type ReportOutcome, type SessionStatus, type Surface,
} from "@/lib/types";
import { ConfirmDialog } from "../dialog";
import { InlineName } from "../entity-menu";
import { AgentIcon, Icon, SurfaceIcon, type IconName } from "../icons";
import { ToolIcon } from "../tool-icon";
import { Button, Dot, Segmented, Switch, cx, useAction } from "../ui";

/* ---------- data from the server ---------- */

/** A session at work or waiting for you, under the computer it runs on (or that sent it to the agent's cloud). */
export interface ComputerSession {
  id: string;
  status: SessionStatus;
  agent: AgentId;
  surface: Surface;
  /** Its computer. Without an account every session is this computer's. */
  deviceId: string | null;
  key: string | null;
  title: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** How the agent handed the task back, for a session waiting for you. */
  outcome: ReportOutcome | null;
}

/** A project whose flow is switched on at some computer. */
export interface FlowProject {
  id: string;
  name: string;
  color: string;
}

/* ---------- words ---------- */

const AGENTS: AgentId[] = ["claude", "codex"];

const MCP_TEXT = { connected: "Connected", old: "Old name", cloud: "PacedMind Cloud", elsewhere: "Reports elsewhere", missing: "Not connected" } as const;
const MCP_HINT = {
  connected: "Sessions in the agent's desktop app, and those you start yourself, report back to PacedMind.",
  old: "Set up under PacedMind's old MCP name, organizer: it works, and Connect sets it up as pacedmind.",
  cloud: "Sessions in the agent's desktop app, and those you start yourself, report to PacedMind Cloud's MCP server, signed in with your account.",
  elsewhere: "Set up for another PacedMind (a different address or token), so its desktop app's sessions report there.",
  missing: "Sessions in the agent's desktop app can't report back until it's connected, in the PacedMind desktop app on that computer.",
} as const;

/** How a CLI signed in, as the few words it says it in. Anything else shows as it came. */
function methodName(m: string | undefined): string | null {
  if (!m) return null;
  if (/^(claude\.?ai|claude[ _-]ai|oauth)$/.test(m)) return "Claude account";
  if (/^(chatgpt|chat[ _-]gpt)$/.test(m)) return "ChatGPT";
  if (/api[ _-]?key|console/.test(m)) return "API key";
  if (m === "bedrock") return "Amazon Bedrock";
  if (m === "vertex") return "Google Vertex AI";
  return m;
}

const planName = (p: string | undefined) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : null);

/** "4 min ago", "3 h ago", "yesterday", "5 days ago" or "on 12 Sep". */
function ago(iso: string, now: number): string {
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return days === 1 ? "yesterday" : `${days} days ago`;
  return `on ${format(new Date(iso), "d MMM")}`;
}

/** "14:02" today, else "24 Sep". Session times are local stamps. */
const clock = (stamp: string, now: number) => {
  const d = parseLocal(stamp);
  return toDateStr(d) === toDateStr(new Date(now)) ? format(d, "HH:mm") : format(d, "d MMM");
};

function sessionMeta(s: ComputerSession, now: number): string {
  if (s.status === "finished") return s.outcome === "blocked" ? "stuck, needs you" : s.outcome === "partial" ? "partly done, waiting" : "waiting for you";
  return s.status === "starting" ? "starting" : `since ${clock(s.startedAt, now)}`;
}

const where = (s: ComputerSession) => (s.surface === "cloud" ? CLOUD_LABEL[s.agent] : s.surface === "desktop" ? `the ${APP_LABEL[s.agent]}` : "a terminal");

const SESSIONS_SHOWN = 6;

/* ---------- the view ---------- */

export function ComputersView({ devices, hereId, account, registering, projects, sessions, mcpUrl, now: serverNow }: {
  /** The account's signed-in computers, this one first; without an account, just this one. */
  devices: Device[];
  /** This computer's id among them (the desktop app; "" without an account); null in the web app. */
  hereId: string | null;
  /** Signed in to PacedMind Cloud (the web app always is). */
  account: boolean;
  /** Signed in in the desktop app, but this computer hasn't joined the account's list yet (it does within seconds). */
  registering: boolean;
  projects: FlowProject[];
  sessions: ComputerSession[];
  /** This computer's MCP address, for connecting its agents; null in the web app. */
  mcpUrl: string | null;
  /** The server's clock (ms), so the first render matches it. */
  now: number;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [ticked, setTicked] = useState(serverNow);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<Device | null>(null);
  const now = Math.max(ticked, serverNow);
  const others = devices.some((d) => d.id !== hereId);

  // "Last seen" moves on by itself. A computer says it's there every minute, which changes nothing else, so no other
  // page refreshes for it: this one does, while it's in view, to keep the online dots true.
  useEffect(() => {
    const tick = window.setInterval(() => setTicked(Date.now()), 30_000);
    const reload = account && others
      ? window.setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 60_000)
      : undefined;
    return () => {
      window.clearInterval(tick);
      window.clearInterval(reload);
    };
  }, [account, others, router]);

  const online = (d: Device) => d.id === hereId || deviceOnline(d, now);
  const onlineCount = devices.filter(online).length;
  const subtitle = !account ? "This computer"
    : devices.length ? `${devices.length} signed in · ${onlineCount} online` : registering ? "Adding this computer" : "None signed in yet";
  const byId = new Map(projects.map((p) => [p.id, p]));

  const connect = (agent: AgentId) => {
    const what = agent === "claude" ? "Claude Code, for all projects" : "Codex's config.toml";
    if (confirm(`Add PacedMind (${mcpUrl ?? "this computer"}) to ${what}, with your token? Sessions you start yourself, and those in the ${APP_LABEL[agent]}, will report to this PacedMind.`)) {
      run(() => connectAgentAction(agent));
    }
  };

  return (
    <section aria-label="Computers" className="@container flex min-w-0 flex-col gap-5 max-md:gap-4">
      <p title={account ? "What runs on a computer is decided there, in its desktop app. It's online when it checked in during the last two minutes." : undefined}
        className="text-[12.5px] text-mut2">{subtitle}</p>
      {registering && (
        <div className="flex items-center gap-3 rounded-lg border border-line2 px-4 py-3.5 text-[12.5px] text-mut">
          <Icon name="laptop" size={16} className="shrink-0 text-mut2" />
          Adding this computer to your account…
        </div>
      )}

      {devices.map((d) => (
        <Computer key={d.id} d={d} here={d.id === hereId} desktop={hereId !== null} account={account} online={online(d)} now={now}
          flows={d.flowsOn.flatMap((id) => byId.get(id) ?? [])}
          sessions={sessions.filter((s) => (account ? s.deviceId === d.id : d.id === hereId))}
          renaming={renaming === d.id} pending={pending}
          onRename={() => setRenaming(d.id)} onRenamed={() => setRenaming(null)}
          onSave={(name) => { setRenaming(null); run(() => renameDeviceAction(d.id, name)); }}
          onDefault={() => run(() => setDefaultDeviceAction(d.id))}
          onCheck={() => run(() => checkDeviceAction())}
          onConnect={connect}
          onRemote={(patch) => run(() => updateDeviceSettingsAction(patch))}
          onSignOut={() => setLeaving(d)} />
      ))}

      {account && !devices.length && !registering && (
        <div className="flex flex-col items-center gap-3 px-6 py-20 text-center max-md:py-14">
          <Icon name="laptop" size={22} className="text-mut2" />
          <div className="text-[14px] text-fg2">No computers yet</div>
          <p className="max-w-md text-[12.5px] leading-relaxed text-mut2">
            Claude Code and Codex sessions run on your computers. Install the PacedMind desktop app on one where you use them, and
            sign in there with this account: it shows up here within a minute.
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <a href="https://pacedmind.com/download/windows" target="_blank" rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-ctl px-3 text-[12.5px] text-fg2 hover:bg-hover">
              <Icon name="download" size={13} />Download for Windows
            </a>
            <a href="https://pacedmind.com/download/mac" target="_blank" rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-ctl px-3 text-[12.5px] text-fg2 hover:bg-hover">
              <Icon name="download" size={13} />Download for macOS
            </a>
          </div>
        </div>
      )}

      {!account && (
        <div className="flex items-start gap-3 rounded-lg border border-dashed border-line2 px-4 py-3.5 max-md:px-3.5">
          <Icon name="cloud" size={16} className="mt-0.5 shrink-0 text-mut2" />
          <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-mut">
            With PacedMind Cloud your computers work together: each one shows up here with what it has and runs, and you can start
            a session on one from another, or from your phone.
          </p>
          <Link href="/login" className="inline-flex h-7 shrink-0 items-center rounded-md border border-ctl px-2.5 text-[12.5px] text-fg2 hover:bg-hover">
            Sign in
          </Link>
        </div>
      )}

      {leaving && (
        <ConfirmDialog title={leaving.id === hereId ? "Sign this computer out?" : `Sign ${leaving.name} out?`} confirmLabel="Sign out" danger
          onCancel={() => setLeaving(null)}
          onConfirm={() => { const id = leaving.id; setLeaving(null); run(() => revokeDeviceAction(id)); }}>
          {leaving.id === hereId
            ? "Your sign-in here ends at once, this computer's agents lose access to PacedMind, and requests waiting for it are canceled. PacedMind goes on here with this computer's own data until you sign in again."
            : `Its session ends at once: it can't read or change anything in your account from now on, and requests waiting for it are canceled. Within a minute it notices, and its agents lose access to PacedMind.${leaving.isDefault ? " It stops being your default computer." : ""} To use it again, sign in there.`}
        </ConfirmDialog>
      )}
    </section>
  );
}

/* ---------- one computer ---------- */

function Computer({ d, here, desktop, account, online, now, flows, sessions, renaming, pending, onRename, onRenamed, onSave, onDefault, onCheck, onConnect, onRemote, onSignOut }: {
  d: Device; here: boolean;
  /** Seen in the desktop app (which has a computer of its own), not the web app. */
  desktop: boolean;
  account: boolean; online: boolean; now: number;
  flows: FlowProject[]; sessions: ComputerSession[];
  renaming: boolean; pending: boolean;
  onRename: () => void; onRenamed: () => void; onSave: (name: string) => void;
  onDefault: () => void; onCheck: () => void; onConnect: (agent: AgentId) => void;
  /** Changes this computer's settings for sessions asked for from elsewhere (its own window only). */
  onRemote: (patch: { remoteStart?: RemoteStart; remoteCode?: boolean }) => void;
  onSignOut: () => void;
}) {
  // Waiting for you first, then what runs, oldest first.
  const list = [...sessions].sort((a, b) =>
    Number(b.status === "finished") - Number(a.status === "finished") || a.startedAt.localeCompare(b.startedAt));
  const status = here ? (account ? "Online" : null) : online ? "Online" : d.lastSeenAt ? `Last seen ${ago(d.lastSeenAt, now)}` : "Not seen yet";

  return (
    // Relative, so the screen-reader labels (absolutely placed) scroll with the card instead of stretching the page.
    <article aria-label={d.name} className="relative overflow-hidden rounded-lg border border-line2">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-3.5 max-md:px-3.5">
        <div className="flex min-w-[min(100%,260px)] flex-1 items-start gap-3">
          <Icon name="laptop" size={18} className="mt-[5px] shrink-0 text-mut" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {renaming ? (
                <InlineName initial={d.name} placeholder="Computer name" onSave={onSave} onCancel={onRenamed} className="max-w-[280px]" />
              ) : (
                <>
                  <h3 className="min-w-0 truncate text-[14px] font-semibold text-strong">{d.name}</h3>
                  <button type="button" aria-label={`Rename ${d.name}`} title="Rename" onClick={onRename}
                    className="-ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-mut hover:bg-hover hover:text-fg2 pointer-coarse:h-8 pointer-coarse:w-8">
                    <Icon name="pen" size={12} />
                  </button>
                </>
              )}
              {here && <Badge>This computer</Badge>}
              {account && d.isDefault && (
                <Badge title="Sessions go to the default computer when neither the task nor its project names one.">
                  <Icon name="check" size={11} strokeWidth={2.4} />Default
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-mut2">
              {status && (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden className={cx("h-[7px] w-[7px] shrink-0 rounded-full", online ? "bg-fg2" : "border border-dim")} />
                  <span className={online ? "text-fg3" : undefined} suppressHydrationWarning>{status}</span>
                </span>
              )}
              {status && <Sep />}
              <span>{platformName(d.platform)}</span>
              <Sep />
              <span>{d.appVersion ? `PacedMind ${d.appVersion}` : "PacedMind version unknown"}</span>
              {d.checkedAt && (
                <>
                  <Sep />
                  <span title="When it last looked for Claude Code and Codex: when it starts and every half hour" suppressHydrationWarning>
                    checked {ago(d.checkedAt, now)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 @max-xl:w-full @max-xl:pl-[30px]">
          {here && (
            <Button disabled={pending} onClick={onCheck} title="Looks for Claude Code and Codex on this computer again">
              <Icon name="refresh" size={12} />Check again
            </Button>
          )}
          {account && !d.isDefault && (
            <Button disabled={pending} onClick={onDefault} title="Sessions go to the default computer when neither the task nor its project names one.">
              Make default
            </Button>
          )}
          {account && <Button disabled={pending} onClick={onSignOut}>Sign out</Button>}
        </div>
      </header>

      <Agents d={d} here={here && desktop} pending={pending} onConnect={onConnect} />

      <div className="flex flex-col gap-3 border-t border-line px-4 py-3.5 max-md:px-3.5">
        {account && (
          <Line label="From elsewhere" title="Sessions asked for from the web app or another computer. Each computer sets this itself, in its desktop app.">
            <FromElsewhere d={d} editable={here && desktop} onChange={onRemote} />
          </Line>
        )}
        <Line label="Flows on" title="Projects whose flow may start sessions by itself on this computer. Each computer switches its own, in Flows.">
          {flows.length ? (
            <div className="flex min-h-8 flex-wrap items-center gap-1.5">
              {flows.map((p) => (
                <Link key={p.id} href={`/flows?p=${p.id}`}
                  className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-line2 px-2 text-[12.5px] text-fg2 hover:bg-hover">
                  <Dot color={p.color} size={7} />
                  <span className="truncate">{p.name}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="flex min-h-8 items-center text-[12.5px] text-mut2 @max-xl:min-h-0">None</p>
          )}
        </Line>
        <Line label="Sessions">
          {list.length ? (
            <div className="flex min-w-0 flex-col">
              {list.slice(0, SESSIONS_SHOWN).map((s) => <SessionRow key={s.id} s={s} now={now} />)}
              {list.length > SESSIONS_SHOWN && (
                <Link href="/sessions" className="flex h-7 items-center text-[12px] text-mut2 hover:text-fg2">
                  {list.length - SESSIONS_SHOWN} more in Sessions
                </Link>
              )}
            </div>
          ) : (
            <p className="flex min-h-8 items-center text-[12.5px] text-mut2 @max-xl:min-h-0">Nothing running or waiting</p>
          )}
        </Line>
      </div>
    </article>
  );
}

const Sep = () => <span aria-hidden className="text-faint">·</span>;

function Badge({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <span title={title} className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-line2 px-1.5 text-[11px] text-mut">{children}</span>
  );
}

/**
 * What the computer does with sessions asked for from the web app or another computer, and whether asking needs a
 * two-factor code. It decides both itself, so only its own window changes them: there they can be changed here too.
 */
function FromElsewhere({ d, editable, onChange }: {
  d: Device; editable: boolean; onChange: (patch: { remoteStart?: RemoteStart; remoteCode?: boolean }) => void;
}) {
  if (!editable) {
    return (
      <p title={`${fromElsewhereText(d.remoteStart, d.remoteCode, "there")} It's set in PacedMind on that computer.`}
        className="flex min-h-8 flex-wrap items-center gap-x-1.5 text-[12.5px] text-fg2 @max-xl:min-h-0">
        {REMOTE_START_LABEL[d.remoteStart]}
        {d.remoteStart !== "off" && <><span aria-hidden className="text-faint">·</span><span className="text-mut">{remoteCodeLabel(d.remoteCode)}</span></>}
      </p>
    );
  }
  return (
    <div title={fromElsewhereText(d.remoteStart, d.remoteCode, "here")} className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2">
      <Segmented value={d.remoteStart} options={REMOTE_START_OPTIONS} onChange={(v) => onChange({ remoteStart: v })} />
      <label className="flex items-center gap-2 text-[12.5px] text-fg3">
        <Switch on={d.remoteCode} label="Ask for a two-factor code" onChange={(v) => onChange({ remoteCode: v })} />
        Two-factor code
      </label>
    </div>
  );
}

/** A label and what it names, both on 32 px lines so they align; on a narrow card the label goes above. */
function Line({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3 @max-xl:flex-col @max-xl:gap-1">
      <span title={title} className="flex h-8 w-[132px] shrink-0 items-center text-[12px] text-mut2 @max-xl:h-auto @max-xl:w-auto">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function SessionRow({ s, now }: { s: ComputerSession; now: number }) {
  const waiting = s.status === "finished";
  return (
    <Link href={`/sessions?s=${s.id}`} title={`${AGENT_LABEL[s.agent]} in ${where(s)}`}
      className="-mx-2 flex h-8 min-w-0 items-center gap-2.5 rounded-md px-2 hover:bg-hover pointer-coarse:h-9">
      {/* The navy accent means "finished, waiting for you"; what runs is gray. */}
      <span aria-hidden className={cx("h-[7px] w-[7px] shrink-0 rounded-full border",
        waiting ? "border-accent bg-accent" : s.status === "starting" ? "border-fg3" : "border-fg3 bg-fg3")} />
      {s.key && <span className="shrink-0 font-mono text-[11.5px] text-mut2">{s.key}</span>}
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg2">{s.title ?? "Deleted task"}</span>
      <span className="flex shrink-0 items-center gap-1 text-mut">
        <AgentIcon agent={s.agent} size={12} />
        <SurfaceIcon surface={s.surface} size={11} className="text-dim" />
      </span>
      <span className={cx("shrink-0 text-right text-[12px]", waiting ? "text-fg3" : "text-mut2")} suppressHydrationWarning>{sessionMeta(s, now)}</span>
    </Link>
  );
}

/* ---------- its agents ---------- */

/** What a computer found of each agent: a column per agent, side by side; a narrow card stacks them. */
function Agents({ d, here, pending, onConnect }: {
  d: Device;
  /** This computer, in its own desktop app: its agents can be connected from here. */
  here: boolean;
  pending: boolean; onConnect: (agent: AgentId) => void;
}) {
  if (!d.checkedAt) {
    return (
      <p className="border-t border-line px-4 py-3 text-[12.5px] text-mut2 max-md:px-3.5">
        {here ? "Looking for Claude Code and Codex…" : "It hasn't looked for Claude Code and Codex yet."}
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 border-t border-line @max-xl:grid-cols-1">
      {AGENTS.map((a, i) => (
        <AgentColumn key={a} agent={a} t={d.agents[a]} first={i === 0} pending={pending} onConnect={onConnect}
          // Connecting writes this computer's agent config, so only its own window offers it.
          connectable={here && d.agents[a].mcp !== "connected" && (!!d.agents[a].cli || !!d.agents[a].app || a === "codex")} />
      ))}
    </div>
  );
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function AgentColumn({ agent, t, first, connectable, pending, onConnect }: {
  agent: AgentId; t: AgentTools; first: boolean; connectable: boolean; pending: boolean; onConnect: (agent: AgentId) => void;
}) {
  const x = t.extras;
  const cloud = CLOUD_LABEL[agent];
  const signIn = t.login.state === "in"
    ? [methodName(t.login.method), planName(t.login.plan)].filter(Boolean).join(" · ") || "Signed in"
    : t.login.state === "out" ? "Signed out" : null;
  // Plugins, skills and hooks as counts; their names are in the tooltips.
  const more = x ? [
    x.plugins.length ? { text: count(x.plugins.length, "plugin"), title: x.plugins.join(", ") } : null,
    x.skills ? { text: count(x.skills, "skill"), title: undefined } : null,
    x.hooks.length ? { text: count(x.hooks.length, "hook"), title: `On ${x.hooks.join(", ")}` } : null,
  ].filter((m) => m !== null) : [];

  return (
    <div className={cx("flex min-w-0 flex-col gap-3 px-4 py-3.5 max-md:px-3.5", !first && "border-l border-line @max-xl:border-l-0 @max-xl:border-t")}>
      <div className="flex min-h-6 min-w-0 items-center gap-2">
        <AgentIcon agent={agent} size={15} className="shrink-0 text-fg2" />
        <h4 className="shrink-0 text-[13px] font-medium text-strong">{AGENT_LABEL[agent]}</h4>
        <span className="flex-1" />
        {signIn && (
          <span title={`Its CLI: ${t.login.state === "in" ? "signed in" : "signed out"}`}
            className={cx("min-w-0 truncate text-[12px]", t.login.state === "in" ? "text-mut" : "text-dim")}>{signIn}</span>
        )}
      </div>

      {!t.cli && !t.app ? <p className="text-[12.5px] text-dim">Not installed</p> : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip icon="terminal" on={!!t.cli} title={t.cli ? `CLI ${t.cli.version}` : "No CLI"}>CLI</Chip>
            <Chip icon="appWindow" on={!!t.app} title={t.app ? `${APP_LABEL[agent]}${t.app.version ? ` ${t.app.version}` : ""}` : `No ${APP_LABEL[agent]}`}>App</Chip>
            <Chip icon="cloud" on={!!t.cli && t.login.state !== "out"}
              title={!t.cli ? `${cloud} sessions start from the ${AGENT_LABEL[agent]} CLI` : t.login.state === "out" ? `Sign the CLI in to send sessions to ${cloud}` : `Sessions can go to ${cloud}`}>
              Cloud
            </Chip>
            <Chip icon="plug" on={mcpReaches(t.mcp)} title={MCP_HINT[t.mcp]}>
              {t.mcp === "connected" ? "PacedMind" : `PacedMind: ${MCP_TEXT[t.mcp].toLowerCase()}`}
            </Chip>
            {connectable && (
              <Button size="sm" disabled={pending} onClick={() => onConnect(agent)}
                title={agent === "claude"
                  ? "Adds PacedMind's MCP server to Claude Code for all projects, with your token, so the Claude app's sessions can report back"
                  : "Adds PacedMind's MCP server to ~/.codex/config.toml (kept as config.toml.pacedmind-backup), so the Codex app's sessions can report back"}>
                Connect
              </Button>
            )}
          </div>

          {x && <Tools label="MCP servers" names={x.mcp}
            title="Read from its own settings on that computer. A project's folder can add more: see Settings → Projects." />}
          {x?.account?.length ? (
            <Tools label={agent === "claude" ? "claude.ai connectors" : "Connectors"} names={x.account}
              title="From the account its CLI is signed in to, as the last session PacedMind started there said." />
          ) : null}
          {more.length > 0 && (
            <p className="text-[12px] text-mut2">
              {more.map((m, i) => <span key={m.text} title={m.title}>{i > 0 && <span aria-hidden className="text-faint"> · </span>}{m.text}</span>)}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** A thing an agent has there or not: gray when it has it, dashed and dim when it doesn't. */
function Chip({ icon, on, title, children }: { icon: IconName; on: boolean; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={cx("inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border px-2 text-[12px]",
      on ? "border-line2 text-fg2" : "border-dashed border-line2 text-dim")}>
      <Icon name={icon} size={12} className="shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** MCP servers or connectors, one per line with its brand's mark. */
function Tools({ label, names, title }: { label: string; names: string[]; title: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span title={title} className="pb-0.5 text-[11.5px] text-mut2">
        {label}{names.length > 0 && <span className="text-dim"> {names.length}</span>}
      </span>
      {names.length ? names.map((n) => (
        <span key={n} className="flex h-7 min-w-0 items-center gap-2 text-[12.5px] text-fg2">
          <ToolIcon name={n} size={14} className="text-fg3" />
          <span className="truncate">{n.replace(/^claude[._ ]?ai[ _]/i, "")}</span>
        </span>
      )) : <span className="text-[12.5px] text-dim">None</span>}
    </div>
  );
}
