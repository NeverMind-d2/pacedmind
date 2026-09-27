"use client";

import { useEffect, useState, type ReactNode } from "react";
import { fmtTime, toDateTimeStr } from "@/lib/dates";
import type { EventOccurrence, Task, TaskContext } from "@/lib/types";
import { openActivity } from "./activity-editor";
import { Icon, type IconName } from "./icons";
import type { QuickAddDefaults } from "./quick-add";
import { TaskDetail } from "./task-detail";
import { TaskRow } from "./task-row";
import { Button, Segmented, cx } from "./ui";

export interface TaskGroup {
  id: string;
  name: string;
  tasks: Task[];
  tone?: "danger";
  /** Defaults for the quick-add opened from this group's + button. */
  add?: { plannedDate?: string; projectId?: string; areaId?: string };
}

export function openAdd(detail: QuickAddDefaults = {}) {
  window.dispatchEvent(new CustomEvent("organizer:new", { detail }));
}

export function TaskList({
  icon, mark, title, subtitle, groups, schedule, ctx, initialKey, empty, headerRight, addDefaults,
}: {
  icon: IconName;
  /** Shown instead of the icon, such as an area's own icon. */
  mark?: ReactNode;
  title: string;
  subtitle?: string;
  groups: TaskGroup[];
  schedule?: EventOccurrence[];
  ctx: TaskContext;
  initialKey?: string | null;
  empty?: ReactNode;
  headerRight?: ReactNode;
  addDefaults?: QuickAddDefaults;
}) {
  const [sel, setSel] = useState<string | null>(initialKey ?? null);
  const [filter, setFilter] = useState<"all" | "tasks" | "activities">("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ done: true, canceled: true });
  const all = groups.flatMap((g) => g.tasks);
  const selected = all.find((t) => t.key === sel) ?? null;
  const now = toDateTimeStr(new Date());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement).closest("input, textarea, [role=dialog]")) setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const open = all.filter((t) => t.status !== "done" && t.status !== "canceled").length;
  const showTasks = filter !== "activities";
  const showSchedule = !!schedule && filter !== "tasks";

  return (
    <div className="flex min-w-0 flex-1">
      <section aria-label={title} className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line pl-5 pr-4">
          {mark ?? <Icon name={icon} className="shrink-0 text-mut" />}
          <h1 className="min-w-0 truncate text-[14px] font-semibold text-strong">{title}</h1>
          {subtitle && <span className="min-w-0 shrink-[3] truncate text-mut2">{subtitle}</span>}
          <span className="flex-1" />
          {headerRight}
          <Button onClick={() => openAdd(addDefaults)} aria-label="New task"><Icon name="plus" size={13} /><span className="max-sm:hidden">New task</span></Button>
        </div>

        {schedule && (
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-5">
            <Segmented value={filter} onChange={setFilter} options={[
              { value: "all", label: "All" }, { value: "tasks", label: "Tasks" }, { value: "activities", label: "Activities" },
            ]} />
            <span className="flex-1" />
            <span className="text-[12px] text-mut2">{open} open · {all.length - open} done</span>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {showSchedule && schedule!.length > 0 && (
            <>
              <GroupHeader name="Schedule" count={schedule!.length} onAdd={() => openAdd({ mode: "activity" })} />
              {schedule!.map((e) => {
                const past = e.end <= now;
                const current = e.start <= now && now < e.end;
                const area = ctx.areas.find((a) => a.id === e.areaId);
                return (
                  <button key={`${e.eventId}-${e.start}`} type="button" onClick={() => openActivity(e)}
                    className={cx("flex h-[38px] w-full items-center gap-3 border-b border-hover pl-5 pr-4 text-left hover:bg-hover", past ? "text-mut2" : "text-fg")}>
                    <span className={cx("w-[96px] shrink-0 font-mono text-[11.5px]", past ? "text-dim" : "text-mut")}>{fmtTime(e.start)}–{fmtTime(e.end)}</span>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: area?.color ?? "var(--color-mut2)" }} />
                    <span className="min-w-0 flex-1 truncate">{e.title}</span>
                    {current && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11.5px] font-medium text-accent-fg">Now</span>}
                    <span className="w-16 shrink-0 text-right text-[11.5px] text-mut2">{area?.name}</span>
                  </button>
                );
              })}
            </>
          )}
          {showTasks && groups.map((g) => (
            <div key={g.id}>
              <GroupHeader name={g.name} count={g.tasks.length} tone={g.tone} collapsed={collapsed[g.id]}
                onToggle={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}
                onAdd={() => openAdd({ ...addDefaults, ...g.add })} />
              {!collapsed[g.id] && g.tasks.map((t) => (
                <TaskRow key={t.id} task={t} ctx={ctx} selected={t.key === sel} onSelect={() => setSel(t.key === sel ? null : t.key)} />
              ))}
            </div>
          ))}
          {!all.length && (!schedule || !schedule.length) && (
            <div className="flex flex-col items-center gap-3 px-8 py-24 text-center">
              <div className="text-[14px] text-fg2">{empty ?? "No tasks here yet"}</div>
              <div className="text-[12.5px] text-mut2">Press <span className="rounded border border-ctl px-1.5 font-mono text-[11px]">C</span> anywhere to add a task.</div>
            </div>
          )}
        </div>
      </section>
      {selected && <TaskDetail key={`${selected.id}-${selected.updatedAt}`} task={selected} ctx={ctx} onClose={() => setSel(null)} />}
    </div>
  );
}

function GroupHeader({ name, count, tone, collapsed, onToggle, onAdd }: {
  name: string; count: number; tone?: "danger"; collapsed?: boolean; onToggle?: () => void; onAdd?: () => void;
}) {
  return (
    <div className="flex h-[34px] items-center gap-2 border-b border-line bg-raised pl-5 pr-4 text-[12.5px] font-medium text-fg2">
      <button type="button" onClick={onToggle} className="flex items-center gap-2" aria-expanded={!collapsed}>
        <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={12} strokeWidth={2.4} className="text-mut2" />
        <span className={tone === "danger" ? "text-danger" : ""}>{name}</span>
        <span className="font-normal text-mut2">{count}</span>
      </button>
      <span className="flex-1" />
      {onAdd && (
        <button type="button" aria-label={`Add to ${name}`} onClick={onAdd} className="flex h-[22px] w-[22px] items-center justify-center rounded text-mut2 hover:bg-hover">
          <Icon name="plus" size={13} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
