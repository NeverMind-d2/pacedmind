"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { addDays, addMonths, format, isSameMonth, startOfMonth } from "date-fns";
import { addDaysStr, mondayOf, parseLocal, toDateStr, todayStr } from "@/lib/dates";
import { Icon } from "./icons";
import { cx } from "./ui";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/** A month to pick a day from, weeks from Monday. `value` and the picked day are "YYYY-MM-DD" ("" for none). */
export function MiniCalendar({ value, onPick }: { value: string; onPick: (day: string) => void }) {
  const today = todayStr();
  const [month, setMonth] = useState(() => startOfMonth(parseLocal(value || today)));
  // The day the arrow keys move from; Tab lands on it.
  const [focus, setFocus] = useState(value || today);
  const grid = useRef<HTMLDivElement>(null);
  // Always six weeks, so the panel keeps its size from month to month.
  const days = Array.from({ length: 42 }, (_, i) => addDays(mondayOf(month), i));
  const shown = days.map((d) => toDateStr(d));
  const tabDay = isSameMonth(parseLocal(focus), month) ? focus : toDateStr(month);
  const turn = (n: number) => setMonth((m) => addMonths(m, n));
  const move = (e: KeyboardEvent, day: string) => {
    const step = STEP[e.key];
    if (!step) return;
    e.preventDefault();
    const next = addDaysStr(day, step);
    setFocus(next);
    if (!isSameMonth(parseLocal(next), month)) setMonth(startOfMonth(parseLocal(next)));
    requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus());
  };
  const nav = "grid h-6 w-6 place-items-center rounded-md text-mut hover:bg-sel hover:text-fg2";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between pl-1.5">
        <span className="text-[12.5px] font-medium text-fg2">{format(month, "MMMM yyyy")}</span>
        <div className="flex">
          <button type="button" aria-label="Previous month" onClick={() => turn(-1)} className={nav}><Icon name="chevronLeft" size={13} /></button>
          <button type="button" aria-label="Next month" onClick={() => turn(1)} className={nav}><Icon name="chevronRight" size={13} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[10.5px] leading-6 text-dim" aria-hidden="true">
        {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div ref={grid} className="grid grid-cols-7 gap-y-0.5">
        {days.map((d, i) => {
          const day = shown[i];
          const picked = day === value;
          return (
            <button key={day} type="button" data-day={day} tabIndex={day === tabDay ? 0 : -1}
              aria-label={format(d, "EEEE d MMMM yyyy")} aria-pressed={picked} aria-current={day === today ? "date" : undefined}
              onClick={() => onPick(day)} onKeyDown={(e) => move(e, day)} onFocus={() => setFocus(day)}
              className={cx("h-7 rounded-md text-[12px] tabular-nums",
                picked ? "bg-accent font-semibold text-bg"
                  : cx("hover:bg-sel", day === today ? "font-semibold text-accent-fg ring-1 ring-inset ring-accent/50"
                    : !isSameMonth(d, month) ? "text-faint" : day < today ? "text-mut2" : "text-fg2"))}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
