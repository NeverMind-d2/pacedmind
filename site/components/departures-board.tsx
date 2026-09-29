"use client";

import { memo, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Wordmark } from "./wordmark";
import s from "./departures-board.module.css";

// The day's agent sessions as a departures board: every few seconds one of them moves on, and its row flips to show
// it, letter by letter, like a split-flap board. The same day as the day strip and the command palette.

type Row = { time: string; key: string; title: string; agent: string; where: string; status: string };

// The board at 11:05: WEB-10 is done after your 11:00 check, APP-31 is still running, WEB-12 has waited since 10:42.
// Nothing starts by itself: WEB-14 and WEB-16 get their times when you start them.
const DAY: Row[] = [
  { time: "09:10", key: "WEB-10", title: "Draft the home page", agent: "Claude Code", where: "Claude app", status: "Done" },
  { time: "09:40", key: "APP-31", title: "Fix calendar sync after sleep", agent: "Codex", where: "Terminal", status: "Running" },
  { time: "09:52", key: "WEB-12", title: "Write the pricing page", agent: "Claude Code", where: "Terminal", status: "Waiting for you" },
  { time: "", key: "WEB-14", title: "Compress the hero images", agent: "Codex", where: "Codex cloud", status: "Waits for WEB-12" },
  { time: "", key: "WEB-16", title: "Draft the launch announcement", agent: "Claude Code", where: "Terminal", status: "Not started" },
];
// The rest of the day, one row at a time; then a new day, and the board starts over.
const STEPS: ([number, Partial<Row>] | "new day")[] = [
  [1, { status: "Waiting for you" }], // 11:10, APP-31 hands back
  [2, { status: "Done" }], // 11:20, in WEB-12's check
  [3, { time: "11:20", status: "Running" }], // and you send WEB-14 to Codex cloud
  [1, { status: "Done" }], // after APP-31's 11:30 check
  [3, { status: "Waiting for you" }], // 13:20, PacedMind notices Codex cloud is done
  [3, { status: "Done" }], // after its 13:30 check
  [4, { time: "18:00", status: "Running" }], // 18:00, you allow the start you asked for in a chat
  [4, { status: "Waiting for you" }], // 18:47
  "new day",
];
// How many characters each column holds, and what a changing flap riffles through on its way.
const WIDTH = { time: 5, key: 6, title: 29, agent: 11, where: 11, status: 22 };
const POOL = {
  title: DAY.map((d) => d.title),
  agent: ["Claude Code", "Codex"],
  where: ["Terminal", "Claude app", "Codex app", "Codex cloud"],
};
// The characters sit on a drum in this order: a flap reaches its letter through the ones before it.
const DRUM = " ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:-";
const GAP = 3600;

const fit = (text: string, n: number) => text.padEnd(n).slice(0, n);
const tone = (status: string) => (status === "Waiting for you" ? s.wait : status === "Done" ? s.done : "");

const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (cb: () => void) => {
  const m = window.matchMedia(motionQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

// A run of one-letter flaps, and a wide flap that shows a whole name. Each flap draws its two halves from data-t
// (the top) and data-b (the bottom), so the server's HTML is the first board and carries no text twice.
function Run({ part, text, n }: { part: keyof typeof WIDTH; text: string; n: number }) {
  return (
    <span className={s.run} data-part={part}>
      {Array.from(fit(text, n), (c, i) => <span key={i} className={s.flap} data-t={c} data-b={c} />)}
    </span>
  );
}
function Blind({ part, text, small = false }: { part: keyof typeof WIDTH; text: string; small?: boolean }) {
  return <span className={`${s.flap} ${s.wide} ${small ? s.small : ""}`} data-part={part} data-t={text} data-b={text}
    style={{ "--n": WIDTH[part] } as CSSProperties} />;
}

/** The rows, as the server draws them. They never render again: from here the script flips them in place. */
const Rows = memo(function Rows() {
  return DAY.map((r, i) => (
    <div key={r.key} className={`${s.row} ${tone(r.status)}`} data-row={i}>
      <Run part="time" text={r.time} n={WIDTH.time} />
      <Run part="key" text={r.key} n={WIDTH.key} />
      <span className={s.titleCell}><Blind part="title" text={r.title} /></span>
      <span className={s.meta}>
        <Blind part="agent" text={r.agent} small />
        <Blind part="where" text={r.where} small />
      </span>
      <span className={s.status}>
        <span className={s.lamp} />
        <Run part="status" text={r.status} n={WIDTH.status} />
      </span>
    </div>
  ));
});

type Flap = { el: HTMLElement; v: string; wide: boolean; top?: HTMLElement; bottom?: HTMLElement };
type Line = { el: HTMLElement; data: Row; runs: Record<"time" | "key" | "status", Flap[]>; blinds: Record<"title" | "agent" | "where", Flap> };
type Engine = { pause: (paused: boolean) => void; stop: () => void };

const sleep = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms));

/**
 * Runs the board in the DOM the server drew: it waits until the board is first seen, riffles every row once, then
 * moves one session on every few seconds. It runs only while the board is on screen and the page is visible, and
 * stops when paused. `report` hears each new state, for the screen-reader table.
 */
function run(root: HTMLElement, paused: boolean, report: (rows: Row[]) => void): Engine {
  let dead = false, onScreen = false, visible = !document.hidden, busy = false, entered = false, timer = 0, at = 0;
  const alive = () => !dead;

  const lines: Line[] = [...root.querySelectorAll<HTMLElement>("[data-row]")].map((el, i) => {
    const run = (part: string) => [...el.querySelectorAll<HTMLElement>(`[data-part="${part}"] > span`)]
      .map((f) => ({ el: f, v: f.dataset.t ?? " ", wide: false }));
    const blind = (part: string) => {
      const f = el.querySelector<HTMLElement>(`[data-part="${part}"]`)!;
      return { el: f, v: f.dataset.t ?? "", wide: true };
    };
    return {
      el, data: { ...DAY[i] },
      runs: { time: run("time"), key: run("key"), status: run("status") },
      blinds: { title: blind("title"), agent: blind("agent"), where: blind("where") },
    };
  });

  // One flip: the old top half falls, then the new bottom half falls into place.
  async function flip(f: Flap, to: string, ms: number) {
    if (!f.top || !f.bottom) {
      f.top = document.createElement("span");
      f.top.className = s.leafTop;
      f.bottom = document.createElement("span");
      f.bottom.className = s.leafBottom;
      f.el.append(f.top, f.bottom);
    }
    const { top, bottom } = f;
    const p = `perspective(${f.wide ? 520 : 160}px)`;
    f.el.dataset.t = to;
    top.textContent = f.v;
    top.style.visibility = "visible";
    try {
      await top.animate([{ transform: `${p} rotateX(0deg)` }, { transform: `${p} rotateX(-90deg)`, filter: "brightness(0.45)" }],
        { duration: ms / 2, easing: "cubic-bezier(0.5, 0, 1, 0.5)" }).finished;
      top.style.visibility = "hidden";
      bottom.textContent = to;
      bottom.style.visibility = "visible";
      await bottom.animate([{ transform: `${p} rotateX(90deg)`, filter: "brightness(1.5)" }, { transform: `${p} rotateX(0deg)` }],
        { duration: ms / 2, easing: "cubic-bezier(0, 0.5, 0.5, 1)" }).finished;
    } catch {
      return; // stopped
    }
    bottom.style.visibility = "hidden";
    if (!alive()) return;
    f.el.dataset.b = to;
    f.v = to;
  }

  // The letters a flap shows on its way to `to`: the drum's, up to `max` of them. Forced, it goes once around to
  // the same letter.
  function path(from: string, to: string, max: number, force: boolean) {
    const j = DRUM.indexOf(to);
    if (from === to) {
      if (!force || to === " " || j < 0) return [];
      const k = 2 + Math.floor(Math.random() * 3);
      return Array.from({ length: k + 1 }, (_, n) => DRUM[(j - k + n + DRUM.length) % DRUM.length]);
    }
    if (j < 0) return [to];
    const seq: string[] = [];
    for (let k = Math.max(0, DRUM.indexOf(from)); k !== j;) {
      k = (k + 1) % DRUM.length;
      seq.push(DRUM[k]);
    }
    return seq.slice(-max);
  }

  function setRun(flaps: Flap[], text: string, delay: number, force: boolean) {
    const t = fit(text, flaps.length);
    return Promise.all(flaps.map(async (f, i) => {
      const steps = path(f.v, t[i], 3 + Math.floor(Math.random() * 6), force);
      if (!steps.length) return;
      await sleep(delay + i * 26);
      for (let k = 0; k < steps.length && alive(); k++) await flip(f, steps[k], k === steps.length - 1 ? 130 : 64);
    }));
  }

  async function setBlind(f: Flap, to: string, pool: string[], delay: number, flips: number, force: boolean) {
    if (f.v === to && !force) return;
    await sleep(delay);
    const others = pool.filter((v) => v !== to && v !== f.v).sort(() => Math.random() - 0.5).slice(0, flips);
    for (const v of others) if (alive()) await flip(f, v, 100);
    if (alive() && f.v !== to) await flip(f, to, 170);
  }

  function shade(line: Line) {
    line.el.classList.toggle(s.wait, line.data.status === "Waiting for you");
    line.el.classList.toggle(s.done, line.data.status === "Done");
  }

  // Rewrites a line from left to right, like a board does; only what changes flips, unless forced.
  async function change(line: Line, d: Row, delay: number, force = false) {
    const from = line.data;
    line.data = { ...d };
    if (from.status === "Done" && d.status !== "Done") line.el.classList.remove(s.done);
    let t = delay;
    const next = (changed: boolean, ms: number) => {
      const now = t;
      if (changed || force) t += ms;
      return now;
    };
    const { runs, blinds } = line;
    await Promise.all([
      setRun(runs.time, d.time, next(from.time !== d.time, 90), force),
      setRun(runs.key, d.key, next(from.key !== d.key, 110), force),
      setBlind(blinds.title, d.title, POOL.title, next(from.title !== d.title, 90), 2, force),
      setBlind(blinds.agent, d.agent, POOL.agent, next(from.agent !== d.agent, 60), 1, force),
      setBlind(blinds.where, d.where, POOL.where, next(from.where !== d.where, 90), 2, force),
      setRun(runs.status, d.status, t, force),
    ]);
    if (alive()) shade(line);
  }

  // Puts a line back as the server drew it, at once.
  function place(line: Line, d: Row) {
    line.data = { ...d };
    const set = (f: Flap, v: string) => {
      f.v = v;
      f.el.dataset.t = v;
      f.el.dataset.b = v;
      if (f.top && f.bottom) f.top.style.visibility = f.bottom.style.visibility = "hidden";
    };
    (["time", "key", "status"] as const).forEach((part) => {
      const t = fit(d[part], WIDTH[part]);
      line.runs[part].forEach((f, i) => set(f, t[i]));
    });
    (["title", "agent", "where"] as const).forEach((part) => set(line.blinds[part], d[part]));
    shade(line);
  }

  const can = () => !dead && !paused && onScreen && visible;
  const schedule = (ms: number) => {
    window.clearTimeout(timer);
    if (can()) timer = window.setTimeout(tick, ms);
  };
  async function tick() {
    if (busy || !can()) return;
    busy = true;
    try {
      if (!entered) {
        entered = true;
        await Promise.all(lines.map((line, i) => change(line, line.data, i * 150, true)));
      } else {
        const step = STEPS[at++ % STEPS.length];
        if (step === "new day") await Promise.all(lines.map((line, i) => change(line, DAY[i], i * 150)));
        else await change(lines[step[0]], { ...lines[step[0]].data, ...step[1] }, 0);
        if (alive()) report(lines.map((line) => line.data));
      }
    } finally {
      busy = false;
    }
    schedule(GAP);
  }

  const io = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    schedule(entered ? 1200 : 150);
  }, { threshold: 0.3 });
  io.observe(root);
  const onVisible = () => {
    visible = !document.hidden;
    schedule(1500);
  };
  document.addEventListener("visibilitychange", onVisible);

  return {
    pause(p) {
      paused = p;
      schedule(500);
    },
    stop() {
      dead = true;
      window.clearTimeout(timer);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      root.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      lines.forEach((line, i) => place(line, DAY[i]));
    },
  };
}

/**
 * Today's agent sessions on a departures board. The server draws the board at 11:05; once it's on screen, every
 * row riffles once, then one session moves on every few seconds, until a new day starts it over. It plays only
 * while it's on screen and the page is visible, and the Pause button stops it. With reduced motion (or without
 * scripts) it stays still. Screen readers get the same sessions as a table.
 */
export function DeparturesBoard({ className = "" }: { className?: string }) {
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => false);
  const [rows, setRows] = useState(DAY);
  const [live, setLive] = useState(false);
  const [paused, setPaused] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const pausedNow = useRef(false);

  useEffect(() => {
    const el = root.current;
    if (!el || reduced) return;
    const e = run(el, pausedNow.current, setRows);
    engine.current = e;
    setLive(true);
    return () => {
      e.stop();
      engine.current = null;
      setLive(false);
      setRows(DAY);
    };
  }, [reduced]);

  const toggle = () => {
    const p = !paused;
    pausedNow.current = p;
    setPaused(p);
    engine.current?.pause(p);
  };

  return (
    <div ref={root} data-nosnippet="" className={`${s.wrap} ${className}`}>
      <div className={s.board}>
        <div className={s.head}>
          <span className={s.brand} aria-hidden="true">
            <Wordmark id="departures-wordmark" className={s.wordmark} />
            <span className={s.name}>Departures</span>
          </span>
          <span className={s.today} aria-hidden="true">Today</span>
          {/* Only while the board can move: without scripts, or with reduced motion, there's nothing to pause. */}
          {live && (
            <button type="button" className={s.pause} onClick={toggle} aria-label={paused ? "Resume the board" : "Pause the board"}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" fill="currentColor">
                {paused
                  ? <path d="M2 1.2v7.6a.6.6 0 0 0 .9.5l6.2-3.8a.6.6 0 0 0 0-1L2.9.7a.6.6 0 0 0-.9.5z" />
                  : <><rect x="1" y="1" width="3" height="8" rx="1" /><rect x="6" y="1" width="3" height="8" rx="1" /></>}
              </svg>
              {paused ? "Resume" : "Pause"}
            </button>
          )}
        </div>
        <div className={s.rows} aria-hidden="true">
          <div className={`${s.row} ${s.labels}`}>
            <span>Time</span>
            <span className={s.task}>Task</span>
            <span className={s.agent}>Agent</span>
            <span className={s.where}>Where</span>
            <span>Status</span>
          </div>
          <Rows />
        </div>
        <div className="sr-only">
          <table>
            <caption>Today&apos;s agent sessions</caption>
            <thead>
              <tr>{["Time", "Task", "Agent", "Where", "Status"].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.time || "No time yet"}</td>
                  <td>{r.key} {r.title}</td>
                  <td>{r.agent}</td>
                  <td>{r.where}</td>
                  <td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
