"use client";

import { useState, type ReactNode } from "react";
import { format } from "date-fns";
import {
  addSubtaskAction, closeSessionAction, deleteSubtaskAction, deleteTaskAction, markSessionDoneAction, resumeSessionAction,
  startSessionAction, toggleSubtaskAction, updateTaskAction,
} from "@/app/actions";
import { dueInfo, fmtTime, parseLocal, timeOf, waitingInTerminal } from "@/lib/dates";
import {
  AGENT_LABEL, PRIORITY_LABEL, STATUS_LABEL, type AgentId, type Priority, type Session, type SessionEvent, type Status, type Task,
  type TaskContext,
} from "@/lib/types";
import { DateField } from "./date-field";
import { Icon, PriorityIcon, StatusIcon } from "./icons";
import { Button, Dot, IconButton, Menu, cx, useAction } from "./ui";

const ESTIMATES = [15, 30, 45, 60, 90, 120, 180, 240];

function Prop({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="text-mut2">{label}</span>
      <div className="min-w-0">{children}</div>
    </>
  );
}

const pv = "flex h-7 max-w-full items-center gap-2 rounded-md px-2 text-left text-fg2 hover:bg-hover";

function sessionHead(s: Session, events: SessionEvent[]): { dot: string; text: string } {
  const who = AGENT_LABEL[s.agent];
  switch (s.status) {
    case "starting":
    case "running":
      if (waitingInTerminal(s, events)) return { dot: "var(--color-accent)", text: `${who} hasn't checked in yet. It may be waiting for you in its terminal.` };
      return { dot: "var(--color-fg3)", text: `Running in ${who} since ${fmtTime(s.startedAt)}` };
    case "finished":
      return { dot: "var(--color-accent)", text: `${who} finished at ${fmtTime(s.finishedAt ?? s.startedAt)} · waiting for you` };
    case "done":
      return { dot: "var(--color-faint)", text: `${who} finished, marked done` };
    case "closed":
      return { dot: "var(--color-dim)", text: "Closed before the agent finished" };
    default:
      return { dot: "var(--color-danger)", text: `Couldn't start: ${s.note ?? "unknown error"}` };
  }
}

export function TaskDetail({ task, ctx, onClose }: { task: Task; ctx: TaskContext; onClose: () => void }) {
  const { run, pending } = useAction();
  const [title, setTitle] = useState(task.title);
  const [desc, setDesc] = useState(task.description);
  const [newSub, setNewSub] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const area = ctx.areas.find((a) => a.id === task.areaId) ?? null;
  const project = ctx.projects.find((p) => p.id === task.projectId) ?? null;
  const session = ctx.sessions[task.id] ?? null;
  const events = session ? ctx.sessionEvents[session.id] ?? [] : [];
  const agent: AgentId = task.agent ?? project?.agent ?? "claude";
  const save = (patch: Parameters<typeof updateTaskAction>[1]) => run(() => updateTaskAction(task.id, patch));
  const due = dueInfo(task.dueDate);
  const subsDone = task.subtasks.filter((s) => s.done).length;
  const active = session && (session.status === "running" || session.status === "starting");

  return (
    <aside aria-label="Task details" className="flex w-[420px] shrink-0 flex-col border-l border-line">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line pl-6 pr-3 text-[12.5px] text-mut">
        {area ? <Dot color={area.color} /> : <Icon name="inbox" size={13} />}
        <span>{area?.name ?? "Inbox"}</span>
        <span className="text-faint">›</span>
        <span className="truncate">{project?.name ?? "No project"}</span>
        <span className="text-faint">›</span>
        <span className="font-mono text-[11.5px] text-mut2">{task.key}</span>
        <span className="flex-1" />
        <IconButton label="Delete task" onClick={() => { if (confirm(`Delete ${task.key}?`)) { run(() => deleteTaskAction(task.id)); onClose(); } }}>
          <Icon name="trash" size={15} />
        </IconButton>
        <IconButton label="Close details (Esc)" onClick={onClose}><Icon name="x" size={15} /></IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
        <div className="flex flex-col gap-2">
          <textarea aria-label="Title" value={title} rows={1} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== task.title && save({ title })}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
            className="field-sizing-content resize-none bg-transparent text-[20px] font-semibold leading-snug tracking-[-0.01em] text-strong outline-none" />
          <textarea aria-label="Description" value={desc} placeholder="Add description…" onChange={(e) => setDesc(e.target.value)}
            onBlur={() => desc !== task.description && save({ description: desc })}
            className="field-sizing-content min-h-[44px] resize-none bg-transparent text-[13.5px] leading-relaxed text-mut outline-none placeholder:text-dim" />
        </div>

        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 text-[12.5px]">
          <Prop label="Status">
            <Menu trigger={<button type="button" className={pv}><StatusIcon status={task.status} />{STATUS_LABEL[task.status]}</button>}
              items={(Object.keys(STATUS_LABEL) as Status[]).map((s) => ({ value: s, label: STATUS_LABEL[s], icon: <StatusIcon status={s} /> }))}
              onSelect={(v) => save({ status: v })} />
          </Prop>
          <Prop label="Priority">
            <Menu trigger={<button type="button" className={pv}><PriorityIcon priority={task.priority} />{PRIORITY_LABEL[task.priority]}</button>}
              items={([1, 2, 3, 4, 0] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p], icon: <PriorityIcon priority={p} /> }))}
              onSelect={(v) => save({ priority: v })} />
          </Prop>
          <Prop label="Due date">
            <DateField value={task.dueDate} onChange={(v) => save({ dueDate: v })}
              trigger={<button type="button" className={cx(pv, due?.tone === "overdue" ? "text-danger" : "")}><Icon name="flag" size={14} />
                {due ? <><span>{format(parseLocal(task.dueDate!), timeOf(task.dueDate) ? "EEE d MMM, HH:mm" : "EEE d MMM")}</span><span className="truncate text-mut2">{due.long.split("·")[1]}</span></> : <span className="text-mut2">Add a deadline</span>}
              </button>} />
          </Prop>
          <Prop label="Planned">
            <DateField value={task.plannedDate} withTime={false} onChange={(v) => save({ plannedDate: v ? v.slice(0, 10) : null })}
              trigger={<button type="button" className={pv}><Icon name="calendarCheck" size={14} />
                {task.plannedDate ? format(parseLocal(task.plannedDate), "EEE d MMM") : <span className="text-mut2">Pick a day to work on it</span>}
              </button>} />
          </Prop>
          <Prop label="Estimate">
            <Menu trigger={<button type="button" className={pv}><Icon name="hourglass" size={14} />{task.estimateMin} min</button>}
              items={ESTIMATES.map((m) => ({ value: m, label: `${m} min` }))} onSelect={(v) => save({ estimateMin: v })} />
          </Prop>
          <Prop label="Area">
            <Menu trigger={<button type="button" className={pv}>{area ? <Dot color={area.color} /> : <Icon name="inbox" size={14} />}{area?.name ?? "Inbox"}</button>}
              items={[{ value: null as string | null, label: "Inbox, no area" }, ...ctx.areas.map((a) => ({ value: a.id as string | null, label: a.name, icon: <Dot color={a.color} /> }))]}
              onSelect={(v) => save({ areaId: v })} />
          </Prop>
          <Prop label="Project">
            <Menu trigger={<button type="button" className={cx(pv, !project && "text-mut2")}><Icon name="layers" size={14} />{project?.name ?? "Add to project"}</button>}
              items={[{ value: null as string | null, label: "No project" }, ...ctx.projects.map((p) => ({ value: p.id as string | null, label: p.name }))]}
              onSelect={(v) => save({ projectId: v, ...(v ? { areaId: ctx.projects.find((p) => p.id === v)?.areaId ?? task.areaId } : {}) })} />
          </Prop>
          <Prop label="Labels">
            <div className="flex min-h-7 flex-wrap items-center gap-1.5 px-2">
              {task.labels.map((l) => (
                <button key={l} type="button" title="Remove label" onClick={() => save({ labels: task.labels.filter((x) => x !== l) })}
                  className="inline-flex h-5 items-center gap-1.5 rounded-full border border-ctl px-2 text-[11.5px] text-mut hover:border-line-strong">
                  <span className="h-1.5 w-1.5 rounded-full bg-mut2" />{l}
                </button>
              ))}
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="+ Add" aria-label="Add label"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newLabel.trim()) {
                    save({ labels: [...new Set([...task.labels, newLabel.trim().toLowerCase()])] });
                    setNewLabel("");
                  }
                }}
                className="h-5 w-16 bg-transparent text-[11.5px] text-mut outline-none placeholder:text-mut2" />
            </div>
          </Prop>
          <Prop label="Session">
            {session && session.status !== "failed" ? (
              <a href={`/sessions?s=${session.id}`} className={pv}>
                <Icon name="terminal" size={14} />{AGENT_LABEL[session.agent]}
                <span className="truncate text-mut2">{session.status === "finished" ? "finished" : session.status}</span>
              </a>
            ) : (
              <div className="flex px-2">
                <div className="flex h-[26px] overflow-hidden rounded-md border border-ctl">
                  <button type="button" disabled={pending} onClick={() => run(() => startSessionAction(task.id, agent))}
                    className="flex items-center gap-1.5 px-2.5 text-[12px] text-fg hover:bg-hover">
                    <Icon name="terminal" size={13} />Start in {AGENT_LABEL[agent]}
                  </button>
                  <Menu align="right" width={180}
                    trigger={<button type="button" aria-label="Choose agent" className="flex h-full w-6 items-center justify-center border-l border-ctl text-mut hover:bg-hover"><Icon name="chevronDown" size={12} /></button>}
                    items={(["claude", "codex"] as AgentId[]).map((a) => ({ value: a, label: `Start in ${AGENT_LABEL[a]}` }))}
                    onSelect={(a) => run(() => startSessionAction(task.id, a))} />
                </div>
              </div>
            )}
          </Prop>
        </div>

        {session && (
          <div className="flex flex-col gap-2 rounded-lg border border-line2 p-3.5">
            <div className="flex items-center gap-2 text-[12.5px] text-fg">
              <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: sessionHead(session, events).dot }} />
              {sessionHead(session, events).text}
            </div>
            {session.note && session.status !== "failed" && <p className="text-[12.5px] leading-relaxed text-mut">“{session.note}”</p>}
            <div className="truncate font-mono text-[11px] text-mut2">{session.folder}{session.branch ? ` · ${session.branch}` : ""}</div>
            <div className="mt-0.5 flex flex-wrap gap-2">
              {!active && session.status !== "failed" && (
                <Button onClick={() => run(() => resumeSessionAction(session.id))}><Icon name="terminal" size={13} />Resume in terminal</Button>
              )}
              {(session.status === "closed" || session.status === "done" || session.status === "failed") && task.status !== "done" && (
                <Button onClick={() => run(() => startSessionAction(task.id, agent))}><Icon name="plus" size={13} />New session</Button>
              )}
              {session.status === "finished" && (
                <Button variant="primary" onClick={() => run(() => markSessionDoneAction(session.id))}>Mark done</Button>
              )}
              {active && (
                <Button onClick={() => confirm("Close this session in PacedMind? The terminal stays open.") && run(() => closeSessionAction(session.id))}>
                  Close session
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="flex h-[26px] items-center gap-2.5 text-[12.5px] font-medium text-fg2">
            Sub-tasks
            {task.subtasks.length > 0 && (
              <>
                <span className="font-normal text-mut2">{subsDone} / {task.subtasks.length}</span>
                <span className="h-1 w-16 overflow-hidden rounded bg-ctl">
                  <span className="block h-1 rounded bg-accent" style={{ width: `${(subsDone / task.subtasks.length) * 100}%` }} />
                </span>
              </>
            )}
          </div>
          {task.subtasks.map((s) => (
            <div key={s.id} className="group flex h-[30px] items-center gap-2.5 rounded-md border border-line px-2">
              <button type="button" aria-label={s.done ? "Mark as not done" : "Mark as done"} onClick={() => run(() => toggleSubtaskAction(s.id, !s.done))}>
                <StatusIcon status={s.done ? "done" : "todo"} />
              </button>
              <span className={cx("flex-1 truncate text-[12.5px]", s.done ? "text-mut2 line-through" : "text-fg2")}>{s.title}</span>
              <button type="button" aria-label="Delete sub-task" onClick={() => run(() => deleteSubtaskAction(s.id))} className="hidden text-mut2 hover:text-fg2 group-hover:block">
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
          <input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="+ Add sub-task" aria-label="Add sub-task"
            onKeyDown={(e) => { if (e.key === "Enter" && newSub.trim()) { run(() => addSubtaskAction(task.id, newSub)); setNewSub(""); } }}
            className="h-[30px] rounded-md bg-transparent px-2 text-[12.5px] text-fg2 outline-none placeholder:text-mut2 hover:bg-hover focus:bg-hover" />
        </div>

        <div className="flex flex-col gap-2.5 border-t border-line pt-3.5 text-[12px] text-mut2">
          <Activity at={task.createdAt} text="Created" />
          {events.map((e) => <Activity key={e.id} at={e.at} text={e.text || e.kind} />)}
          {task.completedAt && <Activity at={task.completedAt} text="Marked done" />}
        </div>
      </div>
    </aside>
  );
}

function Activity({ at, text }: { at: string; text: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="h-1.5 w-1.5 shrink-0 translate-y-[-1px] rounded-full bg-faint" />
      <span className="flex-1 text-mut">{text}</span>
      <span className="shrink-0 font-mono text-[11px] text-dim">{format(parseLocal(at), "d MMM HH:mm")}</span>
    </div>
  );
}
