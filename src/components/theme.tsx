"use client";

import { useEffect, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY, type Theme } from "@/lib/theme";
import { Icon } from "./icons";
import { Segmented } from "./ui";

const EVENT = "pacedmind:theme";
const getTheme = (): Theme => document.documentElement.dataset.theme === "light" ? "light" : "dark";
const getServerTheme = (): Theme => "dark";

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    document.documentElement.dataset.theme = event.newValue === "light" ? "light" : "dark";
    onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function useTheme() {
  return useSyncExternalStore(subscribe, getTheme, getServerTheme);
}

function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* The current session still switches. */ }
  window.dispatchEvent(new Event(EVENT));
}

export function ThemeSync() {
  const theme = useTheme();
  useEffect(() => { window.pacedMindDesktop?.setTheme(getTheme()); }, [theme]);
  return null;
}

export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}
      onClick={() => setTheme(next)} className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md text-mut hover:bg-hover hover:text-fg2">
      <Icon name={next === "light" ? "sun" : "moon"} size={16} />
    </button>
  );
}

export function ThemeSelector() {
  const theme = useTheme();
  return <Segmented value={theme} onChange={setTheme} options={[
    { value: "dark", label: <><Icon name="moon" size={13} />Dark</> },
    { value: "light", label: <><Icon name="sun" size={13} />Light</> },
  ]} />;
}
