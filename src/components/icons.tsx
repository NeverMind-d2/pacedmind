import type { Priority, Status } from "@/lib/types";

type IconProps = { size?: number; className?: string; strokeWidth?: number };

const P = {
  inbox: "M22 12h-6l-2 3h-4l-2-3H2 M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z",
  sun: "M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0 M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  clock: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M12 7v5l3 2",
  calendar: "M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M3 9h18M8 2v4M16 2v4",
  calendarCheck: "M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M3 9h18 M9 15l2 2 4-4",
  timeline: "M4 6h9M9 12h11M6 18h8",
  roadmap: "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15",
  flow: "M4 4h6v6H4z M14 14h6v6h-6z M10 7h2a3 3 0 0 1 3 3v4",
  terminal: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M7 10l3 2-3 2 M12 15h5",
  settings: "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1",
  search: "M4 11a7 7 0 1 0 14 0a7 7 0 1 0 -14 0 M20 20l-3.5-3.5",
  pen: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  chevronLeft: "M15 18l-6-6 6-6",
  flag: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.9 1.9 0 0 0 3.4 0",
  tag: "M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z M7.5 7.5h.01",
  layers: "M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5M2 12l10 5 10-5",
  x: "M18 6L6 18M6 6l12 12",
  check: "M5 12l5 5 9-10",
  trash: "M3 6h18 M8 6V4h8v2 M6 6l1 14h10l1-14",
  link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7 M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  repeat: "M17 2l4 4-4 4 M3 11V10a4 4 0 0 1 4-4h14 M7 22l-4-4 4-4 M21 13v1a4 4 0 0 1-4 4H3",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  hourglass: "M6 2h12 M6 22h12 M7 2c0 5 10 7 10 10s-10 5-10 10 M17 2c0 5-10 7-10 10s10 5 10 10",
  folder: "M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  play: "M7 4l12 8-12 8z",
  refresh: "M21 12a9 9 0 1 1-3-6.7L21 8 M21 3v5h-5",
  more: "M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
  box: "M21 8l-9-5-9 5v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8",
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 16, className, strokeWidth = 1.8 }: IconProps & { name: IconName }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}

const STATUS_SHAPE: Record<Status, { ring: string; dash?: string; fill?: string; fillD?: string; mark?: string }> = {
  backlog: { ring: "#7a7a80", dash: "2 2" },
  todo: { ring: "#bdbdc3" },
  progress: { ring: "#a1a1a8", fill: "#a1a1a8", fillD: "M7 3 A4 4 0 0 1 7 11 Z" },
  review: { ring: "#bdbdc3", fill: "#bdbdc3", fillD: "M7 7 L7 3 A4 4 0 1 1 3 7 Z" },
  done: { ring: "#8b8ef5", fill: "#8b8ef5", fillD: "M1 7 A6 6 0 1 0 13 7 A6 6 0 1 0 1 7 Z", mark: "M4.4 7.2 L6.2 9 L9.7 5.3" },
  canceled: { ring: "#5e5e64", fill: "#5e5e64", fillD: "M1 7 A6 6 0 1 0 13 7 A6 6 0 1 0 1 7 Z", mark: "M5 5 L9 9 M9 5 L5 9" },
};

export function StatusIcon({ status, size = 14 }: { status: Status; size?: number }) {
  const s = STATUS_SHAPE[status];
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="6" fill="none" stroke={s.ring} strokeWidth="1.5" strokeDasharray={s.dash} />
      {s.fillD && <path d={s.fillD} fill={s.fill} />}
      {s.mark && <path d={s.mark} fill="none" stroke="#040405" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  if (priority === 1) {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
        <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="#c4c4ca" />
        <rect x="6.1" y="3" width="1.8" height="5" rx="0.9" fill="#040405" />
        <rect x="6.1" y="9.2" width="1.8" height="1.8" rx="0.9" fill="#040405" />
      </svg>
    );
  }
  const on = "#bdbdc3";
  const off = "#252528";
  const lit = priority === 2 ? 3 : priority === 3 ? 2 : priority === 4 ? 1 : 0;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <rect x="1" y="8" width="3" height="5" rx="1" fill={lit >= 1 ? on : off} />
      <rect x="5.5" y="5" width="3" height="8" rx="1" fill={lit >= 2 ? on : off} />
      <rect x="10" y="2" width="3" height="11" rx="1" fill={lit >= 3 ? on : off} />
    </svg>
  );
}

export function ProgressRing({ pct, color, size = 14 }: { pct: number; color: string; size?: number }) {
  const c = 34.56;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="#1a1a1d" strokeWidth="2" />
      <circle cx="8" cy="8" r="5.5" fill="none" stroke={color} strokeWidth="2" strokeDasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 8 8)" />
    </svg>
  );
}

export function Diamond({ color, size = 11, hollow = false }: { color: string; size?: number; hollow?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1l5 5-5 5-5-5z" fill={hollow ? "#040405" : color} stroke={color} strokeWidth={hollow ? 1.6 : 0} />
    </svg>
  );
}
