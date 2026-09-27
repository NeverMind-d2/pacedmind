"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { AREA, FLOW_LINE, Group, Icon, StatusIcon, type FlowMode, type IconName } from "../screens/parts";
import s from "../command-palette.module.css";

// What each command in the palette shows, drawn like the app with its sizes and color tokens, for the day the
// page tells. A result plays in each time it's shown (the palette mounts it again); with reduced motion it's still.

export type PaneId = "plan" | "waiting" | "terminal" | "app" | "cloud" | "flow" | "more";

/** The few icons the palette needs beyond the screens' own, from the app's icon set (src/components/icons.tsx). */
const GLYPHS = {
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.9 1.9 0 0 0 3.4 0",
  download: "M12 4v11 M7 10l5 5 5-5 M5 20h14",
  tag: "M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z M7.5 7.5h.01",
  pen: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  folder: "M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  branch: "M6 3v12 M18 9a3 3 0 1 0 0-6a3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6a3 3 0 0 0 0 6z M18 9a9 9 0 0 1-9 9",
  up: "M12 19V5 M6 11l6-6 6 6",
};
export type GlyphName = keyof typeof GLYPHS;

export function Sym({ name, size = 16, strokeWidth = 1.8, className = "" }: { name: IconName | GlyphName; size?: number; strokeWidth?: number; className?: string }) {
  if (!(name in GLYPHS)) return <Icon name={name as IconName} size={size} strokeWidth={strokeWidth} className={className} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>
      <path d={GLYPHS[name as GlyphName]} />
    </svg>
  );
}

/** Task keys never break at their hyphen; in the command list they're in Geist Mono, as the app writes them. */
export function Keys({ text, mono = false }: { text: string; mono?: boolean }) {
  return text.split(/([A-Z]{3}-\d+)/).map((part, i) =>
    i % 2 ? <span key={i} className={`whitespace-nowrap ${mono ? "font-mono text-[0.92em]" : ""}`}>{part}</span> : part);
}

const motionQuery = "(prefers-reduced-motion: reduce)";

/** Text that types itself in, as an agent's first message does; with reduced motion it's all there. */
function Typed({ text, delay, speed }: { text: string; delay: number; speed: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia(motionQuery).matches) return setN(text.length);
    let i = 0;
    let id = window.setTimeout(function tick() {
      i = Math.min(text.length, i + Math.max(1, Math.round(16 / speed)));
      setN(i);
      if (i < text.length) id = window.setTimeout(tick, Math.max(speed, 16));
    }, delay);
    return () => window.clearTimeout(id);
  }, [text, delay, speed]);
  return <>{text.slice(0, n)}</>;
}

/** A result's header, like a view's header in the app: its icon, the task's key and title, and where it runs. */
function Head({ icon, taskKey, title, sub, children }: { icon: IconName; taskKey?: string; title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-app-line pl-[18px] pr-4 whitespace-nowrap">
      <Icon name={icon} size={16} className="text-app-mut" />
      {taskKey && <span className="font-mono text-[12px] text-app-mut2">{taskKey}</span>}
      <span className="truncate text-[14px] font-semibold text-app-strong">{title}</span>
      {sub && <span className="text-app-mut2">{sub}</span>}
      <span className="flex-1" />
      {children}
    </div>
  );
}

function Chip({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <span className={`${s.wide} inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-app-ctl px-2 text-[12px] text-app-fg3`}>
      <Icon name={icon} size={12} strokeWidth={2} className="text-app-mut" />{children}
    </span>
  );
}

/** A session's state, as the app draws it; "waiting" is the navy of "finished, waiting for you". */
function State({ state }: { state: "waiting" | "running" | "done" }) {
  if (state === "done") return <StatusIcon status="done" />;
  if (state === "running") return <StatusIcon status="progress" />;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0" aria-hidden="true">
      <circle cx="7" cy="7" r="6" fill="none" stroke="var(--color-app-accent)" strokeWidth="1.5" />
      <circle cx="7" cy="7" r="3" fill="var(--color-app-accent)" />
    </svg>
  );
}

const note = "text-[12.5px] leading-[1.55] text-pretty text-app-mut";
const button = "inline-flex h-[30px] items-center gap-[7px] rounded-[7px] border px-3 text-[12.5px] font-medium whitespace-nowrap";
const primary = `${button} border-transparent bg-accent-strong text-white hover:brightness-110`;
const secondary = `${button} border-app-line2 bg-app-panel text-app-fg2 hover:bg-app-hover`;

/* ---------- Plan my day ---------- */

type Slot = { time: string; title: string; area: keyof typeof AREA; kind?: "plan" | "check" };
// Your fixed day, and what the auto-planner puts into its free time: a check for each finished session right after
// the focus block, then your own tasks after lunch, the slides well before they're due.
const DAY: Slot[] = [
  { time: "08:30–08:45", title: "Standup", area: "work" },
  { time: "09:00–11:00", title: "Focus: pricing page", area: "work" },
  { time: "11:00–11:15", title: "Check WEB-10", area: "dev", kind: "check" },
  { time: "11:15–11:30", title: "Check WEB-12", area: "dev", kind: "check" },
  { time: "11:30–11:45", title: "Check APP-31", area: "dev", kind: "check" },
  { time: "12:30–13:30", title: "Lunch with Ana", area: "personal" },
  { time: "14:00–14:45", title: "PER-8 Book the dentist", area: "personal", kind: "plan" },
  { time: "15:00–16:30", title: "WRK-31 Prepare slides for Q4 planning", area: "work", kind: "plan" },
];
const AREA_NAME = { work: "Work", personal: "Personal", dev: "Dev" };
// The auto-planner's rules, as the app lists them beside the week.
const RULES = ["Focus time 08:00 to 17:00", "Keep 12:30 to 13:30 free", "Deadlines first, then priority",
  "Finished sessions get a check block", "Tasks for Claude Code and Codex are left to them"];

function PlanPane({ planned }: { planned: boolean }) {
  let n = 0;
  return (
    <>
      <Head icon="sun" title="Today" sub="Thu, 24 Sep">
        {planned && <span className="truncate text-[12px] text-app-mut2">3 h planned for you</span>}
      </Head>
      <div className={`${s.plan} ${planned ? "" : s.unplanned}`}>
        <div className={s.scroll}>
          <Group name="Schedule" count={planned ? DAY.length : DAY.filter((d) => !d.kind).length} />
          {DAY.map((d) => (
            <div key={d.time} style={d.kind ? ({ "--i": n++ } as CSSProperties) : undefined}
              className={`flex h-9 shrink-0 items-center gap-3 pl-5 pr-4 text-[13px] shadow-[inset_0_-1px_var(--color-app-hover)] ${d.kind ? `${s.planned} bg-app-raised text-app-strong` : ""}`}>
              <span className={`${s.time} shrink-0 font-mono text-[11.5px] text-app-mut`}>{d.time.slice(0, 5)}<span className={s.wide}>{d.time.slice(5)}</span></span>
              {d.kind === "check"
                ? <Icon name="terminal" size={12} strokeWidth={2.2} className="text-app-accent" />
                : <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: AREA[d.area] }} />}
              <span className="min-w-0 flex-1 truncate">{d.title}</span>
              {d.kind && <span className="shrink-0 rounded-full border border-app-ctl px-2 text-[11px] leading-[18px] text-app-mut">Planned</span>}
              <span className={`${s.wide} w-16 shrink-0 text-right text-[11.5px] text-app-mut2`}>{AREA_NAME[d.area]}</span>
            </div>
          ))}
          <Group name="Due today" count={1} />
          <div className="flex h-9 items-center gap-2.5 pl-5 pr-4 text-[13px]">
            <span className="w-[54px] shrink-0 font-mono text-[11.5px] text-app-mut2">WRK-31</span>
            <StatusIcon status="todo" />
            <span className="min-w-0 flex-1 truncate">Prepare slides for Q4 planning</span>
            <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[5px] border border-app-ctl px-1.5 text-[11.5px] text-app-fg2">
              <Icon name="flag" size={11} strokeWidth={2.2} />17:00
            </span>
          </div>
        </div>
        <aside aria-label="Auto-plan" className={s.aside}>
          <p className="text-[12.5px] font-medium text-app-fg2">Auto-plan</p>
          <p className="mt-1 text-[12px] text-app-mut2">{planned ? "5 blocks in your free time" : "Not planned yet"}</p>
          <p className={`${s.planned} mt-3 flex gap-2.5 text-[12.5px] leading-[1.45] text-app-fg3`} style={{ "--i": 0 } as CSSProperties}>
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-app-accent" />
            <span>APP-31 finished, so 15 min to check it was added today at 11:30</span>
          </p>
          <div className={s.rules}>
            <p className="mt-5 text-[12.5px] font-medium text-app-fg2">Rules</p>
            <ul className="mt-1.5 space-y-1 text-[12px] leading-[1.45] text-app-mut">{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        </aside>
      </div>
    </>
  );
}

/* ---------- What's waiting for me? ---------- */

const CHECKS = ["One device and Cloud are both on the page", "Cloud’s price follows the visitor’s country", "The page reads well at 375 px"];

function WaitingPane() {
  const [now, setNow] = useState<"waiting" | "asking" | "done" | "changes">("waiting");
  const [text, setText] = useState("");
  const settled = now === "done" || now === "changes";
  return (
    <>
      <Head icon="terminal" title="Sessions" sub={settled ? undefined : "Waiting for you"} />
      <div className={`${s.scroll} space-y-4 px-5 py-[18px]`}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <State state={now === "done" ? "done" : now === "changes" ? "running" : "waiting"} />
          <span className="font-mono text-[12px] text-app-mut2">WEB-12</span>
          <span className="text-[15px] font-semibold text-app-strong">Write the pricing page</span>
          <span className="flex-1" />
          <span className="flex items-center gap-2 text-[12px] text-app-mut2">
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: AREA.dev }} />PacedMind website
          </span>
        </div>
        <p className="-mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-app-mut">
          {now === "changes" ? "Claude Code is working on your changes" : `${now === "done" ? "Done. " : ""}Claude Code finished at 10:42`}
          {!settled && <span className="rounded-full bg-app-accent/15 px-2.5 text-[11.5px] leading-[21px] font-medium text-app-accent-fg">Waiting for you</span>}
        </p>
        <p className="max-w-[64ch] text-[13px] leading-[1.6] text-app-fg2">
          The pricing page shows both plans, One device and Cloud. Cloud’s price follows the visitor’s country, with a note that it starts with 7 days free.
        </p>
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-app-fg3">Done when <span className="ml-1.5 font-normal text-app-mut2">3 of 3 met</span></p>
          {CHECKS.map((c) => (
            <p key={c} className="flex items-center gap-2.5 py-0.5 text-[12.5px] text-app-fg2">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
                <circle cx="7" cy="7" r="6.25" fill="var(--color-app-fg3)" />
                <path d="M4.4 7.2 L6.2 9 L9.7 5.3" fill="none" stroke="var(--color-app-panel)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>{c}
            </p>
          ))}
        </div>
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-app-fg3">How to check it</p>
          <ol className="list-inside list-decimal space-y-0.5 text-[12.5px] text-app-mut marker:font-mono marker:text-[11px] marker:text-app-dim">
            <li>Open <span className="font-mono text-[11.5px] text-app-fg2">/pricing</span> on the site’s dev server</li>
            <li>Pick Poland under Prices for: Cloud shows 26,99 zł / month</li>
            <li>Narrow the window to 375 px</li>
          </ol>
        </div>
        {now === "asking" ? (
          <div ref={(el) => el?.scrollIntoView({ block: "nearest" })} className="space-y-2 rounded-lg border border-app-line2 bg-app-raised p-2.5">
            <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label="What should change"
              placeholder="What should change? Be as specific as you’d be with a colleague."
              className="block min-h-[54px] w-full resize-none bg-transparent text-[12.5px] leading-[1.55] text-app-fg2 outline-none placeholder:text-app-mut2" />
            <p className="text-[11.5px] text-app-mut2">Claude Code continues its conversation in a new terminal.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className={`${button} border-transparent text-app-mut`} onClick={() => setNow("waiting")}>Cancel</button>
              <button type="button" className={`${primary} disabled:opacity-45`} disabled={!text.trim()} onClick={() => setNow("changes")}>Send to Claude Code</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 border-t border-app-line pt-3.5">
            <span className="min-w-[200px] flex-1 text-[12px] text-app-mut2">
              {now === "done" ? "Marked done." : now === "changes" ? "Sent. Claude Code continues its conversation in a new terminal." : "PacedMind told you at 10:42 and booked a check at 11:15."}
            </span>
            {settled ? (
              <button type="button" className="text-[12px] text-app-mut2 underline underline-offset-[3px]" onClick={() => { setNow("waiting"); setText(""); }}>Undo</button>
            ) : (
              <>
                <button type="button" className={secondary} onClick={() => setNow("asking")}><Sym name="pen" size={13} strokeWidth={2} />Request changes</button>
                <button type="button" className={primary} onClick={() => setNow("done")}>Mark done</button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- Where sessions run ---------- */

// The first message PacedMind writes for a session (kickoffPrompt in the app's launcher).
const kickoff = (key: string, session: string) =>
  `PacedMind task ${key}, session ${session}. Call the organizer MCP tool start_task with task ${key} and session ${session}, then follow the instructions it returns.`;

/** A window's title bar: macOS's three dots before the title, or Windows' buttons at the end (html[data-os]). */
function TitleBar({ dark, className, children }: { dark?: boolean; className: string; children: ReactNode }) {
  return (
    <div className={`flex ${className}`}>
      <span className={`${s.lights} items-center gap-[7px] px-2`}>
        {[0, 1, 2].map((i) => <i key={i} className={`h-[11px] w-[11px] rounded-full ${dark ? "bg-[#3a3a3f]" : "bg-app-ctl"}`} />)}
      </span>
      {children}
      <span className={`${s.winControls} ml-auto self-stretch ${dark ? "text-[#a1a1a8]" : "text-app-mut2"}`}>
        {["M1 5h8", "M1.5 1.5h7v7h-7z", "M1.5 1.5l7 7M8.5 1.5l-7 7"].map((d) => (
          <span key={d} className="grid w-[42px] place-items-center">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1"><path d={d} /></svg>
          </span>
        ))}
      </span>
    </div>
  );
}

function TerminalPane() {
  return (
    <>
      <Head icon="terminal" taskKey="WEB-16" title="Draft the launch announcement"><Chip icon="terminal">Claude Code</Chip></Head>
      <div className={`${s.scroll} px-5 py-[18px]`}>
        {/* A terminal is black in both themes. */}
        <div className="overflow-hidden rounded-[10px] border border-[#2a2a2e] bg-black text-[#e4e4e7]">
          <TitleBar dark className="h-[38px] items-end bg-[#1c1c1f] pl-2">
            <span className="inline-flex h-[31px] items-center gap-2 self-end rounded-t-lg bg-black px-3 text-[12px] text-[#ededef]">
              <Icon name="terminal" size={13} className="text-[#a1a1a8]" />WEB-16 · Claude Code
            </span>
          </TitleBar>
          <div className="min-h-[190px] px-[18px] pb-[18px] pt-3.5 font-mono text-[12px] leading-[1.65]">
            <p>
              <span className="text-[#8b8b93]">
                <span className={s.forWindows}>C:\Users\you\Projects\pacedmind-website&gt;</span>
                <span className={s.forMac}>~/Projects/pacedmind-website % </span>
              </span>
              <Typed text="claude" delay={200} speed={70} />
            </p>
            <p className="mt-3.5 flex gap-2.5">
              <span className="text-[#8b8b93]">&gt;</span>
              <span className="break-words text-[#fafafa]"><Typed text={kickoff("WEB-16", "8c1e4b7a2f90d356")} delay={900} speed={5} /></span>
            </p>
            <span className={`${s.cursor} mt-3 inline-block h-[15px] w-2 bg-[#d4d4d8]`} />
          </div>
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-app-fg3">
          <State state="running" />Running in Claude Code since 18:00<span className="ml-auto text-[12px] text-app-mut2">Terminal on this computer</span>
        </p>
        <p className={`mt-3 max-w-[62ch] ${note}`}>
          PacedMind found Claude Code’s command-line tool on this computer, so <Keys text="WEB-16" /> opens in a new terminal, in the task’s folder,
          with the task as its first message.
        </p>
      </div>
    </>
  );
}

function AppPane() {
  return (
    <>
      <Head icon="appWindow" taskKey="WEB-10" title="Draft the home page"><Chip icon="appWindow">Claude app</Chip></Head>
      <div className={`${s.scroll} px-5 py-[18px]`}>
        <div className="overflow-hidden rounded-[10px] border border-app-line2 bg-app-raised">
          <TitleBar className="h-[34px] items-center border-b border-app-line pl-2 text-[12px] font-medium text-app-fg3">
            <span className="px-1">Claude</span>
          </TitleBar>
          <div className="flex min-h-[200px] items-end bg-app-panel p-4">
            <div className="w-full space-y-2.5 rounded-xl border border-app-line2 p-3 pl-3.5">
              <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-app-ctl px-2 text-[12px] text-app-fg3">
                <Sym name="folder" size={12} strokeWidth={2} className="text-app-mut" />pacedmind-website
              </span>
              <p className="min-h-[58px] text-[12.5px] leading-[1.55] text-app-strong"><Typed text={kickoff("WEB-10", "5d2a9c0e71b4f836")} delay={250} speed={6} /></p>
              <span className={`${s.send} relative ml-auto grid h-[30px] w-[30px] place-items-center rounded-full bg-app-strong text-app-panel`}>
                <Sym name="up" size={14} strokeWidth={2.2} />
              </span>
            </div>
          </div>
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-app-fg3">
          <Icon name="appWindow" size={14} className="text-app-mut" />Opened in the Claude app. Send the first message there to start.
        </p>
        <p className={`mt-3 max-w-[62ch] ${note}`}>
          <Keys text="WEB-10" /> runs in the Claude app because you chose it. Until you choose, a task runs in a terminal when the agent’s
          command-line tool is there, otherwise in its desktop app.
        </p>
      </div>
    </>
  );
}

// Codex cloud works on its own; PacedMind asks it every minute until the task is ready.
const TICKS = ["11:21", "11:22", "11:23", "…", "13:19", "13:20"];

function CloudPane() {
  const step = (d: number, dot: string, title: ReactNode, time: string, body: ReactNode) => (
    <li className={`${s.event} ${s.step} relative grid grid-cols-[26px_minmax(0,1fr)_auto] pb-[18px]`} style={{ "--d": `${d}ms` } as CSSProperties}>
      <i className={`relative z-[1] mt-0.5 h-[13px] w-[13px] rounded-full border-[1.5px] ${dot}`} />
      <div>
        <p className="text-[13px] font-medium text-app-strong">{title}</p>
        <div className="mt-1 text-[12.5px] leading-[1.5] text-app-mut">{body}</div>
      </div>
      <span className="pl-3 font-mono text-[11px] leading-5 text-app-mut2">{time}</span>
    </li>
  );
  const branch = (
    <span className="inline-flex h-5 items-center gap-1 rounded-[5px] border border-app-ctl px-1.5 align-[1px] font-mono text-[11.5px] text-app-fg2">
      <Sym name="branch" size={11} strokeWidth={2} className="text-app-mut" />agent/web-14
    </span>
  );
  return (
    <>
      <Head icon="cloud" taskKey="WEB-14" title="Compress the hero images"><Chip icon="cloud">Codex cloud</Chip></Head>
      <div className={`${s.scroll} px-5 py-[18px]`}>
        <ol>
          {step(80, "border-app-fg3 bg-app-fg3", "Sent to Codex cloud", "11:20",
            <>It works on a copy of the repository, on a new branch named after the task {branch}</>)}
          {step(420, "border-app-line-strong bg-app-panel", "PacedMind checks every minute", "13:20",
            <span className="mt-1.5 flex flex-wrap gap-[5px]">
              {TICKS.map((t, i) => (
                <span key={t} className={`${s.step} inline-flex h-5 items-center gap-1 rounded-[5px] border border-app-ctl px-1.5 font-mono text-[10.5px] text-app-fg3`}
                  style={{ "--d": `${700 + i * 240}ms` } as CSSProperties}>
                  {t !== "…" && <Icon name="check" size={10} strokeWidth={2.4} />}{t}
                </span>
              ))}
            </span>)}
          {step(2400, "border-app-accent bg-app-accent", <span className="text-app-accent-fg">WEB-14 finished, waiting for you</span>, "13:20",
            <>PacedMind noticed it was ready and marked it finished by itself. The work is on {branch}, and a check is in your day at 13:30.</>)}
        </ol>
        <p className={`max-w-[62ch] ${note}`}>Claude Code on the web works the same way, except that you select Mark finished yourself.</p>
      </div>
    </>
  );
}

/* ---------- Connect WEB-14 to WEB-16 ---------- */

const MODES: { mode: FlowMode; title: string; body: string; label: string }[] = [
  { mode: "auto", title: "Automatically", body: "A new Claude Code session starts as soon as WEB-14 is finished.", label: "Auto" },
  { mode: "manual", title: "After you mark it done", body: "WEB-16 waits until you mark WEB-14 done, so you can check it first.", label: "Manual" },
  { mode: "session", title: "In the same session", body: "The agent carries on with what it learned, between sessions on your computer. After a cloud session like WEB-14, the next one starts as a new session.", label: "Same session" },
  { mode: "time", title: "At a set time", body: "WEB-16 starts at 18:00, once WEB-14 is finished.", label: "At 18:00" },
];

// Two sessions of the flow, as the Flow editor draws them (see session-flow.tsx), one above the other.
function FlowNode({ y, x, taskKey, title, state, agent, place, where }: { x: number; y: number; taskKey: string; title: string; state: "waiting" | "todo"; agent: string; place: IconName; where: string }) {
  const chip = agent === "Codex" ? 46 : 80;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="0.5" y="0.5" width="231" height="73" rx="8" fill="var(--color-app-raised)" stroke="var(--color-app-ctl)" />
      <g transform="translate(12 8)">
        {state === "waiting"
          ? <><circle cx="7" cy="7" r="6" fill="none" stroke="var(--color-app-accent)" strokeWidth="1.5" /><circle cx="7" cy="7" r="3" fill="var(--color-app-accent)" /></>
          : <circle cx="7" cy="7" r="6" fill="none" stroke="var(--color-app-mut2)" strokeWidth="1.5" strokeDasharray="2 2" />}
      </g>
      <text x="33" y="19" fontFamily="var(--font-mono)" fontSize="11" fill="var(--color-app-mut2)">{taskKey}</text>
      <text x="220" y="19" textAnchor="end" fontSize="11" fill={state === "waiting" ? "var(--color-app-fg2)" : "var(--color-app-mut2)"}>
        {state === "waiting" ? "Waiting for you" : "Not started"}
      </text>
      <text x="12" y="40" fontSize="13" fill="var(--color-app-strong)">{title}</text>
      <rect x="12.5" y="48.5" width={chip} height="18" rx="5" fill="none" stroke="var(--color-app-ctl)" />
      <text x="19" y="61" fontSize="11" fill="var(--color-app-mut)">{agent}</text>
      <g transform={`translate(${21 + chip} 51)`} color="var(--color-app-mut2)"><Icon name={place} size={13} strokeWidth={2} /></g>
      <text x={39 + chip} y="61" fontSize="11" fill="var(--color-app-mut2)">{where}</text>
      {[0, 74].map((cy) => <circle key={cy} cx="116" cy={cy} r="4" fill="var(--color-app-panel)" stroke="var(--color-app-line-strong)" strokeWidth="1.5" />)}
    </g>
  );
}

function FlowPane() {
  const [mode, setMode] = useState<FlowMode>("time");
  const line = FLOW_LINE[mode];
  const label = MODES.find((m) => m.mode === mode)!.label;
  const pw = label.length * 6.1 + 18;
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-app-line pl-5 pr-4">
        <span className="h-2 w-2 rounded-full" style={{ background: AREA.dev }} />
        <span className="text-[14px] font-semibold text-app-strong">PacedMind website</span>
        <span className="flex-1" />
        <span className="text-[12.5px] text-app-fg3">Flow on</span>
        <span className="flex h-[18px] w-[30px] items-center justify-end rounded-full bg-accent-strong p-0.5"><span className="h-3.5 w-3.5 rounded-full bg-white" /></span>
      </div>
      <div className={s.flow}>
        <div className={s.canvas} style={{ backgroundImage: "radial-gradient(circle, var(--color-app-ctl) 1px, transparent 1.3px)", backgroundSize: "22px 22px" }}>
          <svg viewBox="0 0 320 250" className="block h-auto" style={{ width: "min(100%, 320px)" }} aria-hidden="true" fontFamily="var(--font-app)">
            <g className={s.edge}>
              <path d="M 124 94 C 124 122, 196 122, 196 150" fill="none" stroke="var(--color-app-fg3)" strokeWidth={line.width} strokeDasharray={line.dash} strokeLinecap="round" />
              <path d="M 192 144 L 196 150 L 200 144" fill="none" stroke="var(--color-app-fg3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </g>
            <FlowNode x={8} y={12} taskKey="WEB-14" title="Compress the hero images" state="waiting" agent="Codex" place="cloud" where="Codex cloud" />
            <FlowNode x={80} y={159} taskKey="WEB-16" title="Draft the launch announcement" state="todo" agent="Claude Code" place="terminal" where="Terminal" />
            <g transform="translate(160 122)">
              <rect x={-pw / 2 + 0.5} y="-9.5" width={pw - 1} height="19" rx="9.5" fill="var(--color-app-panel)" stroke="var(--color-app-ctl)" />
              <text y="4" textAnchor="middle" fontSize="11" fill="var(--color-app-mut)">{label}</text>
            </g>
          </svg>
        </div>
        <fieldset className="min-w-0 space-y-0.5 px-3 py-4">
          <legend className="float-left mb-2 px-2 text-[12.5px] font-medium text-app-fg2">How WEB-16 starts</legend>
          {MODES.map((m) => (
            <label key={m.mode} className={`clear-left grid cursor-pointer grid-cols-[16px_28px_minmax(0,1fr)] items-start gap-2.5 rounded-lg p-2 hover:bg-app-hover ${mode === m.mode ? "bg-app-accent/[0.07]" : ""}`}>
              <input type="radio" name="palette-mode" value={m.mode} checked={mode === m.mode} onChange={() => setMode(m.mode)} className={s.radio} />
              <svg width="28" height="18" viewBox="0 0 28 18" aria-hidden="true">
                <path d="M2 9H26" stroke="var(--color-app-fg3)" strokeWidth={FLOW_LINE[m.mode].width} strokeDasharray={FLOW_LINE[m.mode].dash} strokeLinecap="round" />
              </svg>
              <span>
                <span className="block text-[13px] font-medium text-app-strong">{m.title}</span>
                <span className="mt-0.5 block text-[12px] leading-[1.45] text-app-mut"><Keys text={m.body} /></span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </>
  );
}

/* ---------- Start with another agent ---------- */

function MorePane() {
  const found = (app: string) => (
    <span className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12px] text-app-fg3">
      {["Command-line tool", app].map((t) => <span key={t} className="inline-flex items-center gap-1.5"><Icon name="check" size={12} strokeWidth={2.4} />{t}</span>)}
    </span>
  );
  const row = "grid grid-cols-[minmax(0,120px)_minmax(0,1fr)] items-center gap-3 border-t border-app-line px-4 py-3.5 first:border-t-0";
  return (
    <>
      <Head icon="terminal" title="Agents on this computer"><span className="text-[12px] text-app-mut2">Checked every half hour</span></Head>
      <div className={`${s.scroll} px-5 py-[18px]`}>
        <div className="overflow-hidden rounded-[10px] border border-app-line">
          <div className={row}><span className="text-[13px] font-medium text-app-strong">Claude Code</span>{found("Claude app")}</div>
          <div className={row}><span className="text-[13px] font-medium text-app-strong">Codex</span>{found("Codex app")}</div>
          <div className={`${row} bg-app-raised`}><span className="text-[13px] text-app-mut">Another agent</span><span className="text-[12px] text-app-mut">Support for more agent harnesses is coming soon.</span></div>
        </div>
        <p className={`mt-3 max-w-[62ch] ${note}`}>
          PacedMind looks for Claude Code and Codex, their command-line tools and desktop apps, when it starts and every half hour. Until you
          choose, a task runs in a terminal when the command-line tool is there, otherwise in the app.
        </p>
      </div>
    </>
  );
}

export function Pane({ id, planned }: { id: PaneId; planned: boolean }) {
  switch (id) {
    case "plan": return <PlanPane planned={planned} />;
    case "waiting": return <WaitingPane />;
    case "terminal": return <TerminalPane />;
    case "app": return <AppPane />;
    case "cloud": return <CloudPane />;
    case "flow": return <FlowPane />;
    case "more": return <MorePane />;
  }
}
