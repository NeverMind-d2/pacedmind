"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { dateOnly, timeOf } from "@/lib/dates";
import { MiniCalendar } from "./mini-calendar";
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
  // How far the panel moves sideways, and whether it opens above the field, to stay inside the window (a phone).
  const [fit, setFit] = useState<{ x: number; up: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const date = value ? dateOnly(value) : "";
  const time = timeOf(value) ?? "";
  useEffect(() => {
    if (!open) return;
    // Pointer, not mouse: Safari on a phone sends no mouse events for a tap on something that isn't clickable.
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  // Measured where it opens by itself, below the field; moved only when that leaves the window.
  useLayoutEffect(() => {
    if (!open) return;
    const box = panel.current?.getBoundingClientRect();
    const field = ref.current?.getBoundingClientRect();
    if (!box || !field) return;
    const x = box.right > window.innerWidth - 8 ? Math.max(8 - box.left, window.innerWidth - 8 - box.right) : box.left < 8 ? 8 - box.left : 0;
    const up = box.bottom > window.innerHeight - 8 && field.top - 4 - box.height >= 8;
    if (x || up) setFit({ x, up });
  }, [open]);
  const toggle = () => { setFit(null); setOpen((o) => !o); };
  const set = (d: string, t: string) => onChange(d ? (t ? `${d}T${t}` : d) : null);
  return (
    <div ref={ref} className="relative">
      <div onClick={toggle}>{trigger}</div>
      {/* data-popup: a press outside only closes it, so a calendar's day doesn't also take that press as a click. */}
      {open && (
        <div ref={panel} data-popup style={fit ? { transform: `translateX(${fit.x}px)` } : undefined}
          className={cx("absolute z-50 flex w-60 flex-col rounded-lg border border-line2 bg-raised p-2 shadow-[var(--shadow-popover)]",
            fit?.up ? "bottom-full mb-1" : "top-full mt-1", align === "right" ? "right-0" : "left-0")}>
          {/* With a time to add, the panel stays open after the day. */}
          <MiniCalendar value={date} onPick={(d) => { set(d, time); if (!withTime) setOpen(false); }} />
          {(withTime || value) && (
            <div className="mt-1 flex items-center gap-1.5 border-t border-line2 pt-2">
              {withTime && (
                <input type="time" aria-label="Time" value={time} disabled={!date} onChange={(e) => set(date, e.target.value)}
                  className="h-7 w-[84px] rounded-md border border-line2 bg-input px-1.5 text-[12px] disabled:opacity-50" />
              )}
              {value && (
                <button type="button" onClick={() => { onChange(null); setOpen(false); }}
                  className="ml-auto h-7 rounded-md px-2 text-[12.5px] text-mut2 hover:bg-sel">Clear</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
