import { addMonths } from "date-fns";
import { addDaysStr, parseLocal, toDateStr } from "./dates";
import type { Repeat } from "./types";

/** The day after `day` that a task repeating `rule` comes back on. A month from the 31st lands on the month's last day. */
export function stepDate(rule: Repeat, day: string): string {
  if (rule === "month") return toDateStr(addMonths(parseLocal(day), 1));
  if (rule === "week") return addDaysStr(day, 7);
  let next = addDaysStr(day, 1);
  if (rule === "weekday") while ([0, 6].includes(parseLocal(next).getDay())) next = addDaysStr(next, 1);
  return next;
}

/**
 * When a repeating task done now comes back: the step after its own date, and when that's today or past (it was
 * done late), the first step after today, so it never comes back overdue.
 */
export function nextRepeat(rule: Repeat, from: string, today: string): string {
  let next = stepDate(rule, from);
  while (next <= today) next = stepDate(rule, next);
  return next;
}
