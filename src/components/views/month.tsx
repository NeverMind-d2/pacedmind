"use client";

import Link from "next/link";
import { useEffect, useOptimistic, useRef, useState, type DragEvent } from "react";
import { format } from "date-fns";
import { updateTaskAction } from "@/app/actions";
import { dateOnly, fmtDay, fmtTime, parseLocal, timeOf } from "@/lib/dates";
import type { EventOccurrence, Project, Task, TaskContext } from "@/lib/types";
import { Diamond, Icon, StatusIcon } from "../icons";
import { TaskDetail } from "../task-detail";
import { Dot, cx, useAction } from "../ui";
import { PeriodNav, ViewHeader, ViewSwitch, areaColor, isOpenTask, pressable, useSelection } from "./calendar-parts";

const DRAG_TYPE = "application/x-organizer-task";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_ITEMS = 3;

type Filter = "due" | "event" | "plan" | "target";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "due", label: "Deadlines" },
  { value: "event", label: "Activities" },
  { value: "plan", label: "Planned" },
  { value: "target", label: "Project targets" },
];

type Item = { filter: Filter; sort: string } & (
  | { kind: "due" | "plan" | "done"; task: Task; time: string | null; overdue: boolean }
  | { kind: "event"; event: EventOccurrence; past: boolean }
  | { kind: "target"; project: Project }
);

const KIND_ORDER = { due: 0, target: 1, plan: 2, event: 3, done: 4 } as const;

/** Everything with a date, grouped by day in display order. Done tasks sit on their due (or planned) day. */
function itemsByDay(tasks: Task[], events: EventOccurrence[], projects: Project[], today: string, now: string) {
  const map = new Map<string, Item[]>();
  const add = (day: string, item: Item) => {
    const list = map.get(day);
    if (list) list.push(item);
    else map.set(day, [item]);
  };
  for (const t of tasks) {
    if (t.status === "canceled") continue;
    const due = t.dueDate ? dateOnly(t.dueDate) : null;
    if (t.status === "done") {
      const day = due ?? t.plannedDate;
      if (day) add(day, { kind: "done", filter: due ? "due" : "plan", task: t, time: null, overdue: false, sort: t.key });
      continue;
    }
    if (t.dueDate && due) {
      const time = timeOf(t.dueDate);
      add(due, { kind: "due", filter: "due", task: t, time, overdue: time ? t.dueDate < now : due < today, sort: `${time ?? "24:00"}|${t.priority || 5}` });
    }
    if (t.plannedDate && t.plannedDate !== due) {
      add(t.plannedDate, { kind: "plan", filter: "plan", task: t, time: null, overdue: false, sort: String(t.priority || 5) });
    }
  }
  for (const p of projects) if (p.targetDate) add(p.targetDate, { kind: "target", filter: "target", project: p, sort: p.name });
  for (const e of events) add(dateOnly(e.start), { kind: "event", filter: "event", event: e, past: e.end <= now, sort: e.start });
  for (const list of map.values()) list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.sort.localeCompare(b.sort));
  return map;
}

/** True when a drag event happens over the "set as deadline" flag inside a day. */
function onFlag(e: DragEvent) {
  const node = e.target as Node;
  return !!(node instanceof Element ? node : node.parentElement)?.closest("[data-flag]");
}

export function MonthView({
  title, month, days, now, tasks, undated, undatedCount, events, ctx, summary, nav, initialKey,
}: {
  title: string;
  /** "YYYY-MM" */
  month: string;
  /** Every day in the grid, Monday first, whole weeks. */
  days: string[];
  now: string;
  /** Tasks with a due or planned date inside the grid. */
  tasks: Task[];
  undated: Task[];
  undatedCount: number;
  events: EventOccurrence[];
  ctx: TaskContext;
  summary: { text: string; danger?: boolean };
  nav: { prev: string; next: string; month: string; week: string };
  initialKey: string | null;
}) {
  const today = now.slice(0, 10);
  const weeks = days.length / 7;
  const { run } = useAction();
  const [sel, setSel] = useSelection(initialKey);
  const [all, patchTask] = useOptimistic([...tasks, ...undated], (state, p: { id: number; patch: Partial<Task> }) =>
    state.map((t) => (t.id === p.id ? { ...t, ...p.patch } : t)));
  const [show, setShow] = useState<Record<Filter, boolean>>({ due: true, event: true, plan: true, target: true });
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [over, setOver] = useState<{ day: string; flag: boolean } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rows, setRows] = useState(MAX_ITEMS + 1);
  const gridRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // How many 25px lines (an item or the "+N more" button) fit under the day number of one cell.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setRows(Math.max(1, Math.floor((entry.contentRect.height / weeks - 37) / 25))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks]);

  useEffect(() => {
    if (!expanded) return;
    const onDown = (e: MouseEvent) => { if (!popRef.current?.contains(e.target as Node)) setExpanded(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [expanded]);

  const selected = all.find((t) => t.key === sel) ?? null;
  const byDay = itemsByDay(all.filter((t) => t.dueDate || t.plannedDate), events, ctx.projects, today, now);
  const noDate = all.filter((t) => !t.dueDate && !t.plannedDate && isOpenTask(t));
  const toggle = (t: Task) => setSel((s) => (s === t.key ? null : t.key));

  const drop = (task: Task, day: string, asDeadline: boolean) => {
    if (asDeadline) {
      const time = timeOf(task.dueDate);
      const dueDate = time ? `${day}T${time}` : day;
      if (dueDate === task.dueDate) return;
      run(() => {
        patchTask({ id: task.id, patch: { dueDate } });
        return updateTaskAction(task.id, { dueDate });
      }, `${task.key} is now due ${fmtDay(day)}`);
    } else if (task.plannedDate !== day) {
      run(() => {
        patchTask({ id: task.id, patch: { plannedDate: day } });
        return updateTaskAction(task.id, { plannedDate: day });
      }, `Planned ${task.key} for ${fmtDay(day)}`);
    }
  };

  const dragSource = (task: Task) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, task.key);
      e.dataTransfer.setData("text/plain", `${task.key} ${task.title}`);
      e.dataTransfer.effectAllowed = "move";
      // Restyling the dragged element inside dragstart can cancel the drag in Chromium.
      setTimeout(() => setDragKey(task.key), 0);
    },
    onDragEnd: () => {
      setDragKey(null);
      setOver(null);
    },
  });

  const dropTarget = (day: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const flag = onFlag(e);
      setOver((o) => (o?.day === day && o.flag === flag ? o : { day, flag }));
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o?.day === day ? null : o));
    },
    onDrop: (e: DragEvent) => {
      const task = all.find((t) => t.key === e.dataTransfer.getData(DRAG_TYPE));
      if (!task) return;
      e.preventDefault();
      setOver(null);
      setDragKey(null);
      drop(task, day, onFlag(e));
    },
  });

  const renderItem = (it: Item) => {
    const pill = "flex h-[22px] w-full min-w-0 shrink-0 items-center gap-[5px] overflow-hidden whitespace-nowrap rounded-[5px] border px-1.5 text-left text-[11.5px]";
    if (it.kind === "event") {
      const e = it.event;
      return (
        <div key={`e${e.eventId}-${e.start}`} title={`${fmtTime(e.start)}–${fmtTime(e.end)} ${e.title}`}
          className={cx(pill, "border-transparent", it.past ? "text-mut2" : "text-fg3")}>
          <Dot color={areaColor(ctx.areas, e.areaId)} size={6} />
          <span className="shrink-0 font-mono text-[10.5px] text-mut2">{fmtTime(e.start)}</span>
          <span className="truncate">{e.title}</span>
        </div>
      );
    }
    if (it.kind === "target") {
      const p = it.project;
      return (
        <Link key={`p${p.id}`} href={`/project/${p.id}`} title={`${p.name} target date`} className={cx(pill, "border-line2 bg-hover text-fg2 hover:bg-sel")}>
          <Diamond color={areaColor(ctx.areas, p.areaId)} size={10} />
          <span className="truncate">{p.name}</span>
        </Link>
      );
    }
    const t = it.task;
    const tone = it.kind === "done" ? "border-transparent text-[#6a6a70] hover:bg-hover"
      : it.kind === "plan" ? "border-line2 bg-hover text-fg3 hover:bg-sel"
      : it.overdue ? "border-white/5 bg-white/5 text-danger hover:bg-white/[0.08]"
      : dateOnly(t.dueDate ?? "") === today ? "border-white/5 bg-white/5 text-fg2 hover:bg-white/[0.08]"
      : "border-line2 bg-hover text-fg3 hover:bg-sel";
    return (
      <div key={`${it.kind}${t.id}`} title={`${t.key} ${t.title}`} {...pressable(() => toggle(t))} {...(it.kind === "done" ? {} : dragSource(t))}
        className={cx(pill, tone, "cursor-pointer", t.key === sel && "ring-1 ring-accent/70", dragKey === t.key && "opacity-40")}>
        <Icon name={it.kind === "done" ? "check" : it.kind === "plan" ? "calendarCheck" : "flag"} size={11} strokeWidth={it.kind === "done" ? 2.4 : 2.2} className="shrink-0" />
        {it.time && <span className="shrink-0 font-mono text-[10.5px] text-mut2">{it.time}</span>}
        <span className={cx("truncate", it.kind === "done" && "line-through")}>{t.title}</span>
      </div>
    );
  };

  return (
    <div className="flex min-w-0 flex-1">
      <section aria-label="Calendar" className="flex min-w-0 flex-1 flex-col">
        <ViewHeader icon="calendar" title="Calendar" subtitle={title}>
          <PeriodNav unit="month" prev={nav.prev} next={nav.next} today="/calendar" />
          <span className="flex-1" />
          <ViewSwitch value="month" month={nav.month} week={nav.week} />
        </ViewHeader>

        <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line px-5 text-[12px]">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" aria-pressed={show[f.value]} onClick={() => setShow((s) => ({ ...s, [f.value]: !s[f.value] }))}
              className={cx("flex h-[26px] items-center gap-1.5 rounded-[13px] border px-[9px] hover:bg-hover", show[f.value] ? "border-ctl text-fg2" : "border-line text-dim")}>
              <span className={cx("flex items-center", !show[f.value] && "opacity-50")}>
                {f.value === "due" && <Icon name="flag" size={12} strokeWidth={2.2} />}
                {f.value === "event" && <span className="h-[7px] w-[7px] rounded-full bg-mut" />}
                {f.value === "plan" && <Icon name="calendarCheck" size={12} strokeWidth={2.2} className="text-mut" />}
                {f.value === "target" && <Diamond color="#a1a1a8" size={12} />}
              </span>
              {f.label}
            </button>
          ))}
          <span className="flex-1" />
          <span className={summary.danger ? "text-danger" : "text-mut2"}>{summary.text}</span>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="grid h-8 shrink-0 grid-cols-7 border-b border-line">
              {WEEKDAYS.map((w) => <div key={w} className="flex items-center px-3 text-[11.5px] text-mut2">{w}</div>)}
            </div>
            <div ref={gridRef} className={cx("grid min-h-0 flex-1 grid-cols-7", weeks === 6 ? "grid-rows-6" : "grid-rows-5")}>
              {days.map((day, i) => {
                const items = (byDay.get(day) ?? []).filter((it) => show[it.filter]);
                const visible = items.length <= Math.min(rows, MAX_ITEMS) ? items : items.slice(0, Math.max(0, Math.min(rows - 1, MAX_ITEMS)));
                const hidden = items.length - visible.length;
                const out = !day.startsWith(month);
                const isToday = day === today;
                const isOver = over?.day === day;
                const row = Math.floor(i / 7);
                const col = i % 7;
                return (
                  <div key={day} role="group" aria-label={format(parseLocal(day), "EEEE d MMMM")} {...dropTarget(day)}
                    className={cx("relative flex min-h-0 min-w-0 flex-col gap-[3px] border-b border-[#0e0e10] p-1.5",
                      col < 6 && "border-r", expanded === day ? "z-20" : "overflow-hidden",
                      isOver ? "bg-accent/[0.07] shadow-[inset_0_0_0_1px_rgba(139,142,245,0.55)]" : isToday ? "bg-[#09090a]" : out && "bg-[#030304]")}>
                    <div className="flex h-6 shrink-0 items-center gap-1 px-0.5">
                      <Link href={`/calendar/week?w=${day}`} title="Open this week"
                        className={cx("inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[12px]",
                          isToday ? "bg-accent font-semibold text-bg" : cx("font-medium hover:bg-hover", out ? "text-[#4d4d52]" : day < today ? "text-mut2" : "text-fg2"))}>
                        {day.endsWith("-01") ? format(parseLocal(day), "d MMM") : Number(day.slice(8))}
                      </Link>
                      {isOver && dragKey && (
                        <span data-flag title="Drop here to make it the due date"
                          className={cx("ml-auto flex h-5 items-center gap-1 rounded-[5px] border px-1.5 text-[11px]",
                            over.flag ? "border-accent/60 bg-accent/15 text-accent-fg" : "border-line2 bg-panel text-mut")}>
                          <Icon name="flag" size={10} strokeWidth={2.4} />Due
                        </span>
                      )}
                    </div>
                    {visible.map(renderItem)}
                    {hidden > 0 && (
                      <button type="button" onClick={() => setExpanded(day)}
                        className="h-5 shrink-0 rounded-[5px] px-1.5 text-left text-[11.5px] text-mut2 hover:bg-hover">
                        +{hidden} more
                      </button>
                    )}
                    {expanded === day && (
                      <div ref={popRef} role="dialog" aria-label={format(parseLocal(day), "EEEE d MMMM")}
                        className={cx("absolute z-30 flex max-h-[320px] w-[calc(100%+2px)] min-w-[240px] flex-col gap-[3px] overflow-y-auto rounded-lg border border-line2 bg-raised p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.6)]",
                          row >= weeks / 2 ? "-bottom-px" : "-top-px", col === 6 ? "-right-px" : "-left-px")}>
                        <div className="flex h-6 shrink-0 items-center px-1 text-[12px] font-medium text-fg2">
                          <span className="flex-1">{format(parseLocal(day), "EEE d MMM")}</span>
                          <button type="button" aria-label="Close" onClick={() => setExpanded(null)}
                            className="flex h-5 w-5 items-center justify-center rounded text-mut2 hover:bg-hover">
                            <Icon name="x" size={12} />
                          </button>
                        </div>
                        {items.map(renderItem)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {!selected && (
            <aside aria-label="Tasks without a date" className="flex w-[280px] shrink-0 flex-col border-l border-line">
              <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
                <h2 className="text-[12.5px] font-medium text-fg2">No date</h2>
                <span className="text-[12px] text-mut2">{undatedCount - (undated.length - noDate.length)}</span>
              </div>
              <p className="px-4 pb-2 pt-3 text-[12px] leading-normal text-mut2">
                Drag a task onto a day to plan it. Drop it on the deadline flag to set a due date instead.
              </p>
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2.5 pb-3 pt-1">
                {noDate.map((t) => (
                  <div key={t.id} title={`${t.key} ${t.title}`} {...pressable(() => toggle(t))} {...dragSource(t)}
                    className={cx("flex h-[34px] shrink-0 cursor-grab items-center gap-2 rounded-md border px-2 active:cursor-grabbing",
                      dragKey === t.key ? "border-dashed border-[#252528] text-dim" : "border-line text-fg2 hover:bg-hover")}>
                    <Grip />
                    <StatusIcon status={t.status} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px]">{t.title}</span>
                    {t.areaId && <Dot color={areaColor(ctx.areas, t.areaId)} size={7} />}
                  </div>
                ))}
                {!noDate.length && <div className="px-1.5 py-2 text-[12px] text-mut2">Every open task has a date.</div>}
                {undatedCount > undated.length && (
                  <div className="px-1.5 py-1 text-[12px] text-mut2">and {undatedCount - undated.length} more</div>
                )}
              </div>
            </aside>
          )}
        </div>
      </section>
      {selected && <TaskDetail key={`${selected.id}-${selected.updatedAt}`} task={selected} ctx={ctx} onClose={() => setSel(null)} />}
    </div>
  );
}

function Grip() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" className="shrink-0">
      {[3, 7, 11].flatMap((y) => [3, 7].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" fill="#4d4d52" />))}
    </svg>
  );
}
