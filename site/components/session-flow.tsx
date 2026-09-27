"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { AREA, FLOW_LINE, Icon, type FlowMode, type IconName } from "./screens/parts";

// A project's flow in the app's Flow editor (views/flow.tsx in the app), with a day playing through it: each session
// starts in its own place, in the way its connection says. The sessions and their connections are one SVG, so they
// scale with the page.

type State = "todo" | "running" | "waiting" | "done";

const TASKS: { key: string; title: string; agent: string; place: IconName; where: string }[] = [
  { key: "WEB-10", title: "Draft the home page", agent: "Claude Code", place: "appWindow", where: "Claude app" },
  { key: "WEB-12", title: "Write the pricing page", agent: "Claude Code", place: "terminal", where: "Terminal" },
  { key: "WEB-14", title: "Compress the hero images", agent: "Codex", place: "cloud", where: "Codex cloud" },
  { key: "WEB-16", title: "Draft the launch announcement", agent: "Claude Code", place: "terminal", where: "Terminal" },
  { key: "WEB-17", title: "Proofread the announcement", agent: "Claude Code", place: "terminal", where: "Terminal" },
];
// Each task starts after the one before it, in this way. The last two share one Claude Code session.
const EDGES: { mode: FlowMode; label: string }[] = [
  { mode: "auto", label: "Auto" }, { mode: "manual", label: "Manual" }, { mode: "time", label: "At 18:00" }, { mode: "session", label: "Same session" },
];

// The day, one step at a time. `edge` is the connection the step's session starts through.
const STEPS: { time: string; text: string; states: State[]; edge?: number }[] = [
  { time: "09:10", text: "You start WEB-10 in the Claude app.", states: ["running", "todo", "todo", "todo", "todo"] },
  { time: "09:52", text: "It's finished, so WEB-12 starts on its own, in a terminal.", states: ["waiting", "running", "todo", "todo", "todo"], edge: 0 },
  { time: "10:42", text: "WEB-12 is finished too. The next one waits until you mark it done.", states: ["waiting", "waiting", "todo", "todo", "todo"] },
  { time: "11:20", text: "You checked both and marked them done, so WEB-14 goes to Codex cloud.", states: ["done", "done", "running", "todo", "todo"], edge: 1 },
  { time: "13:20", text: "Codex cloud is done, and PacedMind noticed. WEB-16 waits until 18:00.", states: ["done", "done", "waiting", "todo", "todo"] },
  { time: "18:00", text: "At 18:00, WEB-16 starts in a terminal.", states: ["done", "done", "waiting", "running", "todo"], edge: 2 },
  { time: "18:47", text: "WEB-17 carries on in the same session, with everything the agent learned.", states: ["done", "done", "waiting", "waiting", "running"], edge: 3 },
];
const STATE_LABEL: Record<State, string> = { todo: "Not started", running: "Running", waiting: "Waiting for you", done: "Done" };
// The step at which each connection starts its session.
const FIRED_AT = EDGES.map((_, i) => STEPS.findIndex((s) => s.edge === i));

const HOLD = 3600;
const PULSE = 1100;

// Where the sessions sit on the canvas: a gentle staircase on wide screens, a column on narrow ones. The top right
// of the staircase stays free for the day's times and what's happening.
const PAD = 24;
const NODE_H = 74;
type Layout = { w: number; node: number; at: [number, number][] };
const WIDE: Layout = { w: 1098, node: 240, at: [[0, 0], [200, 110], [400, 220], [600, 330], [800, 440]] };
const NARROW: Layout = { w: 320, node: 272, at: [[0, 0], [0, 116], [0, 232], [0, 348], [0, 464]] };
// The box behind the tasks that share a session, as the editor draws it.
function box({ at, node }: Layout) {
  const [a, b] = [at[3], at[4]];
  return {
    left: Math.min(a[0], b[0]) - 12, top: Math.min(a[1], b[1]) - 12,
    right: Math.max(a[0], b[0]) + node + 12, bottom: Math.max(a[1], b[1]) + NODE_H + 22,
  };
}

const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (cb: () => void) => {
  const m = window.matchMedia(motionQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

function StateIcon({ state }: { state: State }) {
  if (state === "done") {
    return (
      <>
        <circle cx="7" cy="7" r="6.75" fill="var(--color-app-accent)" />
        <path d="M4.4 7.2 L6.2 9 L9.7 5.3" fill="none" stroke="var(--color-app-panel)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </>
    );
  }
  if (state === "waiting") {
    return (
      <>
        <circle cx="7" cy="7" r="6" fill="none" stroke="var(--color-app-accent)" strokeWidth="1.5" />
        <circle cx="7" cy="7" r="3" fill="var(--color-app-accent)" />
      </>
    );
  }
  if (state === "running") {
    return (
      <>
        <circle cx="7" cy="7" r="6" fill="none" stroke="var(--color-app-mut)" strokeWidth="1.5" />
        <path d="M7 3 A4 4 0 0 1 7 11 Z" fill="var(--color-app-mut)" />
      </>
    );
  }
  return <circle cx="7" cy="7" r="6" fill="none" stroke="var(--color-app-mut2)" strokeWidth="1.5" strokeDasharray="2 2" />;
}

// The agent's chip is as wide as its name.
const CHIP: Record<string, number> = { "Claude Code": 80, Codex: 46 };

function TaskNode({ x, y, w, task, state }: { x: number; y: number; w: number; task: (typeof TASKS)[number]; state: State }) {
  const done = state === "done";
  const chip = CHIP[task.agent] ?? 80;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect className="flow-fade" x="0.5" y="0.5" width={w - 1} height={NODE_H - 1} rx="8"
        fill={done ? "var(--color-app-panel)" : "var(--color-app-raised)"} stroke={done ? "var(--color-app-line)" : "var(--color-app-ctl)"} />
      <g transform="translate(12 8)"><StateIcon state={state} /></g>
      <text x="33" y="19" fontFamily="var(--font-mono)" fontSize="11" fill="var(--color-app-mut2)">{task.key}</text>
      <text x={w - 12} y="19" textAnchor="end" fontSize="11" fill={state === "waiting" ? "var(--color-app-fg2)" : "var(--color-app-mut2)"}>{STATE_LABEL[state]}</text>
      <text className="flow-fade" x="12" y="40" fontSize="13" fill={done ? "var(--color-app-mut2)" : "var(--color-app-strong)"}>{task.title}</text>
      <rect x="12.5" y="48.5" width={chip} height="18" rx="5" fill="none" stroke="var(--color-app-ctl)" />
      <text x="19" y="61" fontSize="11" fill="var(--color-app-mut)">{task.agent}</text>
      <g transform={`translate(${12 + chip + 9} 51)`} color="var(--color-app-mut2)"><Icon name={task.place} size={13} strokeWidth={2} /></g>
      <text x={12 + chip + 27} y="61" fontSize="11" fill="var(--color-app-mut2)">{task.where}</text>
      {[0, NODE_H].map((cy) => (
        <circle key={cy} cx={w / 2} cy={cy} r="4" fill="var(--color-app-panel)" stroke="var(--color-app-line-strong)" strokeWidth="1.5" />
      ))}
    </g>
  );
}

/** The sessions, their connections and the box around the shared session, at their layout's size or smaller. */
function Diagram({ layout, step, pulsing, className }: { layout: Layout; step: number; pulsing: boolean; className: string }) {
  const { w, node, at } = layout;
  const b = box(layout);
  const h = PAD + b.bottom + PAD;
  const s = STEPS[step];
  // While the pulse travels, the session it starts hasn't started yet.
  const states = s.states.map((st, i) => (pulsing && s.edge !== undefined && i === s.edge + 1 ? "todo" : st));
  const edges = EDGES.map((edge, i) => {
    const sx = PAD + at[i][0] + node / 2;
    const sy = PAD + at[i][1] + NODE_H + 4;
    const tx = PAD + at[i + 1][0] + node / 2;
    const ty = PAD + at[i + 1][1] - 9;
    const dy = Math.max(36, (ty - sy) / 2);
    return { ...edge, i, tx, ty, d: `M ${sx} ${sy} C ${sx} ${sy + dy}, ${tx} ${ty - dy}, ${tx} ${ty}`, mid: { x: (sx + tx) / 2, y: (sy + ty) / 2 } };
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`block h-auto ${className}`} style={{ width: `min(100%, ${w}px)` }}
      aria-hidden="true" fontFamily="var(--font-app)">
      <rect x={PAD + b.left + 0.5} y={PAD + b.top + 0.5} width={b.right - b.left - 1} height={b.bottom - b.top - 1} rx="12"
        fill="color-mix(in srgb, var(--color-app-strong) 1.5%, transparent)" stroke="var(--color-app-ctl)" />
      {/* Bottom left, clear of the last session's handle. */}
      <text x={PAD + b.left + 10} y={PAD + b.bottom - 7} fontSize="11" fill="var(--color-app-mut2)">One Claude Code session</text>

      {edges.map((e) => {
        const stroke = step >= FIRED_AT[e.i] ? "var(--color-app-fg3)" : "var(--color-app-line-strong)";
        return (
          <g key={e.i}>
            <path className="flow-fade" d={e.d} fill="none" stroke={stroke} strokeWidth={FLOW_LINE[e.mode].width}
              strokeDasharray={FLOW_LINE[e.mode].dash} strokeLinecap="round" />
            <path className="flow-fade" d={`M ${e.tx - 4} ${e.ty - 6} L ${e.tx} ${e.ty} L ${e.tx + 4} ${e.ty - 6}`} fill="none" stroke={stroke}
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            {pulsing && s.edge === e.i && (
              <path key={step} className="flow-pulse" d={e.d} pathLength={100} fill="none" stroke="var(--color-app-accent)" strokeWidth="2.5"
                strokeLinecap="round" style={{ animationDuration: `${PULSE}ms` }} />
            )}
          </g>
        );
      })}
      {edges.map((e) => {
        const pw = e.label.length * 6.1 + 18;
        return (
          <g key={e.i} transform={`translate(${e.mid.x} ${e.mid.y})`}>
            <rect x={-pw / 2 + 0.5} y="-9.5" width={pw - 1} height="19" rx="9.5" fill="var(--color-app-panel)" stroke="var(--color-app-ctl)" />
            <text y="4" textAnchor="middle" fontSize="11" fill="var(--color-app-mut)">{e.label}</text>
          </g>
        );
      })}

      {TASKS.map((task, i) => (
        <TaskNode key={task.key} x={PAD + at[i][0]} y={PAD + at[i][1]} w={node} task={task} state={states[i]} />
      ))}
    </svg>
  );
}

/**
 * A project's flow, with a day playing through it: each step holds for a few seconds, the line under its time
 * shows the time left, and a pulse carries each start along its connection. It plays while it's on screen; hovering
 * pauses it, picking a time stops it, and the arrow keys move between times. With reduced motion it doesn't play,
 * and shows the last step.
 */
export function SessionFlow({ className = "" }: { className?: string }) {
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => false);
  // The page's HTML shows the day's last step, where every state appears; with motion, the day starts from the top.
  const [step, setStep] = useState(STEPS.length - 1);
  const [auto, setAuto] = useState(true);
  const [hover, setHover] = useState(false);
  const [seen, setSeen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [pulsing, setPulsing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const clock = useRef({ left: HOLD, since: 0 });
  const cycling = auto && !reduced;
  const paused = hover || !seen || hidden;

  useEffect(() => { setStep(reduced ? STEPS.length - 1 : 0); }, [reduced]);

  // Play only while the flow is on screen and the page is visible.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    const onVisible = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Each step gets the full time; a pause keeps what was left.
  useEffect(() => { clock.current.left = HOLD; }, [step]);
  useEffect(() => {
    if (!cycling || paused) return;
    const c = clock.current;
    c.since = performance.now();
    const id = window.setTimeout(() => setStep((s) => (s + 1) % STEPS.length), c.left);
    return () => {
      window.clearTimeout(id);
      c.left = Math.max(0, c.left - (performance.now() - c.since));
    };
  }, [step, cycling, paused]);

  // A start travels along its connection before the session shows as running.
  useEffect(() => {
    if (reduced || STEPS[step].edge === undefined) return;
    setPulsing(true);
    const id = window.setTimeout(() => setPulsing(false), PULSE);
    return () => {
      window.clearTimeout(id);
      setPulsing(false);
    };
  }, [step, reduced]);

  const pick = (i: number) => {
    setAuto(false);
    setStep(i);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!move) return;
    e.preventDefault();
    const next = (step + move + STEPS.length) % STEPS.length;
    pick(next);
    tabs.current[next]?.focus();
  };
  const hoverProps = { onPointerEnter: () => setHover(true), onPointerLeave: () => setHover(false) };

  return (
    <div ref={root} className={`relative md:flex md:items-start md:gap-10 lg:block ${className}`}>
      <div {...hoverProps} role="img" data-nosnippet=""
        aria-label="A project's flow in PacedMind: five tasks, run by Claude Code and Codex in the Claude app, a terminal and Codex cloud. They start one after another: automatically, after you mark a task done, at 18:00, and in the same session."
        className="overflow-hidden rounded-[14px] border border-app-line2 bg-app-bg font-app md:max-lg:w-[322px] md:max-lg:shrink-0">
        {/* The editor's header: the project, with its flow switched on. */}
        <div className="flex h-[52px] items-center gap-3 border-b border-app-line bg-app-panel pl-5 pr-4">
          <span className="h-2 w-2 rounded-full" style={{ background: AREA.dev }} />
          <span className="text-[14px] font-semibold text-app-strong">PacedMind website</span>
          <span className="flex-1" />
          <span className="text-[12.5px] text-app-fg3">Flow on</span>
          <span className="flex h-[18px] w-[30px] items-center justify-end rounded-full bg-accent-strong p-0.5">
            <span className="h-3.5 w-3.5 rounded-full bg-white" />
          </span>
        </div>
        <div style={{ backgroundImage: "radial-gradient(circle, var(--color-app-ctl) 1px, transparent 1.3px)", backgroundSize: "24px 24px", backgroundPosition: "12px 12px" }}>
          <Diagram layout={WIDE} step={step} pulsing={pulsing} className="max-lg:hidden" />
          <Diagram layout={NARROW} step={step} pulsing={pulsing} className="lg:hidden" />
        </div>
      </div>

      {/*
        The times act as the flow's controls, like the tabs under the screens above. On a wide flow they sit on the
        canvas, in a clearing where the sessions leave space; beside a narrow one they come next to it, on a phone after it.
      */}
      <div {...hoverProps} data-nosnippet=""
        className="mt-6 sm:mt-8 md:sticky md:top-24 md:mt-1 md:min-w-0 md:flex-1 lg:absolute lg:left-[60%] lg:right-8 lg:top-[88px] lg:mt-0 lg:rounded-2xl lg:bg-app-bg lg:shadow-[0_0_16px_12px_var(--color-app-bg)] xl:left-[64%]"
        onFocus={() => setHover(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(false); }}>
        <div role="tablist" aria-label="The day" onKeyDown={onKey} className="flex flex-wrap gap-x-[10px] gap-y-3 lg:gap-x-3 min-[1400px]:gap-x-[18px]">
          {STEPS.map((it, i) => {
            const on = i === step;
            return (
              <button key={it.time} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`flow-tab-${i}`} aria-selected={on}
                aria-controls={`flow-panel-${i}`} tabIndex={on ? 0 : -1} onClick={() => pick(i)}
                className={`flex flex-col gap-2.5 text-[15px] tabular-nums transition-colors min-[1400px]:text-[16px] ${on ? "text-ink" : "text-mut hover:text-text"}`}>
                {it.time}
                <span className="block h-0.5 w-full overflow-hidden bg-line">
                  {on && (
                    <span key={cycling ? step : "still"} className={`block h-full w-full bg-ink ${cycling ? "pace" : ""}`}
                      style={cycling ? { animationDuration: `${HOLD}ms`, animationPlayState: paused ? "paused" : "running" } : undefined} />
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-5 grid max-w-[480px]">
          {STEPS.map((it, i) => (
            <p key={it.time} role="tabpanel" id={`flow-panel-${i}`} aria-labelledby={`flow-tab-${i}`} aria-hidden={i !== step}
              className="[grid-area:1/1] text-[19px] leading-[1.45] text-ink transition-opacity duration-500 sm:text-[22px] sm:leading-[1.4]"
              style={{ opacity: i === step ? 1 : 0 }}>
              {it.text}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
