"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { SCREEN } from "./screens/parts";

export type DeckItem = { tab: string; title: string; body: string; screen: ReactNode };

const HOLD = 6000;
const EASE = "cubic-bezier(0.65, 0, 0.35, 1)";
// Where the front and back screens sit on a 1056 × 780 stage, with any others evenly between them; everything
// scales with the stage.
const STAGE = { w: 1056, h: 780 };
const FRONT = [0, 236, 0];
const BACK = [275, 0, -260];
const slot = (role: number, count: number) => FRONT.map((f, i) => f + ((BACK[i] - f) * role) / Math.max(1, count - 1));
const CARD_SCALE = 0.74;
// The part of the stage the tilted screens cover, measured in the browser. The deck's box is cut to it, so the
// tabs sit right under the screens and the screens' edges are the deck's edges.
const CROP = { l: -30, t: 54, r: 960, b: 720 };
const VIEW = { w: CROP.r - CROP.l, h: CROP.b - CROP.t };

const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (cb: () => void) => {
  const m = window.matchMedia(motionQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/**
 * The app's screens in 3D. Each holds the front for a few seconds, then steps back as the next comes forward;
 * the line under its tab shows the time left. Picking a tab stops the cycle; hovering pauses it.
 * It renders two boxes, the screens and their controls, so a page grid can place them separately.
 */
export function ScreenDeck({ items, className = {} }: { items: DeckItem[]; className?: { stage?: string; controls?: string } }) {
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
      setK(Math.min(1, el.clientWidth / VIEW.w));
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

  // A screen that moves between the front and the back fades out while it passes the others. Two screens swap
  // places, so only the one leaving the front fades.
  useEffect(() => {
    const n = items.length;
    const roles = items.map((_, i) => (i - front + n) % n);
    roles.forEach((role, i) => {
      const last = lastRoles.current[i];
      if (!reduced && n > 1 && Math.abs(role - last) === n - 1 && (n > 2 || last === 0)) {
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

  const hover = { onPointerEnter: () => setPaused(true), onPointerLeave: () => setPaused(document.hidden) };

  return (
    <>
      {/*
        The screens first; the tabs and the caption under them act as their controls. The box shows only the cropped
        part of the stage, and the full stage sits inside it at an offset; the perspective point moves with it.
      */}
      <div ref={stageRef} {...hover} className={`deck-stage relative w-full ${sized ? "is-sized" : ""} ${className.stage ?? ""}`}
        style={{
          maxWidth: VIEW.w, aspectRatio: `${VIEW.w} / ${VIEW.h}`, perspective: `${2400 * k}px`,
          perspectiveOrigin: `${(0.6 * STAGE.w - CROP.l) * k}px ${(0.4 * STAGE.h - CROP.t) * k}px`,
        }}>
        <div className="deck-layer absolute" style={{
          left: -CROP.l * k, top: -CROP.t * k, width: STAGE.w * k, height: STAGE.h * k,
          transformStyle: "preserve-3d", transform: "rotateX(7deg) rotateY(10deg)",
        }}>
          {items.map((it, i) => {
            const role = (i - front + items.length) % items.length;
            const [x, y, z] = slot(role, items.length);
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

      <section aria-label="PacedMind's views" {...hover} className={`mt-6 sm:mt-8 ${className.controls ?? ""}`}
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

        <div className="mt-5 grid max-w-[560px]">
          {items.map((it, i) => (
            <div key={it.tab} role="tabpanel" id={`view-panel-${i}`} aria-labelledby={`view-tab-${i}`} aria-hidden={i !== front}
              className="[grid-area:1/1] transition-opacity duration-500" style={{ opacity: i === front ? 1 : 0 }}>
              <h2 className="text-[19px] leading-[1.3] text-ink">{it.title}</h2>
              <p className="mt-1.5 text-[16px] leading-[1.6] text-mut">{it.body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
