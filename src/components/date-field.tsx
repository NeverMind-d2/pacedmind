"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DatePicker } from "./date-picker";
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
  // Focus goes back to the trigger, or it would be lost with the panel (and the keys of the dialog around it).
  const close = () => {
    const inside = panel.current?.contains(document.activeElement);
    setOpen(false);
    if (inside) ref.current?.querySelector<HTMLElement>("button, [tabindex]")?.focus();
  };
  return (
    <div ref={ref} className="relative">
      <div onClick={toggle}>{trigger}</div>
      {/* data-popup: a press outside only closes it, so a calendar's day doesn't also take that press as a click. */}
      {open && (
        <div ref={panel} data-popup style={fit ? { transform: `translateX(${fit.x}px)` } : undefined}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}
          className={cx("absolute z-50 w-[272px] max-w-[calc(100vw-16px)] rounded-lg border border-line2 bg-raised p-2 shadow-[var(--shadow-popover)]",
            fit?.up ? "bottom-full mb-1" : "top-full mt-1", align === "right" ? "right-0" : "left-0")}>
          <DatePicker value={value} withTime={withTime} onChange={(v, done) => { onChange(v); if (done) close(); }}>
            {value && (
              <button type="button" onClick={() => { onChange(null); close(); }}
                className="ml-auto h-7 rounded-md px-2 text-[12.5px] text-mut2 hover:bg-sel">Clear</button>
            )}
          </DatePicker>
        </div>
      )}
    </div>
  );
}
