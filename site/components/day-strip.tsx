"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { AREA } from "./screens/parts";
import styles from "./day-strip.module.css";

// The day, written as a score: your calendar on the top line, each agent's sessions on a line under it. A playhead
// crosses it; sessions light up while it passes, and when one finishes, the check PacedMind books in your day flies
// onto your line. The visitor sets the pace. The page's HTML shows 10:42, just after WEB-12 finished.

const START = 8;
const END = 20;
const SPAN = END - START;
const STILL = hours("10:42");
const CHECK = 0.25;

function hours(time: string) {
  const [h, m] = time.split(":").map(Number);
  return h + m / 60;
}
function clockOf(t: number) {
  const m = Math.round(t * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
/** Where a time sits along the day, from 0 to 1. */
const along = (t: number) => (t - START) / SPAN;

type LineName = "you" | "claude" | "codex";
type Clip = {
  line: LineName; kind: "event" | "block" | "task" | "session"; from: string; to: string; area: keyof typeof AREA;
  title: string; key?: string; place?: string;
  /** A session's check on your line, and when you mark it done; until then it's waiting for you. */
  check?: string; done?: string;
  /** Too short to carry its name, which goes above it instead. */
  short?: boolean;
};

// The same day the flow section and the other widgets tell.
const CLIPS: Clip[] = [
  { line: "you", kind: "event", from: "08:30", to: "08:45", area: "work", title: "Standup", short: true },
  { line: "you", kind: "block", from: "09:00", to: "11:00", area: "work", title: "Focus: pricing page" },
  { line: "you", kind: "event", from: "12:30", to: "13:30", area: "personal", title: "Lunch with Ana" },
  { line: "you", kind: "task", from: "14:00", to: "14:45", area: "personal", key: "PER-8", title: "Book the dentist" },
  { line: "you", kind: "block", from: "15:00", to: "16:30", area: "work", key: "WRK-31", title: "Prepare slides for Q4 planning" },
  { line: "claude", kind: "session", from: "09:10", to: "09:52", area: "dev", key: "WEB-10", title: "Draft the home page", place: "Claude app", check: "11:00", done: "11:15" },
  { line: "claude", kind: "session", from: "09:52", to: "10:42", area: "dev", key: "WEB-12", title: "Write the pricing page", place: "Terminal", check: "11:15", done: "11:20" },
  { line: "claude", kind: "session", from: "18:00", to: "18:47", area: "dev", key: "WEB-16", title: "Draft the launch announcement", place: "Terminal" },
  { line: "claude", kind: "session", from: "18:47", to: "19:30", area: "dev", key: "WEB-17", title: "Proofread the announcement", place: "Terminal, same session", short: true },
  { line: "codex", kind: "session", from: "09:40", to: "11:10", area: "dev", key: "APP-31", title: "Fix calendar sync after sleep", place: "Terminal", check: "11:30", done: "11:45" },
  { line: "codex", kind: "session", from: "11:20", to: "13:20", area: "dev", key: "WEB-14", title: "Compress the hero images", place: "Codex cloud", check: "13:30", done: "13:45" },
];
const TIMES = CLIPS.map((c) => ({ from: hours(c.from), to: hours(c.to), check: c.check ? hours(c.check) : null, done: c.done ? hours(c.done) : null }));

// What's happening, from each time on.
const STATUS: [number, string][] = ([
  ["08:00", "Your calendar is on the top line. Your agents’ sessions go on the lines below it."],
  ["09:10", "You start WEB-10 in the Claude app."],
  ["09:40", "Codex starts APP-31 in a terminal."],
  ["09:52", "WEB-10 is finished, so WEB-12 starts on its own in a terminal."],
  ["10:42", "Claude Code finished WEB-12. Its check is at 11:15, and WEB-14 waits until you mark it done."],
  ["11:00", "Your focus block is over, and your checks begin with WEB-10."],
  ["11:10", "Codex finished APP-31. Its check is at 11:30."],
  ["11:20", "You marked WEB-12 done, so WEB-14 starts in Codex cloud."],
  ["13:20", "Codex cloud finished WEB-14. Its check is at 13:30, after lunch."],
  ["14:00", "Your own task: PER-8, Book the dentist."],
  ["15:00", "The auto-planner placed a focus block for WRK-31, which is due at 17:00."],
  ["17:00", "WRK-31 is due."],
  ["18:00", "At 18:00, WEB-16 starts on its own in a terminal."],
  ["18:47", "WEB-16 is waiting for you. WEB-17 carries on in the same session."],
  ["19:30", "WEB-17 is finished too. Both wait for you, with their reports."],
] as const).map(([at, text]): [number, string] => [hours(at), text]);

const PACES = [
  { name: "Slow", rate: 0.25 }, { name: "Easy", rate: 0.375 }, { name: "Steady", rate: 0.5 }, { name: "Brisk", rate: 0.75 }, { name: "Quick", rate: 1 },
];
// Where each line's clips sit: the line's top edge is measured, this is the middle of its staff.
const MIDDLE: Record<LineName, number> = { you: 58, claude: 46, codex: 46 };
// WEB-14 holds (the fermata) from WEB-12's finish until you mark WEB-12 done.
const HOLD = [hours("10:42"), hours("11:20")];

type ClipState = "todo" | "running" | "waiting" | "done";
function clipState(i: number, t: number): ClipState {
  const c = TIMES[i];
  if (t < c.from) return "todo";
  if (t < c.to) return "running";
  if (CLIPS[i].kind === "session" && (c.done === null || t < c.done)) return "waiting";
  return "done";
}
function checkState(i: number, t: number) {
  const c = TIMES[i];
  if (c.check === null || t < c.to) return "hidden";
  if (t < c.check) return "booked";
  return t < c.check + CHECK ? "running" : "done";
}
function statusAt(t: number) {
  let at = 0;
  STATUS.forEach(([from], i) => { if (t >= from - 1e-6) at = i; });
  return at;
}
const fillOf = (i: number, t: number) => (clipState(i, t) === "running" ? `${((t - TIMES[i].from) / (Math.min(TIMES[i].to, END) - TIMES[i].from)) * 100}%` : "0%");
const place = (t: number) => (t <= START ? "start" : t >= END ? "end" : "middle");

const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (cb: () => void) => {
  const m = window.matchMedia(motionQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

const CHECK_ICON = (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2.4 6.3l2.4 2.4 4.8-5.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
type Vars = CSSProperties & Record<`--${string}`, number | string>;
/** A clip's place on its line, as custom properties: where it starts, and how much of the day it spans. */
const pos = (from: number, to?: number): Vars =>
  (to === undefined ? { "--from": along(from) } : { "--from": along(from), "--span": (Math.min(to, END) - from) / SPAN });
const prefersReduced = () => window.matchMedia(motionQuery).matches;

/**
 * The day strip: a day in PacedMind played as a score. It plays once, from 08:00, the first time it's on screen, and
 * pauses while it's off screen or the tab is hidden. Play/Pause, the pace and the hours (drag them, or use the arrow
 * keys) are the visitor's. With reduced motion it shows 10:42 and plays only when asked.
 *
 * The playhead, the clock and the clips' states change many times a second, so they're painted straight onto the
 * elements; React renders them once, at 10:42, and only the controls and the status line go through its state.
 */
export function DayStrip({ className = "" }: { className?: string }) {
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => false);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState<"start" | "middle" | "end">("middle");
  const [status, setStatus] = useState(statusAt(STILL));
  const [pace, setPace] = useState(2);

  const time = useRef(STILL);
  const isPlaying = useRef(false);
  const shown = useRef(statusAt(STILL));
  const played = useRef(false);
  const resume = useRef(false);
  const holdFollow = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const roll = useRef<HTMLDivElement>(null);
  const heads = useRef<HTMLDivElement>(null);
  const lanes = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const fermata = useRef<HTMLDivElement>(null);
  const lines = useRef<Partial<Record<LineName, HTMLDivElement | null>>>({});
  const clips = useRef<(HTMLDivElement | null)[]>([]);
  const fills = useRef<(HTMLSpanElement | null)[]>([]);
  const checks = useRef<(HTMLDivElement | null)[]>([]);

  // What paints and moves the day works on the elements only, so it's the same function for every render.
  // A finished session's check flies from where it ended to its place on your line.
  const fly = useCallback((i: number) => {
    const el = checks.current[i];
    const from = lines.current[CLIPS[i].line];
    const you = lines.current.you;
    const width = lanes.current?.clientWidth;
    if (!el || !from || !you || !width || prefersReduced() || !el.animate) return;
    const dx = (along(TIMES[i].to) - along(TIMES[i].check!)) * width;
    const dy = from.offsetTop + MIDDLE[CLIPS[i].line] - (you.offsetTop + MIDDLE.you);
    el.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(.5)`, opacity: 0 },
      { transform: `translate(${dx * 0.9}px, ${dy * 0.8}px) scale(.7)`, opacity: 1, offset: 0.12 },
      { transform: `translate(${dx * 0.3}px, -14px) scale(1.06)`, opacity: 1, offset: 0.62 },
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
    ], { duration: 1300, easing: "cubic-bezier(.25, .6, .3, 1)" });
  }, []);

  // Paints the day at `time`. With `before`, checks whose session finished since then fly in.
  const paint = useCallback((before?: number) => {
    const t = time.current;
    if (playhead.current) playhead.current.style.left = `${along(t) * 100}%`;
    if (clock.current) clock.current.textContent = clockOf(t);
    ruler.current?.setAttribute("aria-valuenow", String(Math.round(t * 60)));
    ruler.current?.setAttribute("aria-valuetext", clockOf(t));
    CLIPS.forEach((c, i) => {
      const el = clips.current[i];
      if (el) el.dataset.state = clipState(i, t);
      const fill = fills.current[i];
      if (fill) fill.style.width = fillOf(i, t);
      const check = checks.current[i];
      if (!check) return;
      check.dataset.state = checkState(i, t);
      if (before !== undefined && before < TIMES[i].to && t >= TIMES[i].to) fly(i);
    });
    if (fermata.current) fermata.current.dataset.state = t >= HOLD[0] && t < HOLD[1] ? "holding" : "";
    const now = statusAt(t);
    if (now !== shown.current) {
      shown.current = now;
      setStatus(now);
    }
  }, [fly]);

  // On a narrow page the roll scrolls sideways; it keeps the playhead in view unless the visitor just moved it.
  const follow = useCallback(() => {
    const r = roll.current;
    if (!r || !lanes.current || !heads.current || r.scrollWidth <= r.clientWidth + 2 || performance.now() < holdFollow.current) return;
    const visible = r.clientWidth - heads.current.offsetWidth;
    r.scrollLeft = Math.max(0, along(time.current) * lanes.current.clientWidth - visible * 0.4);
  }, []);

  const seek = useCallback((t: number) => {
    time.current = Math.min(END, Math.max(START, t));
    checks.current.forEach((el) => el?.getAnimations().forEach((a) => a.cancel()));
    paint();
    follow();
    setAt(place(time.current));
  }, [paint, follow]);

  // Without reduced motion the day waits at 08:00 for its first time on screen; with it, it stays at 10:42.
  useEffect(() => {
    setPlaying(false);
    if (reduced || prefersReduced()) seek(STILL);
    else if (!played.current) seek(START);
    requestAnimationFrame(follow);
  }, [reduced, seek, follow]);

  // Play once, the first time it's on screen; pause while it's off screen or the tab is hidden.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let seen = false;
    const update = () => {
      const visible = seen && !document.hidden;
      if (visible && !played.current && !prefersReduced()) {
        played.current = true;
        setPlaying(true);
      } else if (visible && resume.current) {
        resume.current = false;
        setPlaying(true);
      } else if (!visible && isPlaying.current) {
        resume.current = true;
        setPlaying(false);
      }
    };
    const io = new IntersectionObserver(([entry]) => { seen = entry.isIntersecting; update(); }, { threshold: 0.35 });
    io.observe(el);
    document.addEventListener("visibilitychange", update);
    const onResize = () => follow();
    window.addEventListener("resize", onResize);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("resize", onResize);
    };
  }, [follow]);

  // The playhead moves at the visitor's pace.
  useEffect(() => {
    isPlaying.current = playing;
    if (!playing) return;
    const rate = PACES[pace].rate;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const before = time.current;
      time.current = Math.min(END, before + (Math.min(100, now - last) / 1000) * rate);
      last = now;
      paint(before);
      follow();
      if (time.current >= END) {
        setPlaying(false);
        setAt("end");
        return;
      }
      frame = requestAnimationFrame(tick);
    });
    setAt("middle");
    return () => cancelAnimationFrame(frame);
  }, [playing, pace, paint, follow]);

  const toggle = () => {
    played.current = true;
    resume.current = false;
    if (playing) return setPlaying(false);
    if (time.current >= END) seek(START);
    holdFollow.current = 0;
    setPlaying(true);
  };

  const scrubbing = useRef(false);
  const timeAt = (clientX: number) => {
    const box = lanes.current!.getBoundingClientRect();
    return START + Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * SPAN;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    played.current = true;
    scrubbing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    seek(timeAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => { if (scrubbing.current) seek(timeAt(e.clientX)); };
  const endScrub = () => { scrubbing.current = false; };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = ({ ArrowLeft: -0.25, ArrowDown: -0.25, ArrowRight: 0.25, ArrowUp: 0.25, PageDown: -1, PageUp: 1 } as Record<string, number>)[e.key];
    const t = time.current;
    const next = step ? Math.round((t + step) * 4) / 4 : e.key === "Home" ? START : e.key === "End" ? END : null;
    if (next === null) return;
    e.preventDefault();
    played.current = true;
    seek(next);
  };

  const seconds = Math.round(SPAN / PACES[pace].rate);
  const label = playing ? "Pause" : at === "end" ? "Play again" : at === "start" ? "Play the day" : "Play";

  return (
    <div ref={root} data-nosnippet="" className={`${styles.strip} ${className}`} style={{ "--hours": SPAN } as CSSProperties}>
      <div className={styles.transport}>
        <button type="button" onClick={toggle} className={styles.play}>
          <span className={styles.playIcon} aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d={playing ? "M2.5 1.5h2.4v9H2.5zM7.1 1.5h2.4v9H7.1z" : "M3 1.6v8.8L10.4 6z"} fill="currentColor" />
            </svg>
          </span>
          {label}
        </button>
        <span ref={clock} className={styles.clock} aria-hidden="true">{clockOf(STILL)}</span>
        <p className={styles.status}>{STATUS[status][1]}</p>
        <div className={styles.pace}>
          <label htmlFor="day-strip-pace">Your pace</label>
          <input id="day-strip-pace" type="range" min={0} max={PACES.length - 1} step={1} value={pace} className={styles.range}
            aria-valuetext={`${PACES[pace].name}: the day in ${seconds} seconds`} onChange={(e) => setPace(Number(e.target.value))} />
          <output htmlFor="day-strip-pace"><b>{PACES[pace].name}</b>, the day in {seconds} s</output>
        </div>
      </div>

      <div ref={roll} className={styles.roll}
        onPointerDown={() => { holdFollow.current = performance.now() + 4000; }}
        onWheel={() => { holdFollow.current = performance.now() + 4000; }}>
        <div className={styles.sheet}>
          <div ref={heads} className={styles.heads} aria-hidden="true">
            <div style={{ height: 34 }} />
            <div className={`${styles.head} ${styles.you}`}>You</div>
            <div className={styles.agents}>
              <div className={`${styles.head} ${styles.agent}`}>Claude Code</div>
              <div className={`${styles.head} ${styles.agent}`}>Codex</div>
              <div className={`${styles.head} ${styles.more}`}>More agents soon</div>
            </div>
          </div>

          <div ref={lanes} className={styles.lanes}>
            <div ref={ruler} role="slider" tabIndex={0} aria-label="Time of day" aria-valuemin={START * 60} aria-valuemax={END * 60}
              aria-valuenow={Math.round(STILL * 60)} aria-valuetext={clockOf(STILL)} className={styles.ruler}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endScrub} onPointerCancel={endScrub} onKeyDown={onKey}>
              {Array.from({ length: SPAN + 1 }, (_, i) => (
                <span key={i} className={styles.hour} style={{ left: `${(i / SPAN) * 100}%` }}>{String(START + i).padStart(2, "0")}</span>
              ))}
            </div>

            {(["you", "claude", "codex"] as const).map((name) => (
              <div key={name} ref={(el) => { lines.current[name] = el; }} aria-hidden="true"
                className={`${styles.line} ${name === "you" ? styles.you : styles.agent}`}>
                {CLIPS.map((c, i) => c.line === name && (
                  <div key={c.title} ref={(el) => { clips.current[i] = el; }} data-state={clipState(i, STILL)}
                    title={`${c.key ? `${c.key} ` : ""}${c.title}${c.place ? `, ${c.place}` : ""}`}
                    className={`${styles.clip} ${c.kind === "event" ? styles.event : ""} ${TIMES[i].to > END ? styles.open : ""}`}
                    style={{ ...pos(TIMES[i].from, TIMES[i].to), "--c": AREA[c.area] } as Vars}>
                    {!c.short && (
                      <>
                        <span ref={(el) => { fills.current[i] = el; }} className={styles.fill} style={{ width: fillOf(i, STILL) }} />
                        {c.key && <span className={styles.key}>{c.key}</span>}
                        <span className={styles.title}>{c.title}</span>
                      </>
                    )}
                  </div>
                ))}
                {name === "you" && (
                  <>
                    <span className={styles.label} style={pos(hours("08:30"))}>Standup</span>
                    <div className={styles.deadline} style={pos(17)} />
                    <span className={styles.label} style={pos(17)}>&nbsp;&nbsp;<span className={styles.mono}>WRK-31</span> due 17:00</span>
                    {CLIPS.map((c, i) => c.check && (
                      <div key={c.check} ref={(el) => { checks.current[i] = el; }} data-state={checkState(i, STILL)} title={`Check ${c.key}`}
                        className={styles.check} style={pos(TIMES[i].check!, TIMES[i].check! + CHECK)}>
                        {CHECK_ICON}
                      </div>
                    ))}
                  </>
                )}
                {name === "claude" && (
                  <>
                    <span className={styles.cue} style={pos(18)}>18:00</span>
                    <span className={`${styles.label} ${styles.end}`}><span className={styles.mono}>WEB-17</span></span>
                    <div className={styles.mark} style={{ left: `calc(${along(hours("18:47")) * 100}% - 22px)`, top: MIDDLE.claude + 20 }}>
                      <svg width="44" height="12" viewBox="0 0 44 12"><path d="M1 1C11 12.5 33 12.5 43 1C33 8 11 8 1 1Z" fill="currentColor" /></svg>
                    </div>
                  </>
                )}
                {name === "codex" && (
                  <div ref={fermata} data-state={STILL >= HOLD[0] && STILL < HOLD[1] ? "holding" : ""} className={styles.mark}
                    style={{ left: `calc(${along(hours("11:20")) * 100}% - 11px)`, top: MIDDLE.codex - 33 }}>
                    <svg width="22" height="12" viewBox="0 0 22 12">
                      <path d="M1 11C2.6 2.4 19.4 2.4 21 11C18.6 5.2 3.4 5.2 1 11Z" fill="currentColor" />
                      <circle cx="11" cy="9.4" r="1.7" fill="currentColor" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
            <div className={`${styles.line} ${styles.more}`} aria-hidden="true" />
            <div ref={playhead} className={styles.playhead} style={{ left: `${along(STILL) * 100}%` }} aria-hidden="true" />
          </div>
        </div>
      </div>

      <p className={styles.caption}>A day in PacedMind, written as a score. Drag along the hours to move through it.</p>
      <p className="sr-only">
        The day: a standup at 08:30 and a focus block for the pricing page from 09:00 to 11:00. You start WEB-10 in the
        Claude app at 09:10; when it finishes at 09:52, WEB-12 starts on its own in a terminal and finishes at 10:42.
        Codex works on APP-31 in a terminal from 09:40 to 11:10. PacedMind books their checks right after your focus
        block, at 11:00, 11:15 and 11:30. When you mark WEB-12 done at 11:20, WEB-14 starts in Codex cloud; it finishes
        at 13:20, and its check is at 13:30, after lunch with Ana. You book the dentist at 14:00 and prepare the Q4
        slides before they’re due at 17:00. At 18:00 WEB-16 starts on its own in a terminal, and WEB-17 carries on in
        the same session.
      </p>
    </div>
  );
}
