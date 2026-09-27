import { addDays, differenceInCalendarDays, format, startOfWeek } from "date-fns";

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" in local time. */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM-DDTHH:mm" in local time. */
export function toDateTimeStr(d: Date): string {
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm:ss" in local time, used for timestamps. */
export function toStamp(d: Date): string {
  return `${toDateTimeStr(d)}:${pad(d.getSeconds())}`;
}

export const nowStamp = () => toStamp(new Date());
export const todayStr = () => toDateStr(new Date());

/** Parses "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm[:ss]" as local time. */
export function parseLocal(s: string): Date {
  const [datePart, timePart] = s.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  if (!timePart) return new Date(y, m - 1, d);
  const [hh, mm, ss] = timePart.split(":").map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0);
}

export const dateOnly = (s: string) => s.slice(0, 10);
export const timeOf = (s: string | null | undefined) => (s && s.length > 10 ? s.slice(11, 16) : null);
export const addDaysStr = (s: string, n: number) => toDateStr(addDays(parseLocal(dateOnly(s)), n));
export const mondayOf = (d: Date) => startOfWeek(d, { weekStartsOn: 1 });

export function dayDiff(from: string, to: string): number {
  return differenceInCalendarDays(parseLocal(dateOnly(to)), parseLocal(dateOnly(from)));
}

/** Minutes since midnight for "HH:mm". */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function hhmm(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export type DueTone = "overdue" | "today" | "soon" | "later";

/** Short due label and tone for list chips, relative to today. */
export function dueInfo(due: string | null, now = new Date()): { text: string; tone: DueTone; long: string } | null {
  if (!due) return null;
  const today = toDateStr(now);
  const diff = dayDiff(today, due);
  const t = timeOf(due);
  const d = parseLocal(dateOnly(due));
  if (diff < 0) {
    const text = diff === -1 ? "Yesterday" : `${-diff}d overdue`;
    return { text, tone: "overdue", long: `${format(d, "EEE d MMM")} · ${-diff === 1 ? "1 day" : `${-diff} days`} late` };
  }
  if (diff === 0) {
    if (t) {
      const [h, m] = t.split(":").map(Number);
      const left = h * 60 + m - (now.getHours() * 60 + now.getMinutes());
      const long = left > 0 ? `Today, ${t} · in ${Math.floor(left / 60)}h ${left % 60}m` : `Today, ${t} · passed`;
      return { text: t, tone: left < 0 ? "overdue" : "today", long };
    }
    return { text: "Today", tone: "today", long: "Today · by end of day" };
  }
  const label = diff === 1 ? "Tomorrow" : diff < 7 ? format(d, "EEE d") : format(d, "d MMM");
  return {
    text: t ? `${label}, ${t}` : label,
    tone: diff <= 2 ? "soon" : "later",
    long: `${format(d, "EEE d MMM")}${t ? `, ${t}` : ""} · in ${diff} day${diff === 1 ? "" : "s"}`,
  };
}

/**
 * True when a session started, or went back to work on requested changes, a while ago but its agent hasn't
 * checked in over MCP since. Usually the agent is waiting for an answer in its terminal.
 */
export function waitingInTerminal(
  s: { status: string; startedAt: string },
  events: { kind: string; at: string }[],
  now = new Date(),
): boolean {
  if (s.status !== "starting" && s.status !== "running") return false;
  const back = events.findLastIndex((e) => e.kind === "changes_requested");
  if (events.slice(back + 1).some((e) => e.kind === "picked_up")) return false;
  return now.getTime() - parseLocal(back >= 0 ? events[back].at : s.startedAt).getTime() > 90_000;
}

export const fmtDay = (s: string) => format(parseLocal(dateOnly(s)), "EEE, d MMM");
export const fmtShort = (s: string) => format(parseLocal(dateOnly(s)), "d MMM");
export const fmtTime = (s: string) => format(parseLocal(s), "HH:mm");
