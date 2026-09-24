import { getISOWeek } from "date-fns";
import { WeekView, type SessionLane } from "@/components/views/week";
import { planWeek } from "@/server/calendar";
import * as repo from "@/server/repo";
import { taskContext } from "@/server/views";
import { addDaysStr, dateOnly, fmtShort, mondayOf, parseLocal, toDateStr, toDateTimeStr } from "@/lib/dates";
import type { Session } from "@/lib/types";

export default async function WeekPage(props: PageProps<"/calendar/week">) {
  const sp = await props.searchParams;
  const now = new Date();
  const today = toDateStr(now);
  const w = typeof sp.w === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.w) && toDateStr(parseLocal(sp.w)) === sp.w ? sp.w : today;
  const start = toDateStr(mondayOf(parseLocal(w)));
  const end = addDaysStr(start, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(start, i));
  const current = start <= today && today <= end;

  const all = repo.listTasks();
  const sessions = repo.listSessions();
  const settings = repo.getSettings();
  const plan = planWeek({ start, end, now, tasks: all, sessions, settings });

  const keyOf = new Map(all.map((t) => [t.id, t.key]));
  const stopOf = (s: Session) => s.finishedAt ?? s.endedAt ?? (s.status === "running" || s.status === "starting" ? null : s.startedAt);
  const inWeek = sessions.filter((s) => {
    const stop = stopOf(s);
    return keyOf.has(s.taskId) && s.status !== "failed" && dateOnly(s.startedAt) <= end && (!stop || dateOnly(stop) >= start);
  });
  const lanes: SessionLane[] = inWeek.map((s) => ({ id: s.id, key: keyOf.get(s.taskId)!, agent: s.agent, start: s.startedAt, end: stopOf(s) }));

  const ids = new Set([
    ...(plan?.blocks ?? []).map((b) => b.taskId),
    ...(plan?.unplaced ?? []).map((u) => u.taskId),
    ...inWeek.map((s) => s.taskId),
  ]);
  const tasks = all.filter((t) => ids.has(t.id) || (t.dueDate && dateOnly(t.dueDate) >= start && dateOnly(t.dueDate) <= end));

  const from = start.slice(0, 7) === end.slice(0, 7) ? String(Number(start.slice(8))) : fmtShort(start);
  const month = addDaysStr(start, 3).slice(0, 7);

  return (
    <WeekView
      days={days}
      now={toDateTimeStr(now)}
      subtitle={`${from} to ${fmtShort(end)} · week ${getISOWeek(parseLocal(start))}`}
      current={current}
      events={repo.occurrences(start, end)}
      plan={plan}
      lanes={lanes}
      tasks={tasks}
      rules={{
        workStart: settings.workStart, workEnd: settings.workEnd, lunchStart: settings.lunchStart, lunchEnd: settings.lunchEnd,
        workDays: settings.workDays,
      }}
      ctx={taskContext(tasks)}
      nav={{
        prev: `/calendar/week?w=${addDaysStr(start, -7)}`,
        next: `/calendar/week?w=${addDaysStr(start, 7)}`,
        month: current ? "/calendar" : `/calendar?m=${month}`,
        week: current ? "/calendar/week" : `/calendar/week?w=${start}`,
      }}
      initialKey={typeof sp.task === "string" ? sp.task : null}
    />
  );
}
