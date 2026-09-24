"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { addDays } from "date-fns";
import { dateOnly, timeOf, toDateStr } from "@/lib/dates";
import { cx } from "./ui";

/** A small popover to pick a date and (optionally) a time. Value is "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm". */
export function DateField({
  value, onChange, trigger, withTime = true, align = "left",
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  trigger: ReactNode;
  withTime?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const date = value ? dateOnly(value) : "";
  const time = timeOf(value) ?? "";
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const set = (d: string, t: string) => onChange(d ? (t ? `${d}T${t}` : d) : null);
  const quick = (label: string, offset: number) => (
    <button type="button" onClick={() => { set(toDateStr(addDays(new Date(), offset)), time); setOpen(false); }}
      className="h-7 rounded-md px-2 text-left text-[12.5px] text-fg2 hover:bg-sel">{label}</button>
  );
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div className={cx("absolute top-full z-50 mt-1 flex w-60 flex-col gap-1 rounded-lg border border-line2 bg-raised p-2 shadow-[0_12px_32px_rgba(0,0,0,0.6)]", align === "right" ? "right-0" : "left-0")}>
          {quick("Today", 0)}
          {quick("Tomorrow", 1)}
          {quick("In a week", 7)}
          <div className="my-1 flex gap-1.5">
            <input type="date" aria-label="Date" value={date} onChange={(e) => set(e.target.value, time)}
              className="h-7 min-w-0 flex-1 rounded-md border border-line2 bg-[#030303] px-1.5 text-[12px]" />
            {withTime && (
              <input type="time" aria-label="Time" value={time} disabled={!date} onChange={(e) => set(date, e.target.value)}
                className="h-7 w-[84px] rounded-md border border-line2 bg-[#030303] px-1.5 text-[12px]" />
            )}
          </div>
          {value && (
            <button type="button" onClick={() => { onChange(null); setOpen(false); }}
              className="h-7 rounded-md px-2 text-left text-[12.5px] text-mut2 hover:bg-sel">Clear</button>
          )}
        </div>
      )}
    </div>
  );
}
