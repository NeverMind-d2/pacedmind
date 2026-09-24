"use client";

import { updateTaskAction } from "@/app/actions";
import { dueInfo } from "@/lib/dates";
import { AGENT_LABEL, PRIORITY_LABEL, type Task, type TaskContext } from "@/lib/types";
import { Icon, PriorityIcon, StatusIcon } from "./icons";
import { cx, useAction } from "./ui";

const DUE_TONE = { overdue: "text-danger", today: "text-fg2", soon: "text-fg3", later: "text-mut" } as const;

export function DueChip({ due, done }: { due: string | null; done?: boolean }) {
  const info = dueInfo(due);
  if (!info) return null;
  return (
    <span className={cx("inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[5px] border border-ctl px-1.5 text-[11.5px]", done ? "text-dim" : DUE_TONE[info.tone])}>
      <Icon name="flag" size={11} strokeWidth={2.2} />
      {info.text}
    </span>
  );
}

export function SessionChip({ task, ctx }: { task: Task; ctx: TaskContext }) {
  const s = ctx.sessions[task.id];
  if (!s) return null;
  if (s.status === "running" || s.status === "starting") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] text-mut">
        <span className="h-1.5 w-1.5 rounded-full bg-fg3" />
        {AGENT_LABEL[s.agent]} running
      </span>
    );
  }
  if (s.status === "finished") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] text-fg3">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        Session finished
      </span>
    );
  }
  return null;
}

export function TaskRow({ task, ctx, selected, onSelect }: { task: Task; ctx: TaskContext; selected: boolean; onSelect: () => void }) {
  const { run } = useAction();
  const done = task.status === "done" || task.status === "canceled";
  return (
    <div className={cx("flex h-[38px] items-center gap-2.5 border-b border-hover pl-5 pr-4", selected ? "bg-sel" : "hover:bg-hover")}>
      <span title={PRIORITY_LABEL[task.priority]} className="flex w-4 shrink-0 justify-center"><PriorityIcon priority={task.priority} /></span>
      <span className="w-[54px] shrink-0 font-mono text-[11.5px] text-mut2">{task.key}</span>
      <button type="button" aria-label={done ? "Mark as not done" : "Mark as done"}
        onClick={() => run(() => updateTaskAction(task.id, { status: done ? "todo" : "done" }))}
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded hover:bg-ink/5">
        <StatusIcon status={task.status} />
      </button>
      <button type="button" onClick={onSelect}
        className={cx("h-full min-w-0 flex-1 truncate text-left", done ? "text-mut2 line-through" : "text-fg")}>
        {task.title}
      </button>
      <SessionChip task={task} ctx={ctx} />
      {task.labels.slice(0, 2).map((l) => (
        <span key={l} className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-ctl px-2 text-[11.5px] text-mut">
          <span className="h-1.5 w-1.5 rounded-full bg-mut2" />{l}
        </span>
      ))}
      <DueChip due={task.dueDate} done={done} />
    </div>
  );
}
