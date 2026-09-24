"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { BrandWordmark } from "./brand-wordmark";
import { Icon } from "./icons";

type NavigationState = EventTarget & { canGoBack: boolean; canGoForward: boolean };
const navigation = () => (window as Window & { navigation?: NavigationState }).navigation;

function subscribe(onChange: () => void) {
  const nav = navigation();
  let active = true;
  // Next updates browser history during its insertion effect. Notify after that commit.
  const update = () => queueMicrotask(() => { if (active) onChange(); });
  nav?.addEventListener("currententrychange", update);
  window.addEventListener("popstate", update);
  return () => {
    active = false;
    nav?.removeEventListener("currententrychange", update);
    window.removeEventListener("popstate", update);
  };
}

// Primitive snapshots stay stable between history changes. Electron supports both directions.
function navigationSnapshot() {
  const nav = navigation();
  return nav ? Number(nav.canGoBack) | (Number(nav.canGoForward) << 1) : Number(window.history.length > 1);
}
const initialNavigation = () => 0;

/** Shared app header; Electron supplies the native window buttons over its right edge. */
export function AppHeader() {
  const history = useSyncExternalStore(subscribe, navigationSnapshot, initialNavigation);
  return (
    <header className="app-titlebar" aria-label="PacedMind">
      <div className="app-titlebar__content">
        <div className="app-titlebar__navigation" role="group" aria-label="Page navigation">
          <button type="button" className="app-titlebar__button" aria-label="Go back" title="Go back (Alt+Left)"
            disabled={!(history & 1)} onClick={() => window.history.back()}>
            <Icon name="arrowRight" size={16} className="rotate-180" />
          </button>
          <button type="button" className="app-titlebar__button" aria-label="Go forward" title="Go forward (Alt+Right)"
            disabled={!(history & 2)} onClick={() => window.history.forward()}>
            <Icon name="arrowRight" size={16} />
          </button>
        </div>
        <Link href="/today" aria-label="PacedMind — Today" className="app-titlebar__home">
          <BrandWordmark className="w-[112px]" />
        </Link>
      </div>
    </header>
  );
}
