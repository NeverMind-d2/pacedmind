import type { CSSProperties, ReactNode } from "react";
import { AREA, AppWindow, Header, Icon, Pill, Segmented, tint } from "./parts";

// The app's Timeline view (views/timeline.tsx in the app): three weeks, grouped by area.

const TREE = 250;
const GRID_W = 572;
const DAYS = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const WEEKEND = new Set([5, 6, 12, 13, 19, 20]);
const TODAY = 3;
const DAY_W = GRID_W / DAYS.length;
const X = (day: number) => day * DAY_W;
const LOADS = [0.5, 2.5, 3, 5.5, 4, 0, 0, 3, 2, 1.5, 1, 2, 0, 0, 1.5, 0.5, 1, 1, 0.5, 0, 0];
const WEEKS: [string, number][] = [["Week 39 · 21 Sep", 0], ["Week 40 · 28 Sep", 7], ["Week 41 · 5 Oct", 14]];

type Look = "done" | "waiting" | "active" | "planned";
type Row =
  | { kind: "area"; name: string; color: string }
  | { kind: "project"; name: string; color: string; count: string; from: number; to: number; progress: number }
  | {
    kind: "task"; key: string; title: string; color: string; look: Look; from: number; to: number; text: string; due?: number;
    sessions?: [number, number, "done" | "finished" | "running"][];
  };

const ROWS: Row[] = [
  { kind: "area", name: "Dev", color: AREA.dev },
  { kind: "project", name: "PacedMind website", color: AREA.dev, count: "2 of 6", from: 0, to: 17, progress: 0.34 },
  { kind: "task", key: "WEB-10", title: "Draft the home page", color: AREA.dev, look: "done", from: 0, to: 2, text: "Done", sessions: [[0, 1.6, "done"]] },
  { kind: "task", key: "WEB-12", title: "Write the pricing page", color: AREA.dev, look: "waiting", from: 2, to: 4, text: "Waiting for you", sessions: [[3, 3.6, "finished"]] },
  { kind: "task", key: "APP-31", title: "Fix calendar sync after sleep", color: AREA.dev, look: "active", from: 3, to: 5, text: "Codex running", sessions: [[3.2, 3.55, "running"]] },
  { kind: "task", key: "WEB-14", title: "Compress the hero images", color: AREA.dev, look: "planned", from: 4, to: 5, text: "Planned", due: 4 },
  { kind: "task", key: "WEB-16", title: "Draft the launch announcement", color: AREA.dev, look: "planned", from: 5, to: 11, text: "Planned", due: 11 },
  { kind: "area", name: "Work", color: AREA.work },
  { kind: "project", name: "Q4 planning", color: AREA.work, count: "1 of 4", from: 0, to: 10, progress: 0.34 },
  { kind: "task", key: "WRK-27", title: "Review Q3 budget draft", color: AREA.work, look: "active", from: 1, to: 3, text: "In progress" },
  { kind: "task", key: "WRK-31", title: "Prepare slides for Q4 planning", color: AREA.work, look: "planned", from: 3, to: 4, text: "Due 17:00", due: 3 },
  { kind: "area", name: "Personal", color: AREA.personal },
  { kind: "task", key: "PER-44", title: "Book movers for moving day", color: AREA.personal, look: "planned", from: 5, to: 6, text: "Planned" },
  { kind: "task", key: "PER-8", title: "Book the dentist", color: AREA.personal, look: "planned", from: 3, to: 4, text: "Planned", due: 3 },
];
const HEIGHT = { area: 30, project: 32, task: 28 };
// Each row's top edge, and the height of them all.
const PLACED: { row: Row; top: number }[] = [];
let bottom = 0;
for (const row of ROWS) {
  PLACED.push({ row, top: bottom });
  bottom += HEIGHT[row.kind];
}
const ROWS_H = bottom;

// The day's dependencies: WEB-12 waits for WEB-10, and WEB-14 for WEB-12. Drawn as the app draws them, from under
// the end of the earlier bar to the start of the later one, where an arrow points into it.
const WAITS: [string, string][] = [["WEB-10", "WEB-12"], ["WEB-12", "WEB-14"]];
const BAR = { top: 4, h: 18, mid: 13 };
const taskAt = (key: string) => PLACED.find((p) => p.row.kind === "task" && p.row.key === key) as { row: Extract<Row, { kind: "task" }>; top: number };
const DEPENDENCIES = WAITS.map(([from, to]) => {
  const a = taskAt(from);
  const b = taskAt(to);
  const x1 = Math.max(X(a.row.from) + 3, X(a.row.to) - 5);
  const y1 = a.top + BAR.top + BAR.h;
  const x2 = X(b.row.from);
  const y2 = b.top + BAR.mid;
  return {
    key: `${from}-${to}`,
    d: `M${x1} ${y1} V${b.top} H${x2 - 6} V${y2} H${x2 - 1}`,
    head: `M${x2 - 5} ${y2 - 3} L${x2 - 1} ${y2} L${x2 - 5} ${y2 + 3}`,
  };
});

const LOOK: Record<Look, (c: string) => CSSProperties & { text: string }> = {
  done: (c) => ({ background: tint(c, 10), border: `1px solid ${tint(c, 22)}`, text: "text-app-mut2" }),
  waiting: (c) => ({ background: tint(c, 20), border: "1px solid color-mix(in srgb, var(--color-app-accent) 70%, transparent)", text: "text-app-fg2" }),
  active: (c) => ({ background: tint(c, 34), border: `1px solid ${tint(c, 62)}`, text: "text-app-strong" }),
  planned: (c) => ({ background: tint(c, 5), border: `1px dashed ${tint(c, 50)}`, text: "text-app-mut" }),
};

function Bars({ row, y }: { row: Row; y: number }) {
  if (row.kind === "area") return null;
  const left = X(row.from) + 1;
  const width = X(row.to) - X(row.from) - 2;
  if (row.kind === "project") {
    return (
      <>
        <div className="absolute overflow-hidden rounded-[4px]"
          style={{ top: y + 8, left, width, height: 16, border: `1px solid ${tint(row.color, 45)}`, background: tint(row.color, 8) }}>
          <div className="h-full" style={{ width: `${row.progress * 100}%`, background: tint(row.color, 30) }} />
        </div>
        <div className="absolute h-[9px] w-[9px] rotate-45 border-[1.5px] border-app-fg3 bg-app-panel" style={{ top: y + 11, left: X(row.to) - 5 }} />
      </>
    );
  }
  const { text: textClass, ...look } = LOOK[row.look](row.color);
  const inside = width > row.text.length * 6 + (row.look === "done" ? 24 : 12);
  let after = left + width + 4;
  const extra: ReactNode[] = [];
  if (row.due !== undefined) {
    extra.push(<span key="due" className="absolute flex text-app-mut" style={{ left: X(row.due) + 2, top: y + 7 }}><Icon name="flag" size={11} strokeWidth={2.4} /></span>);
    after = Math.max(after, X(row.due) + 16);
  }
  if (row.look === "waiting") {
    extra.push(<span key="dot" className="absolute h-[7px] w-[7px] rounded-full bg-app-accent" style={{ left: after, top: y + 10 }} />);
    after += 11;
  }
  return (
    <>
      <div className={`absolute flex items-center gap-[5px] overflow-hidden whitespace-nowrap rounded-[4px] px-1.5 text-[11px] ${textClass}`}
        style={{ ...look, top: y + 4, left, width, height: 18 }}>
        {row.look === "done" && <Icon name="check" size={10} strokeWidth={2.8} />}
        {inside && <span>{row.text}</span>}
      </div>
      {extra}
      {!inside && <span className="absolute whitespace-nowrap text-[11px] leading-4 text-app-mut2" style={{ left: after + 2, top: y + 5 }}>{row.text}</span>}
      {row.sessions?.map(([from, to, kind]) => (
        <span key={from} className="absolute h-[3px] rounded-full" style={{
          top: y + 22.5, left: X(from), width: Math.max(6, X(to) - X(from)),
          background: kind === "running" ? row.color : kind === "finished" ? "var(--color-app-accent)" : tint(row.color, 50),
        }} />
      ))}
    </>
  );
}

export function TimelineScreen() {
  return (
    <AppWindow id="timeline" current="Timeline"
      label="The Timeline view in PacedMind: three weeks of projects and tasks by area, with agent sessions as thin lines under their tasks, arrows into the tasks that wait for others, and today marked.">
      <Header icon="timeline" title="Timeline" sub="21 Sep to 11 Oct 2026">
        <Segmented options={[[null, "Week"], [null, "Month"], [null, "Quarter"]]} current="Month" />
      </Header>
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-app-line pl-5 pr-4">
        <span className="mr-1 text-[12.5px] text-app-mut2">Show</span>
        {["Tasks", "Sessions", "Time blocks", "Deadlines", "Dependencies"].map((l) => (
          <Pill key={l} className="text-app-fg2"><span className="h-[5px] w-[5px] rounded-full bg-app-fg3" />{l}</Pill>
        ))}
        <span className="flex-1" />
        <span className="text-[12px] text-app-mut2">Grouped by area</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="shrink-0 border-r border-app-line" style={{ width: TREE }}>
          <div className="flex h-10 items-center border-b border-app-line px-5 text-[12px] text-app-mut2">Areas, projects and tasks</div>
          <div className="flex h-9 items-center gap-2 border-b border-app-line px-5">
            <span className="font-medium text-app-fg2">Your time</span>
            <span className="text-[11.5px] text-app-mut2">hours planned per day</span>
          </div>
          {PLACED.map(({ row }, i) => (
            <div key={i} className={`flex items-center gap-2 border-b border-app-hover pr-3 text-[12.5px] ${row.kind === "area" ? "bg-app-raised" : ""}`}
              style={{ height: HEIGHT[row.kind] }}>
              {row.kind === "area" && (
                <>
                  <span className="w-3" /><Icon name="chevronDown" size={12} strokeWidth={2.4} className="text-app-mut2" />
                  <span className="h-2 w-2 rounded-full" style={{ background: row.color }} />
                  <span className="font-medium text-app-fg2">{row.name}</span>
                </>
              )}
              {row.kind === "project" && (
                <>
                  <span className="w-[26px]" /><Icon name="chevronDown" size={12} strokeWidth={2.4} className="text-app-mut2" />
                  <svg width="14" height="14" viewBox="0 0 16 16" className="shrink-0">
                    <circle cx="8" cy="8" r="5.5" fill="none" stroke="var(--color-app-line-strong)" strokeWidth="2" />
                    <circle cx="8" cy="8" r="5.5" fill="none" stroke={row.color} strokeWidth="2" strokeDasharray={`${34.56 * row.progress} 34.56`} transform="rotate(-90 8 8)" />
                  </svg>
                  <span className="min-w-0 flex-1 truncate text-app-strong">{row.name}</span>
                  <span className="text-[11.5px] text-app-mut2">{row.count}</span>
                </>
              )}
              {row.kind === "task" && (
                <>
                  <span className="w-11" />
                  <span className="w-[50px] shrink-0 font-mono text-[11px] text-app-mut2">{row.key}</span>
                  <span className={`min-w-0 flex-1 truncate ${row.look === "done" ? "text-app-mut2" : ""}`}>{row.title}</span>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="relative shrink-0 overflow-hidden" style={{ width: GRID_W }}>
          {DAYS.map((_, i) => WEEKEND.has(i) && <div key={i} className="absolute inset-y-0 bg-app-raised" style={{ left: X(i), width: DAY_W }} />)}
          <div className="relative h-10 border-b border-app-line">
            {WEEKS.map(([label, i]) => (
              <span key={label} className="absolute top-[5px] whitespace-nowrap text-[11px] text-app-fg3" style={{ left: X(i) + 6 }}>{label}</span>
            ))}
            {DAYS.map((d, i) => i === TODAY ? (
              <span key={i} className="absolute top-[19px] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-app-accent text-[10.5px] font-semibold text-app-panel"
                style={{ left: X(i) + DAY_W / 2 - 9 }}>{d}</span>
            ) : (
              <span key={i} className={`absolute top-[21px] text-center text-[11px] ${WEEKEND.has(i) ? "text-app-dim" : "text-app-fg3"}`}
                style={{ left: X(i), width: DAY_W }}>{d}</span>
            ))}
          </div>
          <div className="relative h-9 border-b border-app-line">
            {LOADS.map((h, i) => (
              <span key={i} className="absolute rounded-[2px]" style={{
                left: X(i) + DAY_W * 0.22, width: DAY_W * 0.56, bottom: 7, height: Math.max(1.5, h * 3.4),
                background: i === TODAY ? "var(--color-app-fg3)" : h ? "var(--color-app-line-strong)" : "var(--color-app-ctl)",
              }} />
            ))}
          </div>
          <div className="relative" style={{ height: ROWS_H }}>
            {PLACED.map(({ row, top }, i) => (
              <div key={i} className="absolute inset-x-0 h-px bg-app-hover" style={{ top: top + HEIGHT[row.kind] - 1 }} />
            ))}
            {/* Over the rows' lines and under the bars, as in the app. */}
            <svg className="absolute left-0 top-0" width={GRID_W} height={ROWS_H} aria-hidden="true">
              {DEPENDENCIES.map((dep) => (
                <g key={dep.key}>
                  <path d={dep.d} fill="none" stroke="var(--color-app-line-strong)" strokeWidth="1.2" strokeLinejoin="round" />
                  <path d={dep.head} fill="none" stroke="var(--color-app-dim)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </g>
              ))}
            </svg>
            {PLACED.map(({ row, top }, i) => <Bars key={i} row={row} y={top} />)}
          </div>
          <div className="absolute bottom-0 top-10 w-px bg-app-accent opacity-60" style={{ left: X(TODAY + 0.55) }} />
        </div>
      </div>
    </AppWindow>
  );
}
