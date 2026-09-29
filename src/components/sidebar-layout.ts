"use client";

import { useSyncExternalStore } from "react";

/** The sidebar's width and whether it's hidden, kept in this browser (a wider screen, a longer project name). */
export type SidebarLayout = { width: number; hidden: boolean };

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 240;

const KEY = "pacedmind:sidebar";
const EVENT = "pacedmind:sidebar";
const DEFAULT: SidebarLayout = { width: SIDEBAR_DEFAULT, hidden: false };

export const clampWidth = (w: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));

// One object per stored value, so useSyncExternalStore sees the same snapshot until it changes.
let cache: { raw: string | null; value: SidebarLayout } = { raw: null, value: DEFAULT };

function read(): SidebarLayout {
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* Private window: the defaults. */ }
  if (raw === cache.raw) return cache.value;
  let value = DEFAULT;
  try {
    const v = JSON.parse(raw ?? "null") as Partial<SidebarLayout> | null;
    value = { width: typeof v?.width === "number" ? clampWidth(v.width) : SIDEBAR_DEFAULT, hidden: v?.hidden === true };
  } catch { /* A broken value: the defaults. */ }
  cache = { raw, value };
  return value;
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) onChange(); };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSidebarLayout() {
  return useSyncExternalStore(subscribe, read, () => DEFAULT);
}

/** Ctrl+B (⌘B): hides the sidebar, or brings it back. */
export const toggleSidebar = () => setSidebarLayout({ hidden: !read().hidden });

export function setSidebarLayout(change: Partial<SidebarLayout>) {
  const next = { ...read(), ...change };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Not remembered, but it still changes now. */ }
  // What read() compares with next time; without storage that stays null, so the change lives on in memory.
  let raw: string | null = null;
  try { raw = localStorage.getItem(KEY); } catch { /* No storage. */ }
  cache = { raw, value: next };
  window.dispatchEvent(new Event(EVENT));
}
