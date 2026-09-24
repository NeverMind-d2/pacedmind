"use client";

import Link from "next/link";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { toDateTimeStr } from "@/lib/dates";
import { Icon, type IconName } from "../icons";
import { cx } from "../ui";

export function ViewHeader({ icon, title, subtitle, children }: { icon: IconName; title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line pl-5 pr-4">
      <Icon name={icon} className="text-mut" />
      <h1 className="text-[14px] font-semibold text-strong">{title}</h1>
      {subtitle && <span className="text-mut2">{subtitle}</span>}
      {children}
    </div>
  );
}

export function PeriodNav({ unit, prev, next, today }: { unit: "month" | "week"; prev: string; next: string; today: string }) {
  const arrow = "flex h-[26px] w-[26px] items-center justify-center rounded-md text-mut hover:bg-hover";
  return (
    <div className="ml-1.5 flex items-center gap-0.5">
      <Link href={prev} aria-label={`Previous ${unit}`} title={`Previous ${unit}`} className={arrow}>
        <Icon name="chevronLeft" size={14} strokeWidth={2} />
      </Link>
      <Link href={next} aria-label={`Next ${unit}`} title={`Next ${unit}`} className={arrow}>
        <Icon name="chevronRight" size={14} strokeWidth={2} />
      </Link>
      <Link href={today} className="flex h-[26px] items-center rounded-md border border-line2 px-[9px] text-[12.5px] text-fg3 hover:bg-hover">Today</Link>
    </div>
  );
}

/** Looks like Segmented, but each option is a link to the other calendar view. */
export function ViewSwitch({ value, month, week }: { value: "month" | "week"; month: string; week: string }) {
  const options = [{ value: "month", label: "Month", href: month }, { value: "week", label: "Week", href: week }] as const;
  return (
    <nav aria-label="Calendar view" className="flex h-7 items-center gap-0.5 rounded-[7px] border border-line bg-[#030303] p-0.5">
      {options.map((o) => (
        <Link key={o.value} href={o.href} aria-current={o.value === value ? "page" : undefined}
          className={cx("flex h-[22px] items-center rounded-[5px] px-2.5 text-[12px]", o.value === value ? "bg-[#141416] text-strong" : "text-mut hover:text-fg2")}>
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

/** The selected task key, cleared with Escape like in TaskList. */
export function useSelection(initialKey: string | null) {
  const [sel, setSel] = useState<string | null>(initialKey);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement).closest("input, textarea, [role=dialog]")) setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [sel, setSel] as const;
}

/** "YYYY-MM-DDTHH:mm", starting from the server's value so hydration matches, then ticking every minute. */
export function useNow(initial: string) {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const id = setInterval(() => setNow(toDateTimeStr(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Props that make a non-button element (e.g. a draggable card) act like a button. */
export function pressable(onPress: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onPress,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onPress();
      }
    },
  };
}

export const isOpenTask = (t: { status: string }) => t.status !== "done" && t.status !== "canceled";

export const areaColor = (areas: { id: string; color: string }[], id: string | null) => areas.find((a) => a.id === id)?.color ?? "#85858c";
