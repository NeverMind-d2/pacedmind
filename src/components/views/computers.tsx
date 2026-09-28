"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { checkDeviceAction, connectAgentAction, renameDeviceAction, setDefaultDeviceAction } from "@/app/actions";
import { revokeDeviceAction } from "@/app/auth/actions";
import { parseLocal, toDateStr } from "@/lib/dates";
import {
  AGENT_LABEL, APP_LABEL, CLOUD_LABEL, deviceOnline, mcpReaches, platformName,
  type AgentId, type AgentTools, type Device, type RemoteStart, type ReportOutcome, type SessionStatus, type Surface,
} from "@/lib/types";
import { ConfirmDialog } from "../dialog";
import { InlineName } from "../entity-menu";
import { AgentIcon, Icon, SurfaceIcon } from "../icons";
import { Button, Dot, cx, useAction } from "../ui";
import { ViewHeader } from "./calendar-parts";

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

const REMOTE_LABEL: Record<RemoteStart, string> = { off: "Refuse", ask: "Ask me", auto: "Start" };
const REMOTE_HINT: Record<RemoteStart, string> = {
  off: "Sessions asked for from the web app or another computer are refused there.",
  ask: "Sessions asked for from the web app or another computer wait there until you allow them.",
  auto: "Sessions asked for from the web app or another computer start there right away (asking takes a fresh two-factor code).",
};

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

/** One fact about an agent on a computer: what to show, whether it's there (grayscale), and what explains it. */
type Fact = { main: string; sub?: string | null; on: boolean; title?: string };

function facts(agent: AgentId, t: AgentTools): Record<"cli" | "app" | "cloud" | "mcp" | "login", Fact> {
  const cloud = CLOUD_LABEL[agent];
  return {
    cli: t.cli ? { main: t.cli.version, on: true } : { main: "Not installed", on: false },
    app: t.app ? { main: t.app.version ?? "Installed", on: true } : { main: "Not installed", on: false },
    // Both clouds take sessions from the agent's CLI (claude --cloud, codex cloud exec), signed in to the account there.
    cloud: !t.cli
      ? { main: "Needs the CLI", sub: cloud, on: false, title: `${cloud} sessions start from the ${AGENT_LABEL[agent]} CLI` }
      : t.login.state === "out"
        ? { main: "CLI signed out", sub: cloud, on: false, title: `Sign the ${AGENT_LABEL[agent]} CLI in there to send sessions to ${cloud}` }
        : { main: t.login.state === "in" ? "Ready" : "Available", sub: cloud, on: true,
          title: t.login.state === "in" ? undefined : `Starts from the ${AGENT_LABEL[agent]} CLI; it didn't say whether it's signed in` },
    mcp: { main: MCP_TEXT[t.mcp], on: mcpReaches(t.mcp), title: MCP_HINT[t.mcp] },
    login: t.login.state === "in"
      ? { main: "Signed in", sub: [methodName(t.login.method), planName(t.login.plan)].filter(Boolean).join(" · ") || null, on: true }
      : t.login.state === "out"
        ? { main: "Signed out", on: false }
        : { main: t.cli ? "Unknown" : "—", on: false, title: t.cli ? "The CLI didn't say" : "No CLI to ask" },
  };
}

const ROWS: { id: keyof ReturnType<typeof facts>; label: string }[] = [
  { id: "cli", label: "CLI" }, { id: "app", label: "Desktop app" }, { id: "cloud", label: "Cloud" }, { id: "mcp", label: "MCP" }, { id: "login", label: "Sign-in" },
];

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
    <section aria-label="Computers" className="flex min-w-0 flex-1 flex-col">
      <ViewHeader icon="laptop" title="Computers" subtitle={subtitle} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="@container mx-auto flex max-w-[920px] flex-col gap-5 px-10 py-8 max-md:gap-4 max-md:px-4 max-md:py-5">
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

          {account && devices.length > 0 && (
            <p className="text-[12px] leading-relaxed text-mut2">
              What runs on a computer is decided there: its agent commands, folders, flow switches and whether it takes sessions from
              elsewhere are set in its desktop app. A computer is online when it checked in during the last two minutes; what it has of
              the agents, it looks for when it starts and every half hour.
            </p>
          )}
        </div>
      </div>

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

function Computer({ d, here, desktop, account, online, now, flows, sessions, renaming, pending, onRename, onRenamed, onSave, onDefault, onCheck, onConnect, onSignOut }: {
  d: Device; here: boolean;
  /** Seen in the desktop app (which has a computer of its own), not the web app. */
  desktop: boolean;
  account: boolean; online: boolean; now: number;
  flows: FlowProject[]; sessions: ComputerSession[];
  renaming: boolean; pending: boolean;
  onRename: () => void; onRenamed: () => void; onSave: (name: string) => void;
  onDefault: () => void; onCheck: () => void; onConnect: (agent: AgentId) => void; onSignOut: () => void;
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
                  <h2 className="min-w-0 truncate text-[14px] font-semibold text-strong">{d.name}</h2>
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
              {account && <RemoteBadge value={d.remoteStart} editable={here && desktop} />}
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

      <Agents d={d} here={here && desktop} pending={pending} now={now} onConnect={onConnect} />

      <div className="flex flex-col gap-3 border-t border-line px-4 py-3.5 max-md:px-3.5">
        <Line label="Flows on" title="Projects whose flow may start sessions by itself on this computer. Each computer switches its own.">
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
            <p className="flex min-h-8 items-center text-[12.5px] text-mut2 @max-xl:min-h-0">{here && desktop ? "None here. Switch a project's flow on in Flows." : "None"}</p>
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

/** What the computer does with sessions asked for from elsewhere. It decides that itself, so only its own window changes it. */
function RemoteBadge({ value, editable }: { value: RemoteStart; editable: boolean }) {
  const text = <>From elsewhere: <span className="text-fg3">{REMOTE_LABEL[value]}</span></>;
  const box = "inline-flex h-5 items-center gap-1 rounded border border-line2 px-1.5 text-[11px] text-mut";
  if (!editable) return <span title={`${REMOTE_HINT[value]} It's set in the desktop app on that computer.`} className={box}>{text}</span>;
  return (
    <Link href="/settings/computer" title={`${REMOTE_HINT[value]} Change it in Settings.`} className={cx(box, "hover:bg-hover hover:text-fg2")}>
      {text}<Icon name="chevronRight" size={10} strokeWidth={2.4} />
    </Link>
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

/**
 * What a computer found of each agent. Wide: one row per agent. Narrow (a phone): one row per fact, with the two agents
 * side by side, so a card stays short.
 */
function Agents({ d, here, pending, now, onConnect }: {
  d: Device;
  /** This computer, in its own desktop app: its agents can be connected from here. */
  here: boolean;
  pending: boolean; now: number; onConnect: (agent: AgentId) => void;
}) {
  const heading = (
    <div className="flex min-h-5 flex-wrap items-baseline gap-x-2 text-[12px]">
      <span className="font-medium text-fg3">Claude Code and Codex</span>
      {d.checkedAt && <span className="text-mut2" suppressHydrationWarning>as of {ago(d.checkedAt, now)}</span>}
    </div>
  );
  if (!d.checkedAt) {
    return (
      <div className="flex flex-col gap-1 border-t border-line px-4 py-3 max-md:px-3.5">
        {heading}
        <p className="text-[12.5px] text-mut2">{here ? "Looking for Claude Code and Codex…" : "It hasn't looked for Claude Code and Codex yet."}</p>
      </div>
    );
  }
  const of = { claude: facts("claude", d.agents.claude), codex: facts("codex", d.agents.codex) };
  // Connecting writes this computer's agent config, so only its own window offers it.
  const connect = (agent: AgentId) => {
    const t = d.agents[agent];
    return here && t.mcp !== "connected" && (t.cli || t.app || agent === "codex") ? (
      <Button size="sm" disabled={pending} onClick={() => onConnect(agent)} className="mt-1 self-start"
        title={agent === "claude"
          ? "Adds PacedMind's MCP server to Claude Code for all projects, with your token, so the Claude app's sessions can report back"
          : "Adds PacedMind's MCP server to ~/.codex/config.toml (kept as config.toml.pacedmind-backup), so the Codex app's sessions can report back"}>
        Connect
      </Button>
    ) : null;
  };
  const grid = "grid grid-cols-[132px_repeat(5,minmax(0,1fr))] gap-x-3";
  return (
    <div className="border-t border-line">
      <div className="px-4 pt-3 max-md:px-3.5">{heading}</div>

      {/* Wide: an agent per row. */}
      <div className="hidden px-4 pb-1.5 @2xl:block">
        <div aria-hidden className={cx(grid, "h-8 items-center text-[11.5px] text-mut2")}>
          <span>Agent</span>
          {ROWS.map((r) => <span key={r.id}>{r.label}</span>)}
        </div>
        {AGENTS.map((a) => (
          <div key={a} className={cx(grid, "items-start border-t border-line py-2.5 text-[12.5px]")}>
            <span className="flex items-center gap-2 text-fg2">
              <AgentIcon agent={a} size={14} className="text-fg3" />{AGENT_LABEL[a]}
            </span>
            {ROWS.map((r) => (
              <span key={r.id} className="flex min-w-0 flex-col">
                <span className="sr-only">{r.label}: </span>
                <Value f={of[a][r.id]} />
                {r.id === "mcp" && connect(a)}
              </span>
            ))}
          </div>
        ))}
      </div>

      {/* Narrow: a fact per row, the agents side by side. */}
      <div className="px-4 pb-2 @2xl:hidden max-md:px-3.5">
        <div className="grid grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 border-b border-line py-2 text-[12.5px]">
          <span />
          {AGENTS.map((a) => (
            <span key={a} className="flex min-w-0 items-center gap-1.5 text-fg2">
              <AgentIcon agent={a} size={13} className="text-fg3" /><span className="truncate">{AGENT_LABEL[a]}</span>
            </span>
          ))}
        </div>
        {ROWS.map((r) => (
          <div key={r.id} className="grid grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)] items-start gap-x-3 border-b border-line py-2 text-[12.5px] last:border-b-0">
            <span className="text-[12px] text-mut2">{r.label}</span>
            {AGENTS.map((a) => (
              <span key={a} className="flex min-w-0 flex-col">
                <span className="sr-only">{AGENT_LABEL[a]}: </span>
                <Value f={of[a][r.id]} />
                {r.id === "mcp" && connect(a)}
              </span>
            ))}
          </div>
        ))}
      </div>
      <Extras d={d} />
    </div>
  );
}

/**
 * What each agent's sessions get on that computer besides PacedMind, by name, as its config files say (extras.ts),
 * and what its sessions there got from the account its CLI is signed in to, as the last one said: each computer's CLI
 * can be signed in to another account, with other connectors.
 */
function Extras({ d }: { d: Device }) {
  const lines = AGENTS.flatMap((a) => {
    const t = d.agents[a];
    const h = t.extras;
    if (!h || (!t.cli && !t.app)) return [];
    const parts = [
      h.mcp.length ? `MCP servers ${h.mcp.join(", ")}` : "no other MCP servers",
      h.account?.length ? `${a === "claude" ? "claude.ai connectors" : "connectors from its account"} ${h.account.join(", ")}` : null,
      h.plugins.length ? `plugins ${h.plugins.join(", ")}` : null,
      h.skills ? `${h.skills} ${h.skills === 1 ? "skill" : "skills"}` : null,
      h.hooks.length ? `hooks on ${h.hooks.join(", ")}` : null,
    ].filter(Boolean);
    return [{ a, text: parts.join(" · ") }];
  });
  if (!lines.length) return null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-line px-4 py-2.5 text-[12.5px] max-md:px-3.5"
      title="Read from Claude Code's and Codex's own settings on that computer; what comes from the account its CLI is signed in to, as the last session PacedMind started there said. A project's folder can add more: see Settings.">
      <span className="text-[12px] text-mut2">Besides PacedMind, their sessions also get</span>
      {lines.map(({ a, text }) => (
        <div key={a} className="flex items-start gap-2">
          <AgentIcon agent={a} size={13} className="mt-[3px] shrink-0 text-fg3" />
          <span className="min-w-0 break-words text-fg2">{text}</span>
        </div>
      ))}
    </div>
  );
}

function Value({ f }: { f: Fact }) {
  return (
    <span title={f.title} className="flex min-w-0 flex-col">
      <span className={cx("break-words", f.on ? "text-fg2" : "text-dim")}>{f.main}</span>
      {f.sub && <span className="break-words text-[11.5px] leading-snug text-mut2">{f.sub}</span>}
    </span>
  );
}
