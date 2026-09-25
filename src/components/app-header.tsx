"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { signOutAction } from "@/app/auth/actions";
import { BrandWordmark } from "./brand-wordmark";
import { Icon } from "./icons";
import { Popover, PopoverItem, PopoverLabel, PopoverSeparator, type Anchor } from "./popover";

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

/** Opens or closes the sidebar, which on a phone is a panel over the page (sidebar.tsx). */
export function toggleMenu() {
  window.dispatchEvent(new CustomEvent("organizer:menu"));
}

/**
 * Shared app header; Electron supplies the native window buttons over its right edge. On a phone it has the
 * menu button instead of back and forward, which the browser has.
 */
export function AppHeader({ email }: { email: string | null }) {
  const history = useSyncExternalStore(subscribe, navigationSnapshot, initialNavigation);
  return (
    <header className="app-titlebar" aria-label="PacedMind">
      <div className="app-titlebar__content">
        <button type="button" className="app-titlebar__button app-titlebar__menu" aria-label="Menu" onClick={toggleMenu}>
          <Icon name="menu" size={18} />
        </button>
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
        {email && <AccountMenu email={email} />}
      </div>
    </header>
  );
}

const MENU_WIDTH = 240;

/** The signed-in account, with Settings and Sign out. A portal popover, because the header clips its overflow. */
function AccountMenu({ email }: { email: string }) {
  const router = useRouter();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="app-titlebar__account">
      <button type="button" className="app-titlebar__button" aria-label={`Account: ${email}`} title={email} aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          // Below the button, right-aligned with it.
          setAnchor(anchor ? null : { x: r.right - MENU_WIDTH - 6, y: r.bottom + 4 });
        }}>
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line2 text-[11px] font-medium uppercase text-fg2">{email[0]}</span>
      </button>
      {anchor && (
        <Popover anchor={anchor} width={MENU_WIDTH} onClose={() => setAnchor(null)}>
          <PopoverLabel>Signed in as</PopoverLabel>
          <div className="truncate px-2 pb-1.5 text-[12.5px] text-fg2">{email}</div>
          <PopoverSeparator />
          <PopoverItem icon={<Icon name="settings" size={13} />} onClick={() => { setAnchor(null); router.push("/settings"); }}>Settings</PopoverItem>
          <PopoverItem icon={<Icon name="arrowRight" size={13} />} onClick={() => start(() => signOutAction())}>
            {pending ? "Signing out…" : "Sign out"}
          </PopoverItem>
        </Popover>
      )}
    </div>
  );
}
