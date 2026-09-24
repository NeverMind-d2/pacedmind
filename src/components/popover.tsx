"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./ui";

/** Where to open: next to an element's box, or at a pointer position (context menu). */
export type Anchor = { x: number; y: number; w?: number; h?: number };

export const anchorOf = (el: Element): Anchor => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/**
 * A floating panel rendered into document.body, so scrolling containers (like the sidebar) can't clip it.
 * Opens to the right of the anchor and stays inside the viewport. Closes on outside click, Escape, resize or scroll.
 */
export function Popover({ anchor, onClose, children, width = 232, className }: {
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const h = ref.current?.offsetHeight ?? 0;
      let left = anchor.x + (anchor.w ?? 0) + 6;
      if (left + width > window.innerWidth - 8) left = Math.max(8, anchor.x - width - 6);
      const top = Math.max(8, Math.min(anchor.y, window.innerHeight - h - 8));
      setPos({ left, top });
    };
    place();
    // Re-place when the content grows, e.g. an expanded submenu near the bottom of the window.
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [anchor, width]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} role="menu" style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      className={cx("fixed z-[60] rounded-lg border border-line2 bg-raised p-1 shadow-[var(--shadow-popover)]", className)}>
      {children}
    </div>,
    document.body,
  );
}

export function PopoverItem({ icon, children, onClick, danger, hint }: {
  icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; hint?: ReactNode;
}) {
  return (
    <button type="button" role="menuitem" onClick={onClick}
      className={cx("flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[12.5px] hover:bg-sel", danger ? "text-danger" : "text-fg2")}>
      {icon && <span className="flex w-4 shrink-0 justify-center text-mut">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="text-[11.5px] text-mut2">{hint}</span>}
    </button>
  );
}

export const PopoverSeparator = () => <div className="my-1 h-px bg-line2" />;

export function PopoverLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pb-1 pt-1.5 text-[11.5px] text-mut2">{children}</div>;
}
