import { AREA, AppWindow, FLOW_LINE, Icon, Segmented, StatusIcon, type FlowMode } from "./parts";

// The app's Flow view (views/flow.tsx in the app): sessions anywhere on a free grid, each run by its own agent.

const NODE = { w: 216, h: 74 };
type Tone = "done" | "waiting" | "running" | "todo";
type Node = { x: number; y: number; key: string; title: string; agent: string; tone: Tone; state: string; note: string; selected?: boolean };

const NODES: Record<string, Node> = {
  A: { x: 48, y: 28, key: "WEB-10", title: "Draft the home page", agent: "Claude Code", tone: "done", state: "Done", note: "Closed Mon 21" },
  B: { x: 330, y: 150, key: "WEB-12", title: "Write the pricing page", agent: "Claude Code", tone: "waiting", state: "Waiting for you", note: "Finished 10:42" },
  C: { x: 48, y: 214, key: "APP-31", title: "Fix calendar sync after sleep", agent: "Codex", tone: "running", state: "Running", note: "Since 11:05" },
  D: { x: 560, y: 288, key: "WEB-14", title: "Compress the hero images", agent: "Codex", tone: "todo", state: "Not started", note: "After WEB-12", selected: true },
  E: { x: 300, y: 390, key: "WEB-16", title: "Draft the launch announcement", agent: "Claude Code", tone: "todo", state: "Not started", note: "After both" },
};
const EDGES: [string, string, FlowMode, boolean?][] = [["A", "B", "auto"], ["A", "C", "auto", true], ["B", "D", "manual"], ["C", "E", "auto"], ["D", "E", "time"]];
const MODE: Record<FlowMode, { dash?: string; width: number; label: string }> = {
  auto: { ...FLOW_LINE.auto, label: "Auto" },
  manual: { ...FLOW_LINE.manual, label: "Manual" },
  session: { ...FLOW_LINE.session, label: "Same session" },
  time: { ...FLOW_LINE.time, label: "At 18:00" },
};

function ToneIcon({ tone }: { tone: Tone }) {
  if (tone === "done") return <StatusIcon status="done" />;
  if (tone === "running") return <StatusIcon status="progress" />;
  if (tone === "todo") return <StatusIcon status="backlog" />;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
      <circle cx="7" cy="7" r="6" fill="none" stroke="var(--color-app-accent)" strokeWidth="1.5" />
      <circle cx="7" cy="7" r="3" fill="var(--color-app-accent)" />
    </svg>
  );
}

function FlowNode({ n }: { n: Node }) {
  const done = n.tone === "done";
  const handle = (top: boolean) => (
    <span className={`absolute h-2 w-2 rounded-full border-[1.5px] bg-app-panel ${n.selected && !top ? "border-app-accent" : "border-app-line-strong"}`}
      style={{ left: NODE.w / 2 - 4, ...(top ? { top: -4 } : { bottom: -4 }) }} />
  );
  return (
    <div className={`absolute flex flex-col gap-1 rounded-lg border px-3 py-2 ${done ? "border-app-line bg-app-panel" : "bg-app-raised"} ${n.selected ? "border-app-accent shadow-[0_0_0_1px_var(--color-app-accent)]" : done ? "" : "border-app-ctl"}`}
      style={{ left: n.x, top: n.y, width: NODE.w, height: NODE.h }}>
      {handle(true)}
      <div className="flex h-[14px] items-center gap-[7px]">
        <ToneIcon tone={n.tone} />
        <span className="font-mono text-[11px] text-app-mut2">{n.key}</span>
        <span className="flex-1" />
        <span className={`whitespace-nowrap text-[11px] ${n.tone === "waiting" ? "text-app-fg2" : "text-app-mut2"}`}>{n.state}</span>
      </div>
      <div className={`h-[18px] truncate text-[13px] leading-[18px] ${done ? "text-app-mut2" : "text-app-strong"}`}>{n.title}</div>
      <div className="flex min-w-0 items-center gap-[7px]">
        <span className={`inline-flex h-[18px] shrink-0 items-center gap-[5px] rounded-[5px] border px-1.5 text-[11px] ${n.selected ? "border-app-line-strong text-app-fg2" : "border-app-ctl text-app-mut"}`}>
          <Icon name="terminal" size={11} strokeWidth={2} />{n.agent}
          {n.selected && <Icon name="chevronDown" size={10} strokeWidth={2.4} />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-app-mut2">{n.note}</span>
      </div>
      {handle(false)}
    </div>
  );
}

export function FlowScreen() {
  const edges = EDGES.map(([s, t, mode, live]) => {
    const S = NODES[s];
    const T = NODES[t];
    const sx = S.x + NODE.w / 2;
    const sy = S.y + NODE.h + 4;
    const tx = T.x + NODE.w / 2;
    const ty = T.y - 9;
    const dy = Math.max(36, (ty - sy) / 2);
    return { id: `${s}${t}`, mode, live, d: `M ${sx} ${sy} C ${sx} ${sy + dy}, ${tx} ${ty - dy}, ${tx} ${ty}`, tx, ty, label: { x: (sx + tx) / 2, y: (sy + ty) / 2 } };
  });
  const from = { x: NODES.D.x + NODE.w / 2, y: NODES.D.y + NODE.h + 4 };
  const cursor = { x: 720, y: 470 };
  return (
    <AppWindow id="flow" current="Flows"
      label="The Flow view in PacedMind: agent sessions placed freely on a grid and connected, each run by Claude Code or Codex, with one connection being drawn.">
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-app-line pl-5 pr-4">
        <span className="h-2 w-2 rounded-full" style={{ background: AREA.dev }} />
        <span className="text-[14px] font-semibold text-app-strong">PacedMind website</span>
        <Icon name="chevronDown" size={12} strokeWidth={2.4} className="text-app-mut2" />
        <Segmented options={[["roadmap", "Roadmap"], ["flow", "Flow"]]} current="Flow" />
        <span className="text-[12px] text-app-mut2">1 waiting for you · 1 running · 2 not started</span>
        <span className="flex-1" />
        <span className="flex h-7 items-center rounded-md border border-app-line2 px-2.5 text-[12.5px] text-app-fg2">Tidy up</span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-app-bg"
        style={{ backgroundImage: "radial-gradient(circle, var(--color-app-ctl) 1px, transparent 1.3px)", backgroundSize: "24px 24px", backgroundPosition: "12px 12px" }}>
        <svg className="absolute left-0 top-0 overflow-visible" width="826" height="540" aria-hidden="true">
          {edges.map((e) => (
            <g key={e.id}>
              <path d={e.d} fill="none" stroke={e.live ? "var(--color-app-fg3)" : "var(--color-app-line-strong)"}
                strokeWidth={MODE[e.mode].width} strokeDasharray={MODE[e.mode].dash} strokeLinecap="round" />
              {e.live && <path d={e.d} fill="none" stroke="var(--color-app-accent)" strokeWidth="2.5" strokeDasharray="14 600" strokeLinecap="round" className="flowing" />}
              <path d={`M ${e.tx - 4} ${e.ty - 6} L ${e.tx} ${e.ty} L ${e.tx + 4} ${e.ty - 6}`} fill="none"
                stroke={e.live ? "var(--color-app-fg3)" : "var(--color-app-line-strong)"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          ))}
          <path d={`M ${from.x} ${from.y} C ${from.x} ${from.y + 50}, ${cursor.x} ${cursor.y - 50}, ${cursor.x} ${cursor.y}`} fill="none"
            stroke="var(--color-app-accent)" strokeWidth="1.5" strokeDasharray="4 4" strokeLinecap="round" />
          <circle cx={cursor.x} cy={cursor.y} r="4" fill="var(--color-app-accent)" />
        </svg>
        {edges.map((e) => (
          <span key={e.id} className="absolute flex h-5 -translate-x-1/2 -translate-y-1/2 items-center rounded-full border border-app-ctl bg-app-panel px-2 text-[11px] text-app-mut"
            style={{ left: e.label.x, top: e.label.y }}>{MODE[e.mode].label}</span>
        ))}
        {Object.values(NODES).map((n) => <FlowNode key={n.key} n={n} />)}
        <svg width="18" height="18" viewBox="0 0 24 24" className="absolute" style={{ left: cursor.x + 6, top: cursor.y + 2 }} aria-hidden="true">
          <path d="M5 3l14 8-6 1.5L10 19z" fill="var(--color-app-strong)" stroke="var(--color-app-panel)" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <div className="absolute bottom-4 left-4 flex flex-col gap-[7px] rounded-lg border border-app-line bg-app-panel px-3 py-2.5 text-[11.5px] text-app-mut">
          <span className="text-app-mut2">How the next session starts</span>
          {(["auto", "manual", "session", "time"] as FlowMode[]).map((m) => (
            <span key={m} className="flex items-center gap-2.5">
              <svg width="26" height="6" viewBox="0 0 26 6" className="shrink-0">
                <path d="M 1 3 L 25 3" stroke="var(--color-app-fg3)" strokeWidth={MODE[m].width} strokeDasharray={MODE[m].dash} strokeLinecap="round" />
              </svg>
              {{ auto: "Automatically", manual: "After you mark it done", session: "Same session, no stop", time: "At a set time" }[m]}
            </span>
          ))}
        </div>
        <div className="absolute bottom-4 right-4 flex items-center rounded-[7px] border border-app-line bg-app-panel text-[12px] text-app-mut">
          <span className="flex h-7 w-7 items-center justify-center"><Icon name="minus" size={13} /></span>
          <span className="px-1">100%</span>
          <span className="flex h-7 w-7 items-center justify-center"><Icon name="plus" size={13} /></span>
        </div>
      </div>
    </AppWindow>
  );
}
