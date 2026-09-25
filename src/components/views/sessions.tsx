"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { closeSessionAction, finishSessionAction, markSessionDoneAction, requestChangesAction, resumeSessionAction } from "@/app/actions";
import { startSessionOrAsk } from "@/components/remote-start";
import { AgentIcon, Icon, SurfaceIcon } from "@/components/icons";
import { Gallery, RequestChangesForm, SessionReport } from "@/components/report";
import { Button, Menu, cx, useAction } from "@/components/ui";
import { parseLocal, toDateStr, waitingInTerminal } from "@/lib/dates";
import {
  AGENT_LABEL, APP_LABEL, CLOUD_LABEL, type AgentId, type Attachment, type Report, type SessionEvent, type SessionStatus, type Surface,
} from "@/lib/types";

/* ---------- data from the server ---------- */

export interface SessionItem {
  id: string;
  status: SessionStatus;
  agent: AgentId;
  /** Where it runs: a terminal or the desktop app on `device`, or the agent's cloud. */
  surface: Surface;
  device: string | null;
  /** Where to follow it, e.g. its Codex cloud task. */
  url: string | null;
  folder: string | null;
  branch: string | null;
  startedAt: string;
  finishedAt: string | null;
  endedAt: string | null;
  /** When it stopped needing anything (marked done, closed, failed); null while running or waiting. */
  endAt: string | null;
  note: string | null;
  cliSessionId: string | null;
  origin: "organizer" | "outside" | "continued";
  /** The session whose terminal this one carries on ("same session" connections). */
  continues: { id: string; key: string } | null;
  task: { id: number; key: string; title: string } | null;
  project: { id: string; name: string } | null;
  /** Where the task opens in the app. */
  href: string | null;
  events: SessionEvent[];
  /** What the agent handed back, newest first. A resumed session can hand back more than once. */
  reports: Report[];
  /** Images attached while it works, before it hands the task back. */
  pending: Attachment[];
  /** Whether its agent can take changes from here now (changesProblem on the server). */
  canRequestChanges: boolean;
  /** The next task in the flow after this one. */
  next: { id: number; key: string; title: string; href: string; canStart: boolean } | null;
}

export interface SessionGroup {
  id: "finished" | "running" | "today" | "earlier";
  name: string;
  items: SessionItem[];
}

export interface StartableTask {
  id: number;
  key: string;
  title: string;
  agent: AgentId;
}

/* ---------- helpers ---------- */

const ACCENT = "var(--color-accent)";
const DOT: Record<SessionStatus, { fill: string; ring: string }> = {
  finished: { fill: ACCENT, ring: ACCENT },
  starting: { fill: "var(--color-fg3)", ring: "var(--color-fg3)" },
  running: { fill: "var(--color-fg3)", ring: "var(--color-fg3)" },
  done: { fill: "var(--color-faint)", ring: "var(--color-faint)" },
  closed: { fill: "transparent", ring: "var(--color-dim)" },
  failed: { fill: "transparent", ring: "var(--color-dim)" },
};

const isActive = (s: SessionItem) => s.status === "starting" || s.status === "running";
const agentShort = (a: AgentId) => (a === "claude" ? "Claude" : "Codex");
const sameDay = (a: Date, b: Date) => toDateStr(a) === toDateStr(b);
const dayBefore = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
const ms = (stamp: string) => parseLocal(stamp).getTime();

/** "12:22", "yesterday 12:22" or "Mon 21 Sep" (short, for list rows). */
function clock(stamp: string, now: number): string {
  const d = parseLocal(stamp);
  const today = new Date(now);
  if (sameDay(d, today)) return format(d, "HH:mm");
  if (sameDay(d, dayBefore(today))) return `yesterday ${format(d, "HH:mm")}`;
  return format(d, "EEE d MMM");
}

/** "12:22" today, otherwise with the day: "Mon 21 Sep, 12:22". */
function clockLong(stamp: string, now: number): string {
  const d = parseLocal(stamp);
  return sameDay(d, new Date(now)) ? format(d, "HH:mm") : format(d, "EEE d MMM, HH:mm");
}

function duration(span: number): string {
  const m = Math.max(0, Math.round(span / 60_000));
  if (m < 1) return "under a minute";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** A session on a device whose agent hasn't checked in: waiting in its terminal, or for you to send it in the app. */
const unheard = (s: SessionItem, now: number) => s.surface !== "cloud" && waitingInTerminal(s, s.events, new Date(now));

/** "a terminal on mikolaj_pc", "the Claude app on mikolaj_pc" or "Claude Code on the web". */
function place(s: SessionItem): string {
  if (s.surface === "cloud") return CLOUD_LABEL[s.agent];
  const on = s.device ? ` on ${s.device}` : "";
  return s.surface === "desktop" ? `the ${APP_LABEL[s.agent]}${on}` : `a terminal${on}`;
}

/** "Terminal on mikolaj_pc", "Claude app on mikolaj_pc" or "Claude Code on the web". */
function placeTitle(s: SessionItem): string {
  if (s.surface === "cloud") return CLOUD_LABEL[s.agent];
  return `${s.surface === "desktop" ? APP_LABEL[s.agent] : "Terminal"}${s.device ? ` on ${s.device}` : ""}`;
}

function meta(s: SessionItem, now: number): string {
  switch (s.status) {
    case "finished": {
      const outcome = s.reports[0]?.outcome;
      return `${outcome === "blocked" ? "stuck" : outcome === "partial" ? "partly done" : "finished"} ${clock(s.finishedAt ?? s.startedAt, now)}`;
    }
    case "starting":
    case "running": {
      if (unheard(s, now)) return s.surface === "desktop" ? `waiting in the ${APP_LABEL[s.agent]}` : "waiting in its terminal";
      const asked = s.reports[0]?.changes ? s.reports[0].changesAt : null;
      if (asked) return `changes since ${clock(asked, now)}`;
      return `${s.surface === "cloud" ? "in the cloud " : ""}since ${clock(s.startedAt, now)}`;
    }
    case "done":
      return `done ${clock(s.endAt ?? s.startedAt, now)}`;
    case "closed":
      return "closed before finishing";
    default:
      return "couldn't start";
  }
}

function headline(s: SessionItem, now: number): string {
  const who = AGENT_LABEL[s.agent];
  if (unheard(s, now)) {
    return s.surface === "desktop"
      ? `Opened in the ${APP_LABEL[s.agent]}. Send the first message there to start.`
      : `${who} hasn't checked in yet. It may be waiting for you in its terminal.`;
  }
  switch (s.status) {
    case "starting":
      return s.surface === "cloud" ? `Sending to ${CLOUD_LABEL[s.agent]} since ${clockLong(s.startedAt, now)}` : `Starting ${who} since ${clockLong(s.startedAt, now)}`;
    case "running": {
      const asked = s.reports[0]?.changes ? s.reports[0].changesAt : null;
      if (asked) return `${who} is working on your changes since ${clockLong(asked, now)}`;
      return s.surface === "terminal" ? `Running in ${who} since ${clockLong(s.startedAt, now)}` : `Running in ${place(s)} since ${clockLong(s.startedAt, now)}`;
    }
    case "finished": {
      const at = clockLong(s.finishedAt ?? s.startedAt, now);
      const outcome = s.reports[0]?.outcome;
      if (outcome === "blocked") return `${who} got stuck at ${at} · needs you`;
      if (outcome === "partial") return `${who} handed back part of it at ${at} · waiting for you`;
      return `${who} finished at ${at} · waiting for you`;
    }
    case "done":
      return s.finishedAt ? `Done · ${who} finished at ${clockLong(s.finishedAt, now)}` : "Done";
    case "closed":
      return "Closed before the agent finished";
    default:
      return `Couldn't start: ${s.note ?? "unknown error"}`;
  }
}

/** How long the agent worked: until now while it runs, else until it finished or its terminal closed. */
function workedFor(s: SessionItem, now: number): string | null {
  if (s.status === "failed") return null;
  const end = isActive(s) ? now : s.finishedAt ?? s.endedAt ?? s.endAt;
  if (end === null) return null;
  return duration((typeof end === "number" ? end : ms(end)) - ms(s.startedAt));
}

function eventText(e: SessionEvent, agent: AgentId): string {
  if (e.kind === "finished") return `${agentShort(agent)} marked it finished`;
  return e.text || e.kind;
}

/** Current time, starting from the server's clock (no hydration mismatch) and ticking every 30 s. */
function useNow(initial: string): number {
  const [now, setNow] = useState(() => parseLocal(initial).getTime());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/* ---------- the view ---------- */

export function SessionsView({ groups, initialId, startable, now: serverNow }: {
  groups: SessionGroup[];
  initialId: string | null;
  startable: StartableTask[];
  now: string;
}) {
  const now = useNow(serverNow);
  const params = useSearchParams();
  const { run, pending } = useAction();
  const all = groups.flatMap((g) => g.items);
  // The selection lives in the URL (?s=), so links from tasks open the right session and refreshes keep it.
  const fromUrl = params.get("s");
  const sel = fromUrl && all.some((s) => s.id === fromUrl) ? fromUrl : initialId;
  const selected = all.find((s) => s.id === sel) ?? null;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => ({
    earlier: !groups.find((g) => g.id === "earlier")?.items.some((s) => s.id === initialId),
  }));
  const select = (id: string) => window.history.replaceState(null, "", `?s=${id}`);
  // On a phone the details cover the list, so they open only for a session you chose (or a link named), not
  // for the one picked for you; closing them goes back to the list.
  const chosen = !!fromUrl && fromUrl === sel;
  const backToList = () => window.history.replaceState(null, "", window.location.pathname);

  return (
    <div className="flex min-w-0 flex-1">
      <section aria-label="Sessions" className="@container flex min-w-0 flex-1 flex-col">
        <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line pl-5 pr-4">
          <Icon name="terminal" className="shrink-0 text-mut" />
          <h1 className="text-[14px] font-semibold text-strong">Sessions</h1>
          <span className="min-w-0 truncate text-mut2">Claude Code and Codex sessions started from PacedMind</span>
          <span className="flex-1" />
          {startable.length > 0 && (
            <Menu align="right" width={340}
              trigger={<Button disabled={pending}><Icon name="plus" size={13} />Start session</Button>}
              items={startable.map((t) => ({
                value: t.id,
                label: <><span className="mr-2 font-mono text-[11px] text-mut2">{t.key}</span>{t.title}</>,
                hint: agentShort(t.agent),
              }))}
              onSelect={(id) => run(() => startSessionOrAsk(id))} />
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.id}>
              <GroupHeader name={g.name} count={g.items.length} collapsed={!!collapsed[g.id]}
                onToggle={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))} />
              {!collapsed[g.id] && g.items.map((s) => (
                <Row key={s.id} s={s} now={now} selected={s.id === sel} onSelect={() => select(s.id)} />
              ))}
            </div>
          ))}
          {!all.length && (
            <div className="flex flex-col items-center gap-3 px-8 py-24 text-center">
              <div className="text-[14px] text-fg2">No sessions yet</div>
              <div className="max-w-sm text-[12.5px] leading-relaxed text-mut2">
                Sessions appear here when you start one from a task. Open a task and choose Start with Claude Code or Codex,
                or switch on a project&apos;s flow to have them start one after another.
              </div>
            </div>
          )}
        </div>
      </section>
      {selected && <Detail key={selected.id} s={selected} now={now} onSelect={select} chosen={chosen} onClose={backToList} />}
    </div>
  );
}

function GroupHeader({ name, count, collapsed, onToggle }: { name: string; count: number; collapsed: boolean; onToggle: () => void }) {
  return (
    <div className="flex h-[34px] items-center gap-2 border-b border-line bg-raised pl-5 pr-4 text-[12.5px] font-medium text-fg2">
      <button type="button" onClick={onToggle} className="flex items-center gap-2" aria-expanded={!collapsed}>
        <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={12} strokeWidth={2.4} className="text-mut2" />
        <span>{name}</span>
        <span className="font-normal text-mut2">{count}</span>
      </button>
    </div>
  );
}

function StateDot({ status }: { status: SessionStatus }) {
  const d = DOT[status];
  return <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full border" style={{ background: d.fill, borderColor: d.ring }} />;
}

function Row({ s, now, selected, onSelect }: { s: SessionItem; now: number; selected: boolean; onSelect: () => void }) {
  const live = s.status === "finished" || isActive(s);
  const images = (s.reports[0]?.images.length ?? 0) + s.pending.length;
  return (
    <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined}
      className={cx("flex h-[42px] w-full items-center gap-3 border-b border-hover px-5 text-left", selected ? "bg-sel" : "hover:bg-hover")}>
      <span className="flex w-3.5 shrink-0 justify-center"><StateDot status={s.status} /></span>
      <span className="w-[50px] shrink-0 font-mono text-[11.5px] text-mut2 @max-md:hidden">{s.task?.key ?? "—"}</span>
      <span className={cx("min-w-0 flex-1 truncate", live ? "text-fg" : "text-mut2")}>{s.task?.title ?? "Deleted task"}</span>
      <span className="hidden w-[110px] shrink-0 truncate text-[12px] text-mut2 @xl:block">{s.project?.name ?? "No project"}</span>
      <span title={`${AGENT_LABEL[s.agent]} in ${place(s)}`} className="hidden w-[110px] shrink-0 items-center gap-1.5 text-[12px] text-mut2 @2xl:flex">
        <AgentIcon agent={s.agent} size={12} className="text-mut" />{AGENT_LABEL[s.agent]}
        <SurfaceIcon surface={s.surface} size={11} className="text-dim" />
      </span>
      <span title={images ? `${images} image${images === 1 ? "" : "s"}` : undefined} className="flex w-9 shrink-0 items-center gap-1 text-[11.5px] text-mut2 @max-md:w-auto">
        {images > 0 && <><Icon name="image" size={13} />{images}</>}
      </span>
      <span className={cx("w-[150px] shrink-0 truncate text-right text-[12px] @max-md:w-[108px]", s.status === "finished" ? "text-fg2" : "text-mut2")}>
        {meta(s, now)}
      </span>
    </button>
  );
}

function Detail({ s, now, onSelect, chosen, onClose }: {
  s: SessionItem; now: number; onSelect: (id: string) => void; chosen: boolean; onClose: () => void;
}) {
  const { run, pending } = useAction();
  const active = isActive(s);
  const [viewing, setViewing] = useState(0);
  const report = s.reports[Math.min(viewing, s.reports.length - 1)] ?? null;
  const [asking, setAsking] = useState(false);
  // Only where the server would take them: a terminal on this computer, the task's latest report, not your own task.
  const canAsk = s.canRequestChanges;
  const worked = workedFor(s, now);
  const allToday = s.events.every((e) => sameDay(parseLocal(e.at), new Date(now)));
  const started = `${clockLong(s.startedAt, now)} ${
    s.origin === "outside" ? "outside PacedMind" : s.origin === "continued" ? "in the same session" : "from PacedMind"
  }`;
  const props: [string, ReactNode, boolean][] = [
    ["Agent", <span key="a" className="flex items-center gap-1.5"><AgentIcon agent={s.agent} size={12} className="text-fg3" />{AGENT_LABEL[s.agent]}</span>, false],
    ["Runs in", <span key="r" className="flex items-center gap-1.5"><SurfaceIcon surface={s.surface} size={12} className="text-mut" />{placeTitle(s)}</span>, false],
    ["Folder", s.folder ?? "—", true],
    ["Branch", s.branch ?? "—", true],
    ["Started", started, false],
  ];
  if (worked) props.push(["Duration", worked, false]);
  props.push(["Session", s.id, true]);
  if (s.cliSessionId) props.push(["Claude session", s.cliSessionId, true]);

  return (
    <aside aria-label="Session details" className={cx("flex w-[420px] shrink-0 flex-col border-l border-line",
      "max-md:fixed max-md:inset-0 max-md:z-30 max-md:w-auto max-md:border-l-0 max-md:bg-panel", !chosen && "max-md:hidden")}>
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line pl-6 pr-4 text-[12.5px] text-mut max-md:pl-5 max-md:pr-3">
        <span className="truncate">{s.project?.name ?? "No project"}</span>
        <span className="text-faint">›</span>
        <span className="font-mono text-[11.5px] text-mut2">{s.task?.key}</span>
        <span className="flex-1" />
        {s.href && (
          <Link href={s.href} className="inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-fg3 hover:bg-hover">Open task</Link>
        )}
        <button type="button" aria-label="Back to sessions" onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-mut hover:bg-hover hover:text-fg2 md:hidden">
          <Icon name="x" size={15} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-[22px]">
        <div className="flex flex-col gap-2.5">
          <h2 className="text-[20px] font-semibold leading-snug tracking-[-0.01em] text-strong">{s.task?.title ?? "Deleted task"}</h2>
          <div className="flex items-center gap-2 text-[12.5px] text-fg2">
            <StateDot status={s.status} />
            <span className="min-w-0 flex-1">{headline(s, now)}</span>
            {s.reports.length > 1 && (
              <span className="flex shrink-0 items-center gap-0.5 text-[11.5px] text-mut2">
                <button type="button" aria-label="Older report" disabled={viewing >= s.reports.length - 1} onClick={() => setViewing((v) => v + 1)}
                  className="flex h-5 w-5 items-center justify-center rounded hover:bg-hover disabled:opacity-30">
                  <Icon name="chevronLeft" size={12} strokeWidth={2.2} />
                </button>
                <span className="tabular-nums">Report {s.reports.length - viewing} of {s.reports.length}</span>
                <button type="button" aria-label="Newer report" disabled={viewing === 0} onClick={() => setViewing((v) => v - 1)}
                  className="flex h-5 w-5 items-center justify-center rounded hover:bg-hover disabled:opacity-30">
                  <Icon name="chevronRight" size={12} strokeWidth={2.2} />
                </button>
              </span>
            )}
          </div>
          {!report && s.note && s.status !== "failed" && <p className="text-[13px] leading-[1.6] text-mut">“{s.note}”</p>}
        </div>

        {report && <SessionReport key={report.id} report={report} criteria={report.criteria} working={active} />}

        {s.pending.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[12px] font-medium text-fg3">Images so far</div>
            <Gallery images={s.pending} />
          </div>
        )}

        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-2 gap-y-2.5 text-[12.5px]">
          {props.map(([label, value, mono]) => (
            <Fragment key={label}>
              <dt className="text-mut2">{label}</dt>
              <dd title={typeof value === "string" ? value : undefined}
                className={cx("truncate text-fg2", mono && "font-mono text-[11.5px] leading-[19px]")}>{value}</dd>
            </Fragment>
          ))}
          {s.continues && (
            <>
              <dt className="text-mut2">Continues</dt>
              <dd className="truncate">
                <button type="button" onClick={() => onSelect(s.continues!.id)} className="text-fg2 hover:text-strong">
                  <span className="font-mono text-[11.5px]">{s.continues.key}</span>&apos;s session
                </button>
              </dd>
            </>
          )}
        </dl>

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <div className="text-[12.5px] text-fg2">What PacedMind heard</div>
          {s.events.length ? s.events.map((e) => (
            <div key={e.id} className="flex items-baseline gap-3 text-[12.5px]">
              <span className={cx("shrink-0 font-mono text-[11px] text-dim", allToday ? "w-[38px]" : "w-[92px]")}>
                {format(parseLocal(e.at), allToday ? "HH:mm" : "d MMM HH:mm")}
              </span>
              <span className="text-mut">{eventText(e, s.agent)}</span>
            </div>
          )) : <p className="text-[12.5px] text-mut2">Nothing yet.</p>}
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-3 border-t border-line pb-4 pl-6 pr-4 pt-3.5">
        {asking && canAsk && (
          <RequestChangesForm agent={s.agent} resumes={s.agent === "claude" && !!s.cliSessionId} pending={pending}
            onCancel={() => setAsking(false)}
            onSend={(changes) => run(async () => {
              const r = await requestChangesAction(s.id, changes);
              if (r.ok) setAsking(false);
              return r;
            })} />
        )}
        <div className={cx("flex flex-wrap items-center gap-2", asking && canAsk && "hidden")}>
          {!active && s.status !== "failed" && s.surface === "terminal" && (
            <Button disabled={pending} onClick={() => run(() => resumeSessionAction(s.id))}>
              <Icon name="terminal" size={13} strokeWidth={2} />Resume in terminal
            </Button>
          )}
          {s.surface === "terminal" && s.agent === "claude" && s.cliSessionId && s.status !== "failed" && (
            <Button disabled={pending} title="Moves this Claude Code conversation into the Claude app" onClick={() => run(() => resumeSessionAction(s.id, "desktop"))}>
              <Icon name="appWindow" size={13} strokeWidth={2} />Continue in {APP_LABEL.claude}
            </Button>
          )}
          {s.surface === "desktop" && s.status !== "failed" && (
            <Button disabled={pending} onClick={() => run(() => resumeSessionAction(s.id))}>
              <Icon name="appWindow" size={13} strokeWidth={2} />Open the {APP_LABEL[s.agent]}
            </Button>
          )}
          {s.surface === "cloud" && s.url && (
            <a href={s.url} target="_blank" rel="noreferrer"
              className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-ctl px-2.5 text-[12.5px] text-fg2 hover:bg-hover">
              <Icon name="cloud" size={13} strokeWidth={2} />{s.url.includes("/tasks/") ? "Open the task" : `Open ${CLOUD_LABEL[s.agent]}`}
            </a>
          )}
          {s.surface === "cloud" && s.agent === "claude" && s.status !== "failed" && (
            <Button disabled={pending} title="Pulls the cloud session and its branch into a terminal (claude --teleport)" onClick={() => run(() => resumeSessionAction(s.id))}>
              <Icon name="terminal" size={13} strokeWidth={2} />Pull into terminal
            </Button>
          )}
          {active && s.surface !== "terminal" && (
            <Button disabled={pending} title="The session can't always tell PacedMind itself. The task waits for your check, and what comes next may start."
              onClick={() => run(() => finishSessionAction(s.id))}>
              <Icon name="check" size={13} strokeWidth={2.2} />Mark finished
            </Button>
          )}
          {canAsk && (
            <Button disabled={pending} onClick={() => setAsking(true)}>
              <Icon name="pen" size={13} strokeWidth={2} />Request changes
            </Button>
          )}
          {active && (
            <Button disabled={pending} onClick={() => confirm(`Close this session in PacedMind? ${s.surface === "terminal" ? "The terminal stays open." : "It keeps running where it is."}`) && run(() => closeSessionAction(s.id))}>
              Close session
            </Button>
          )}
          <span className="flex-1" />
          {s.status === "finished" && (
            <Button variant="primary" disabled={pending} onClick={() => run(() => markSessionDoneAction(s.id))}>Mark done</Button>
          )}
        </div>
        {s.next && (
          <div className="flex items-center gap-2 text-[12px] text-mut2">
            <span className="min-w-0 flex-1 truncate">
              Next in {s.project?.name ?? "the flow"}:{" "}
              <Link href={s.next.href} className="text-fg3 hover:text-strong">
                <span className="font-mono text-[11px]">{s.next.key}</span> {s.next.title}
              </Link>
            </span>
            {s.next.canStart && (
              <Button size="sm" disabled={pending} onClick={() => run(() => startSessionOrAsk(s.next!.id))}>Start session</Button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
