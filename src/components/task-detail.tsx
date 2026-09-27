"use client";

import { useState, type ReactNode } from "react";
import { format } from "date-fns";
import {
  addSubtaskAction, closeSessionAction, deleteSubtaskAction, deleteTaskAction, finishSessionAction, markSessionDoneAction, requestChangesAction,
  toggleSubtaskAction, updateTaskAction,
} from "@/app/actions";
import { askForChangesOn, resumeSessionOrAsk, startSessionOrAsk } from "./remote-start";
import { RequestStatus, useComputer } from "./request-status";
import { attentionOf, checkedIn, dueInfo, eventLine, fmtTime, parseLocal, planOf, timeOf, waitingInTerminal } from "@/lib/dates";
import {
  AGENT_LABEL, APP_LABEL, CLOUD_LABEL, DOER_LABEL, PRIORITY_LABEL, STATUS_LABEL, TRUST_FIRST, TRUST_WAITING, VERDICT_LABEL, agentOf, isAnswers,
  type AgentId, type Doer, type Priority, type Report, type ReportCriterion, type Session, type SessionEvent, type Status, type Surface,
  type Task, type TaskContext,
} from "@/lib/types";
import { DateField } from "./date-field";
import { AgentIcon, AreaMark, Icon, PriorityIcon, StatusIcon, SurfaceIcon, VerdictIcon } from "./icons";
import { InlineMarkdown } from "./markdown";
import { AnswerForm, Gallery, ReportBody, RequestChangesForm, SessionPlan, SessionReport, sameText } from "./report";
import { Button, IconButton, Menu, cx, useAction } from "./ui";

/** "in a terminal", "in the Claude app" or "in Claude Code on the web". */
const placeOf = (agent: AgentId, surface: Surface) =>
  surface === "cloud" ? `in ${CLOUD_LABEL[agent]}` : surface === "desktop" ? `in the ${APP_LABEL[agent]}` : "in a terminal";

/** A doer's icon: the agent's mark, or a person for tasks that are yours. */
const DoerIcon = ({ doer, size }: { doer: Doer | null; size: number }) =>
  doer === "human" ? <Icon name="user" size={size} /> : doer ? <AgentIcon agent={doer} size={size - 1} /> : <Icon name="terminal" size={size} />;

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

/**
 * The session's state in one line; `report` is its latest hand-back, if any. `asksTrust`: Claude Code doesn't trust
 * the session's folder yet, so until the agent checks in, it's asking you about it.
 */
function sessionHead(s: Session, events: SessionEvent[], report: Report | null, asksTrust: boolean): { dot: string; text: string } {
  const who = AGENT_LABEL[s.agent];
  switch (s.status) {
    case "starting":
    case "running": {
      // Its terminal's hooks, or the agent itself, said it waits for you.
      const waits = attentionOf(events);
      if (waits) return { dot: "var(--color-accent)", text: waits.text };
      if (asksTrust && s.surface === "terminal" && !checkedIn(events)) return { dot: "var(--color-accent)", text: TRUST_WAITING };
      if (s.surface !== "cloud" && waitingInTerminal(s, events)) {
        return {
          dot: "var(--color-accent)",
          text: s.surface === "desktop"
            ? `Opened in the ${APP_LABEL[s.agent]}. Send the first message there to start.`
            : `${who} hasn't checked in yet. It may be waiting for you in its terminal.`,
        };
      }
      if (report?.changes && report.changesAt) {
        return { dot: "var(--color-fg3)", text: `${who} is working ${isAnswers(report.changes) ? "with your answers" : "on your changes"} since ${fmtTime(report.changesAt)}` };
      }
      return { dot: "var(--color-fg3)", text: `Running ${s.surface === "terminal" ? `in ${who}` : placeOf(s.agent, s.surface)} since ${fmtTime(s.startedAt)}` };
    }
    case "finished": {
      const at = fmtTime(s.finishedAt ?? s.startedAt);
      if (report?.outcome === "blocked") return { dot: "var(--color-accent)", text: `${who} got stuck at ${at} · needs you` };
      if (report?.outcome === "partial") return { dot: "var(--color-accent)", text: `${who} handed back part of it at ${at} · waiting for you` };
      return { dot: "var(--color-accent)", text: `${who} finished at ${at} · waiting for you` };
    }
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
  // Null when the task is yours: then it never starts an agent session.
  const agent = agentOf(task, project?.agent);
  const doers: { value: Doer | null; label: string; hint?: string }[] = [
    { value: "human", label: DOER_LABEL.human, hint: "Stays out of flows" },
    { value: "claude", label: DOER_LABEL.claude },
    { value: "codex", label: DOER_LABEL.codex },
    { value: null, label: project?.agent ? `Project default, ${AGENT_LABEL[project.agent]}` : "Not decided" },
  ];
  const save = (patch: Parameters<typeof updateTaskAction>[1]) => run(() => updateTaskAction(task.id, patch));
  const due = dueInfo(task.dueDate);
  const subsDone = task.subtasks.filter((s) => s.done).length;
  const active = session && (session.status === "running" || session.status === "starting");
  // What the agent plans to do, while it works (report_progress).
  const plan = active ? planOf(events) : null;

  // What agents handed back, newest first. The one on view answers the Done when list; the arrows page through older ones.
  const reports = ctx.reports[task.id] ?? [];
  const [viewing, setViewing] = useState(0);
  const report = reports[Math.min(viewing, reports.length - 1)] ?? null;
  const latestOfSession = session ? reports.find((r) => r.sessionId === session.id) ?? null : null;
  const inCard = !!report && report.sessionId === session?.id;
  const soFar = session ? ctx.pending[session.id] ?? [] : [];
  const offList = report ? report.criteria.filter((c) => !task.doneWhen.some((d) => sameText(d, c.text))) : [];
  // Claude Code doesn't trust the folder of this task's session yet: the running one's, or where the next one starts.
  const asksTrust = !!ctx.asksTrust?.[task.id];
  const head = session ? sessionHead(session, events, latestOfSession, asksTrust) : null;
  const trustHint = (className: string) => asksTrust && !active && <p className={cx("text-[11.5px] leading-snug text-mut2", className)}>{TRUST_FIRST}</p>;
  // Changes go back to an agent in a terminal on this computer once it handed the task back, also after the task was
  // marked done. Sessions in the apps or the cloud take them where they run (changesProblem on the server decides).
  const [asking, setAsking] = useState(false);
  const canAsk = !!session && !!ctx.changesOk[session.id];
  // A session goes on where it ran: in the web app (which has no computer) and for another computer's session, its
  // buttons ask that computer, and the changes go there as a request (changesVia).
  const elsewhere = !!session && (!ctx.desktop || (!!session.deviceId && !!ctx.deviceId && session.deviceId !== ctx.deviceId));
  const ranOn = useComputer(session?.deviceId)?.name ?? "its computer";
  const changesVia = session ? ctx.changesVia?.[session.id] ?? null : null;
  // The questions of the agent's latest hand-back: answering them sends the session back with the answers, like changes.
  const [answering, setAnswering] = useState(false);
  const questions = session && (session.status === "finished" || session.status === "done") ? latestOfSession?.questions ?? [] : [];
  const forThisTask = (r: { taskId: number }) => r.taskId === task.id;
  const pager = reports.length > 1 && (
    <span className="flex shrink-0 items-center gap-0.5 text-[11.5px] text-mut2">
      <button type="button" aria-label="Older report" disabled={viewing >= reports.length - 1} onClick={() => setViewing((v) => v + 1)}
        className="flex h-5 w-5 items-center justify-center rounded hover:bg-hover disabled:opacity-30">
        <Icon name="chevronLeft" size={12} strokeWidth={2.2} />
      </button>
      <span className="tabular-nums">Report {reports.length - viewing} of {reports.length}</span>
      <button type="button" aria-label="Newer report" disabled={viewing === 0} onClick={() => setViewing((v) => v - 1)}
        className="flex h-5 w-5 items-center justify-center rounded hover:bg-hover disabled:opacity-30">
        <Icon name="chevronRight" size={12} strokeWidth={2.2} />
      </button>
    </span>
  );

  return (
    // On a phone the details cover the list, and the ✕ goes back to it.
    <aside aria-label="Task details" className="flex w-[420px] shrink-0 flex-col border-l border-line max-md:fixed max-md:inset-0 max-md:z-30 max-md:w-auto max-md:border-l-0 max-md:bg-panel">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line pl-6 pr-3 text-[12.5px] text-mut">
        {area ? <AreaMark area={area} size={13} dot={8} /> : <Icon name="inbox" size={13} />}
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

        <DoneWhen items={task.doneWhen} answers={report?.criteria ?? null} onChange={(doneWhen) => save({ doneWhen })} />

        {session && head && (
          <div className="flex flex-col gap-3.5 rounded-lg border border-line2 p-3.5">
            <div className="flex items-start gap-2 text-[12.5px] text-fg">
              <span className="mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: head.dot }} />
              <span className="min-w-0 flex-1">{head.text}</span>
              {inCard && pager}
            </div>
            {inCard ? <SessionReport key={report.id} report={report} criteria={offList} working={!!active} />
              : session.note && session.status !== "failed" && <p className="text-[12.5px] leading-relaxed text-mut">“{session.note}”</p>}
            {plan && <SessionPlan plan={plan} />}
            {soFar.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="text-[12px] font-medium text-fg3">Images so far</div>
                <Gallery images={soFar} />
              </div>
            )}
            <div className="truncate font-mono text-[11px] text-mut2">{[session.folder, session.branch].filter(Boolean).join(" · ")}</div>
            {answering && questions.length > 0 && (canAsk || changesVia) ? (
              <AnswerForm agent={session.agent} questions={questions} pending={pending}
                onCancel={() => setAnswering(false)}
                onSend={(text) => {
                  if (!canAsk) { askForChangesOn(session, changesVia!, text); setAnswering(false); return; }
                  run(async () => {
                    const r = await requestChangesAction(session.id, text);
                    if (r.ok) setAnswering(false);
                    return r;
                  });
                }} />
            ) : asking && canAsk ? (
              <RequestChangesForm agent={session.agent} pending={pending}
                onCancel={() => setAsking(false)}
                onSend={(changes) => run(async () => {
                  const r = await requestChangesAction(session.id, changes);
                  if (r.ok) setAsking(false);
                  return r;
                })} />
            ) : (
              <div className="flex flex-wrap gap-2">
                {/* Elsewhere it resumes where it ran; a session that ran on no computer of the account can't. */}
                {!active && session.status !== "failed" && session.surface === "terminal" && (!elsewhere || !!session.deviceId) && (
                  <Button disabled={pending} onClick={() => run(() => resumeSessionOrAsk(session))}>
                    <Icon name="terminal" size={13} />{elsewhere ? `Resume on ${ranOn}` : "Resume in terminal"}
                  </Button>
                )}
                {/* Showing an app's window only helps at that computer. */}
                {session.surface === "desktop" && session.status !== "failed" && !elsewhere && (
                  <Button disabled={pending} onClick={() => run(() => resumeSessionOrAsk(session))}><Icon name="appWindow" size={13} />Open the {APP_LABEL[session.agent]}</Button>
                )}
                {session.surface === "cloud" && session.url && (
                  <a href={session.url} target="_blank" rel="noreferrer"
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-ctl px-2.5 text-[12.5px] text-fg2 hover:bg-hover">
                    <Icon name="cloud" size={13} />Open in the cloud
                  </a>
                )}
                {questions.length > 0 && (canAsk || changesVia) && (
                  <Button onClick={() => setAnswering(true)}><Icon name="help" size={13} />{questions.length === 1 ? "Answer its question" : "Answer its questions"}</Button>
                )}
                {(canAsk || changesVia) && (
                  <Button onClick={() => (canAsk ? setAsking(true) : askForChangesOn(session, changesVia!))}><Icon name="pen" size={13} />Request changes</Button>
                )}
                {active && session.surface !== "terminal" && (
                  <Button onClick={() => run(() => finishSessionAction(session.id))}><Icon name="check" size={13} />Mark finished</Button>
                )}
                {agent && (session.status === "closed" || session.status === "done" || session.status === "failed") && task.status !== "done" && (
                  <Button disabled={pending} onClick={() => run(() => startSessionOrAsk(task.id, agent, task.runIn))}><Icon name="plus" size={13} />New session</Button>
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
            )}
            {/* For a failed session, Start under Session says it. */}
            {session.status !== "failed" && trustHint("")}
            {/* What became of a request to a computer for this task: waiting, started, refused… */}
            <RequestStatus match={forThisTask} />
          </div>
        )}

        {report && !inCard && (
          <div className="flex flex-col gap-3.5 rounded-lg border border-line2 p-3.5">
            <div className="flex items-center gap-2 text-[12.5px] text-fg2">
              <Icon name="terminal" size={13} className="shrink-0 text-mut2" />
              <span className="min-w-0 flex-1 truncate">{AGENT_LABEL[report.agent]}&apos;s report, {format(parseLocal(report.createdAt), "d MMM HH:mm")}</span>
              {pager}
            </div>
            <ReportBody key={report.id} report={report} criteria={offList} />
          </div>
        )}

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
            <Menu trigger={<button type="button" className={pv}>{area ? <AreaMark area={area} size={14} dot={8} /> : <Icon name="inbox" size={14} />}{area?.name ?? "Inbox"}</button>}
              items={[{ value: null as string | null, label: "Inbox, no area" }, ...ctx.areas.map((a) => ({ value: a.id as string | null, label: a.name, icon: <AreaMark area={a} size={14} dot={8} /> }))]}
              onSelect={(v) => save({ areaId: v, ...(project && project.areaId !== v ? { projectId: null } : {}) })} />
          </Prop>
          <Prop label="Project">
            <Menu trigger={<button type="button" className={cx(pv, !project && "text-mut2")}><Icon name="layers" size={14} />{project?.name ?? "Add to project"}</button>}
              items={[{ value: null as string | null, label: "No project" }, ...ctx.projects.map((p) => ({ value: p.id as string | null, label: p.name }))]}
              onSelect={(v) => save({ projectId: v, ...(v ? { areaId: ctx.projects.find((p) => p.id === v)?.areaId ?? task.areaId } : {}) })} />
          </Prop>
          <Prop label="Done by">
            <Menu width={240}
              trigger={
                <button type="button" className={cx(pv, !task.agent && "text-mut2")}>
                  <DoerIcon doer={task.agent ?? project?.agent ?? null} size={14} />
                  {task.agent ? DOER_LABEL[task.agent] : project?.agent ? `${AGENT_LABEL[project.agent]}, the project's default` : "Not decided"}
                </button>
              }
              items={doers.map((d) => ({ ...d, icon: <DoerIcon doer={d.value ?? project?.agent ?? null} size={13} /> }))}
              onSelect={(v) => save({ agent: v })} />
          </Prop>
          {/* Folders are this computer's: the desktop app sets them, for the sessions that run here. */}
          {agent && ctx.desktop && (
            <Prop label="Folder">
              <FolderProp task={task} projectFolder={project?.folder ?? null} onSave={(folder) => save({ folder })} />
            </Prop>
          )}
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
                <AgentIcon agent={session.agent} size={13} />{AGENT_LABEL[session.agent]}
                <span className="truncate text-mut2">{session.status === "finished" ? "finished" : session.status} {placeOf(session.agent, session.surface)}</span>
              </a>
            ) : !agent ? (
              <span className="px-2 text-mut2">None, this one is yours</span>
            ) : (
              <div className="flex flex-col items-start gap-1.5 px-2">
                {/* No overflow-hidden here: it would clip the menu. The halves round their own corners. */}
                <div className="flex h-[26px] rounded-md border border-ctl">
                  <button type="button" disabled={pending} onClick={() => run(() => startSessionOrAsk(task.id, agent, task.runIn))}
                    title={task.runIn ? `Runs ${placeOf(agent, task.runIn)}` : "Runs in a terminal when the CLI is installed, else in the desktop app"}
                    className="flex items-center gap-1.5 rounded-l-[5px] px-2.5 text-[12px] text-fg hover:bg-hover">
                    <AgentIcon agent={agent} size={12} />Start with {AGENT_LABEL[agent]}
                  </button>
                  <Menu align="right" width={250} className="flex"
                    trigger={<button type="button" aria-label="Choose agent and where it runs" className="flex h-full w-6 items-center justify-center rounded-r-[5px] border-l border-ctl text-mut hover:bg-hover"><Icon name="chevronDown" size={12} /></button>}
                    items={(["claude", "codex"] as AgentId[]).flatMap((a) => (["terminal", "desktop", "cloud"] as Surface[]).map((s) => ({
                      value: `${a}:${s}`, label: s === "cloud" ? CLOUD_LABEL[a] : `${AGENT_LABEL[a]} ${placeOf(a, s)}`, icon: <SurfaceIcon surface={s} size={13} />,
                    })))}
                    onSelect={(v) => {
                      const [a, s] = v.split(":") as [AgentId, Surface];
                      run(() => startSessionOrAsk(task.id, a, s));
                    }} />
                </div>
                {/* With a session, its card shows this. */}
                {!session && <RequestStatus match={forThisTask} />}
              </div>
            )}
          </Prop>
          {/* A row of its own under Start, so Session stays level with the button. */}
          {agent && (!session || session.status === "failed") && trustHint("col-start-2 px-2 pb-1")}
        </div>

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
              <button type="button" aria-label="Delete sub-task" onClick={() => run(() => deleteSubtaskAction(s.id))} className="hidden text-mut2 hover:text-fg2 group-hover:block pointer-coarse:block">
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
          {events.map((e) => <Activity key={e.id} at={e.at} text={eventLine(e)} />)}
          {task.completedAt && <Activity at={task.completedAt} text="Marked done" />}
        </div>
      </div>
    </aside>
  );
}

/** The folder a task's sessions work in: its own, or its project's. Click to type one; empty goes back to the project's. */
function FolderProp({ task, projectFolder, onSave }: { task: Task; projectFolder: string | null; onSave: (folder: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.folder ?? "");
  const shown = task.folder ?? projectFolder;
  const save = () => {
    setEditing(false);
    const next = draft.trim() || null;
    const own = next && next !== projectFolder ? next : null;
    if (own !== task.folder) onSave(own);
  };
  if (editing) {
    return (
      <input autoFocus value={draft} aria-label="Folder for this task" placeholder={projectFolder ?? "C:\\path\\to\\folder"}
        onChange={(e) => setDraft(e.target.value)} onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") { e.stopPropagation(); setDraft(task.folder ?? ""); setEditing(false); }
        }}
        className="h-7 w-full rounded-md border border-ctl bg-input px-2 font-mono text-[11.5px] text-fg2 outline-none" />
    );
  }
  return (
    <button type="button" onClick={() => { setDraft(task.folder ?? ""); setEditing(true); }} className={cx(pv, "w-full min-w-0")}
      title={shown ? `${shown}\nClick to give this task its own folder` : "Click to give this task a folder"}>
      <Icon name="folder" size={14} className="shrink-0" />
      <span className={cx("min-w-0 truncate font-mono text-[11.5px]", !shown && "font-sans text-[12.5px] text-mut2")}>
        {shown ?? "PacedMind workspace"}
      </span>
      <span className="shrink-0 text-[11.5px] text-mut2">{task.folder ? "own" : shown ? "project's" : ""}</span>
    </button>
  );
}

/**
 * What must be true when the task is finished. Agents answer each item when they hand the task back;
 * with a report on view (`answers`), every item shows its answer.
 */
function DoneWhen({ items, answers, onChange }: {
  items: string[];
  answers: ReportCriterion[] | null;
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const answerFor = (text: string) => answers?.find((c) => sameText(c.text, text)) ?? null;
  // With a report on view, items it didn't answer (or added since) count as not met.
  const met = items.filter((text) => answerFor(text)?.verdict === "met").length;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-[26px] items-center gap-2.5 text-[12.5px] font-medium text-fg2">
        Done when
        {answers && items.length > 0 && <span className="font-normal text-mut2">{met} of {items.length} met</span>}
      </div>
      {items.map((text, i) => (
        <DoneWhenItem key={`${i}:${text}`} text={text} answer={answerFor(text)} reported={!!answers}
          onSave={(v) => onChange(v.trim() ? items.map((x, k) => (k === i ? v : x)) : items.filter((_, k) => k !== i))}
          onDelete={() => onChange(items.filter((_, k) => k !== i))} />
      ))}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Add a Done when item"
        placeholder="+ Add what must be true when it's done"
        onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { e.preventDefault(); onChange([...items, draft.trim()]); setDraft(""); } }}
        className="h-[30px] rounded-md bg-transparent px-2 text-[12.5px] text-fg2 outline-none placeholder:text-mut2 hover:bg-hover focus:bg-hover" />
    </div>
  );
}

function DoneWhenItem({ text, answer, reported, onSave, onDelete }: {
  text: string;
  answer: ReportCriterion | null;
  /** Whether a report is on view: then an item without an answer shows as not answered. */
  reported: boolean;
  onSave: (text: string) => void;
  onDelete: () => void;
}) {
  const [value, setValue] = useState(text);
  const verdict = answer?.verdict ?? (reported ? "unanswered" : "none");
  return (
    <div className="group flex items-start gap-2.5 rounded-md px-2 py-[5px] hover:bg-hover">
      <span className="mt-[3px] shrink-0" title={answer?.verdict ? VERDICT_LABEL[answer.verdict] : reported ? "Not answered" : undefined}>
        <VerdictIcon verdict={verdict} />
      </span>
      <div className="min-w-0 flex-1">
        <textarea value={value} rows={1} aria-label="Done when item" onChange={(e) => setValue(e.target.value)}
          onBlur={() => value.trim() !== text && onSave(value.trim())}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
          className="field-sizing-content block w-full resize-none bg-transparent text-[12.5px] leading-[1.5] text-fg2 outline-none" />
        {answer?.note && <div className="text-[12px] leading-[1.5] text-mut2"><InlineMarkdown text={answer.note} /></div>}
      </div>
      <button type="button" aria-label="Remove this item" onClick={onDelete} className="mt-[2px] hidden text-mut2 hover:text-fg2 group-hover:block pointer-coarse:block">
        <Icon name="x" size={13} />
      </button>
    </div>
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
