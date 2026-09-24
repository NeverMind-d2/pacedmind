"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { SCREEN } from "./screens/parts";

export type DeckItem = { tab: string; title: string; body: string; screen: ReactNode };

const HOLD = 6000;
const EASE = "cubic-bezier(0.65, 0, 0.35, 1)";
// Where the front, middle and back screens sit on a 1056 px wide stage; everything scales with the stage.
const STAGE = { w: 1056, h: 780 };
const SLOTS = [[0, 236, 0], [138, 118, -130], [275, 0, -260]];
const CARD_SCALE = 0.74;

const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (cb: () => void) => {
  const m = window.matchMedia(motionQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/**
 * The app's screens in 3D. Each holds the front for a few seconds, then steps back as the next comes forward;
 * the line under its tab shows the time left. Picking a tab stops the cycle; hovering pauses it.
 */
export function ScreenDeck({ items }: { items: DeckItem[] }) {
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => false);
  const [front, setFront] = useState(0);
  const [auto, setAuto] = useState(true);
  const [paused, setPaused] = useState(false);
  const [k, setK] = useState(1);
  // The static HTML can't know the width; the screens show once they're sized for it.
  const [sized, setSized] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const lastRoles = useRef<number[]>(items.map((_, i) => i));
  const clock = useRef({ left: HOLD, since: 0 });
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const cycling = auto && !reduced;

  // Scale the stage to the space it has.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      setK(Math.min(1, el.clientWidth / STAGE.w));
      setSized(true);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pause while the page is hidden.
  useEffect(() => {
    const onVisible = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // A new screen in front gets the full time; a pause keeps what was left.
  useEffect(() => { clock.current.left = HOLD; }, [front]);
  useEffect(() => {
    if (!cycling || paused) return;
    const c = clock.current;
    c.since = performance.now();
    const id = window.setTimeout(() => setFront((f) => (f + 1) % items.length), c.left);
    return () => {
      window.clearTimeout(id);
      c.left = Math.max(0, c.left - (performance.now() - c.since));
    };
  }, [front, cycling, paused, items.length]);

  // A screen that moves between the front and the back fades out while it passes the others.
  useEffect(() => {
    const roles = items.map((_, i) => (i - front + items.length) % items.length);
    roles.forEach((role, i) => {
      if (!reduced && Math.abs(role - lastRoles.current[i]) === 2) {
        cards.current[i]?.animate([{ opacity: 1 }, { opacity: 0, offset: 0.3 }, { opacity: 0, offset: 0.62 }, { opacity: 1 }], { duration: 1000, easing: "ease-in-out" });
      }
    });
    lastRoles.current = roles;
  }, [front, items, reduced]);

  const pick = (i: number) => {
    setAuto(false);
    setFront(i);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (front + step + items.length) % items.length;
    pick(next);
    tabs.current[next]?.focus();
  };

  return (
    <section aria-label="PacedMind's views" className="mt-[88px] sm:mt-32"
      onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(document.hidden)}
      onFocus={() => setPaused(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false); }}>
      <div role="tablist" aria-label="Views" onKeyDown={onKey} className="flex gap-[22px] sm:gap-9">
        {items.map((it, i) => {
          const on = i === front;
          return (
            <button key={it.tab} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`view-tab-${i}`} aria-selected={on}
              aria-controls={`view-panel-${i}`} tabIndex={on ? 0 : -1} onClick={() => pick(i)}
              className={`flex flex-col gap-2.5 text-[17px] transition-colors sm:text-[19px] ${on ? "text-ink" : "text-mut hover:text-text"}`}>
              {it.tab}
              <span className="block h-0.5 w-full overflow-hidden bg-line">
                {on && (
                  <span key={cycling ? front : "still"} className={`block h-full w-full bg-ink ${cycling ? "pace" : ""}`}
                    style={cycling ? { animationDuration: `${HOLD}ms`, animationPlayState: paused ? "paused" : "running" } : undefined} />
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div ref={stageRef} className={`deck-stage relative mt-7 w-full sm:mt-12 ${sized ? "is-sized" : ""}`}
        style={{ aspectRatio: `${STAGE.w} / ${STAGE.h}`, perspective: `${Math.max(900, 2400 * k)}px`, perspectiveOrigin: "60% 40%" }}>
        <div className="deck-layer absolute inset-0" style={{ transformStyle: "preserve-3d", transform: "rotateX(7deg) rotateY(10deg)" }}>
          {items.map((it, i) => {
            const role = (i - front + items.length) % items.length;
            const [x, y, z] = SLOTS[role];
            return (
              <div key={it.tab} ref={(el) => { cards.current[i] = el; }} aria-hidden={role !== 0}
                className="absolute left-0 top-0 will-change-transform"
                style={{
                  transformStyle: "preserve-3d",
                  transform: `translate3d(${x * k}px, ${y * k}px, ${z * k}px)`,
                  transition: reduced ? "none" : `transform 1000ms ${EASE}`,
                }}>
                {/* zoom, not a scale transform: the screen's layout box shrinks too, so it can't widen the page. */}
                <div className="deck-card rounded-[14px]" style={{ width: SCREEN.w, height: SCREEN.h, zoom: CARD_SCALE * k }}>
                  {it.screen}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid max-w-[600px]">
        {items.map((it, i) => (
          <div key={it.tab} role="tabpanel" id={`view-panel-${i}`} aria-labelledby={`view-tab-${i}`} aria-hidden={i !== front}
            className="[grid-area:1/1] transition-opacity duration-500" style={{ opacity: i === front ? 1 : 0 }}>
            <h2 className="text-[26px] leading-[1.2] font-light text-ink sm:text-[32px]">{it.title}</h2>
            <p className="mt-2.5 text-[16px] leading-[1.6] text-mut sm:text-[18px]">{it.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
