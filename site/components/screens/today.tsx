import { AREA, AppWindow, Group, Header, Icon, Pill, PriorityIcon, StatusIcon, type Status } from "./parts";

// The app's Today view (task-list.tsx and task-row.tsx in the app).

const SCHEDULE = [
  { time: "08:30–08:45", title: "Standup", area: "Work", color: AREA.work, past: true },
  { time: "09:00–11:00", title: "Focus: pricing page", area: "Work", color: AREA.work, now: true },
  { time: "12:30–13:30", title: "Lunch with Ana", area: "Personal", color: AREA.personal },
];

type Row = { key: string; title: string; status: Status; priority: 0 | 2 | 3 | 4; session?: "finished" | "running"; label?: string; due: string };

const DUE: Row[] = [
  { key: "WEB-12", title: "Write the pricing page", status: "review", priority: 2, session: "finished", label: "copy", due: "Today" },
  { key: "APP-31", title: "Fix calendar sync after sleep", status: "progress", priority: 3, session: "running", label: "sync", due: "Today" },
  { key: "WEB-14", title: "Compress the hero images", status: "todo", priority: 3, label: "assets", due: "17:00" },
  { key: "PER-8", title: "Book the dentist", status: "todo", priority: 4, due: "Today" },
  { key: "DEV-3", title: "Renew the domain", status: "done", priority: 0, due: "Today" },
];
const PLANNED: Row[] = [
  { key: "WEB-16", title: "Draft the launch announcement", status: "todo", priority: 3, label: "launch", due: "Fri 2" },
  { key: "PER-39", title: "Call insurance about the car claim", status: "todo", priority: 4, due: "Mon 28" },
];

function TaskRow({ t }: { t: Row }) {
  const done = t.status === "done";
  return (
    <div className="flex h-[38px] shrink-0 items-center gap-2.5 border-b border-app-hover pl-5 pr-4">
      <span className="flex w-4 shrink-0 justify-center"><PriorityIcon priority={t.priority} /></span>
      <span className="w-[54px] shrink-0 font-mono text-[11.5px] text-app-mut2">{t.key}</span>
      <span className="flex w-[18px] shrink-0 justify-center"><StatusIcon status={t.status} /></span>
      <span className={`min-w-0 flex-1 truncate ${done ? "text-app-mut2 line-through" : ""}`}>{t.title}</span>
      {t.session === "finished" && (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] text-app-fg3">
          <span className="h-1.5 w-1.5 rounded-full bg-app-accent" />Session finished
        </span>
      )}
      {t.session === "running" && (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] text-app-mut">
          <span className="h-1.5 w-1.5 rounded-full bg-app-fg3" />Codex running
        </span>
      )}
      {t.label && <Pill><span className="h-1.5 w-1.5 rounded-full bg-app-mut2" />{t.label}</Pill>}
      <span className={`inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[5px] border border-app-ctl px-1.5 text-[11.5px] ${done ? "text-app-dim" : "text-app-fg2"}`}>
        <Icon name="flag" size={11} strokeWidth={2.2} />{t.due}
      </span>
    </div>
  );
}

export function TodayScreen() {
  return (
    <AppWindow id="today" current="Today"
      label="The Today view in PacedMind: the day's schedule with a focus block happening now, and the tasks due today, including a Claude Code session that has finished and is waiting for review.">
      <Header icon="sun" title="Today" sub="Thu, 24 Sep">
        <span className="flex h-7 items-center gap-1.5 rounded-md border border-app-line2 px-2.5 text-[12.5px] text-app-fg2">
          <Icon name="plus" size={13} />New task
        </span>
      </Header>
      <Group name="Schedule" count={SCHEDULE.length} />
      {SCHEDULE.map((e) => (
        <div key={e.time} className={`flex h-[38px] shrink-0 items-center gap-3 border-b border-app-hover pl-5 pr-4 ${e.past ? "text-app-mut2" : ""}`}>
          <span className={`w-[96px] shrink-0 font-mono text-[11.5px] ${e.past ? "text-app-dim" : "text-app-mut"}`}>{e.time}</span>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: e.color }} />
          <span className="min-w-0 flex-1 truncate">{e.title}</span>
          {e.now && <span className="rounded-full bg-app-accent/15 px-2 py-0.5 text-[11.5px] font-medium text-app-accent-fg">Now</span>}
          <span className="w-16 shrink-0 text-right text-[11.5px] text-app-mut2">{e.area}</span>
        </div>
      ))}
      <Group name="Due today" count={DUE.length} />
      {DUE.map((t) => <TaskRow key={t.key} t={t} />)}
      <Group name="Planned for today" count={PLANNED.length} />
      {PLANNED.map((t) => <TaskRow key={t.key} t={t} />)}
    </AppWindow>
  );
}
