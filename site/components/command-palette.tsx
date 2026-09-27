"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { SITE, trackDownload } from "@/lib/site";
import type { IconName } from "./screens/parts";
import { Keys, Pane, Sym, type GlyphName, type PaneId } from "./palette/panes";
import s from "./command-palette.module.css";

// The app's command palette (Ctrl K, src/components/command-palette.tsx in the app) as a place to try PacedMind.
// Each command shows its result, drawn like the app, so the list is also a list of what PacedMind does. The first
// time the palette is on screen it types "Plan my day" by itself and runs it; after that it's the visitor's.

type Command = {
  id: string; group: string; label: string; icon: IconName | GlyphName; keys: string;
  pane?: PaneId; href?: string; hint?: string; disabled?: boolean; say?: string;
};

const COMMANDS: Command[] = [
  { id: "plan", group: "Plan", label: "Plan my day", icon: "calendar", pane: "plan", keys: "today schedule calendar focus time blocks deadlines auto-plan",
    say: "Plan my day: checks for three finished sessions after the focus block; after lunch, the dentist and the Q4 slides, which are due at 17:00." },
  { id: "waiting", group: "Plan", label: "What’s waiting for me?", icon: "bell", pane: "waiting", hint: "dot", keys: "review report finished sessions mark done request changes",
    say: "WEB-12, Write the pricing page. Claude Code finished at 10:42, and its report is waiting for you." },
  { id: "terminal", group: "Agents", label: "Start WEB-16 with Claude Code in a terminal", icon: "terminal", pane: "terminal", keys: "session claude code terminal command line",
    say: "WEB-16 opened in a new terminal with Claude Code, in the task's folder, with its first message." },
  { id: "app", group: "Agents", label: "Open WEB-10 in the Claude app", icon: "appWindow", pane: "app", keys: "claude app desktop session first message",
    say: "WEB-10 opened in the Claude app with its first message written. Send it there to start." },
  { id: "cloud", group: "Agents", label: "Send WEB-14 to Codex cloud", icon: "cloud", pane: "cloud", keys: "codex cloud branch repository session",
    say: "WEB-14 went to Codex cloud, on the branch agent/web-14. PacedMind checked every minute and marked it finished at 13:20." },
  { id: "flow", group: "Agents", label: "Connect WEB-14 to WEB-16", icon: "flow", pane: "flow", keys: "flow next session automatically mark done same session set time",
    say: "Connect WEB-14 to WEB-16. Choose how WEB-16 starts." },
  { id: "more", group: "Agents", label: "Start with another agent", icon: "plus", pane: "more", hint: "Coming soon", disabled: true, keys: "harness harnesses agents",
    say: "Support for more agent harnesses is coming soon." },
  { id: "windows", group: "Get PacedMind", label: "Download for Windows", icon: "download", href: SITE.downloads.windows, keys: "install free" },
  { id: "mac", group: "Get PacedMind", label: "Download for macOS", icon: "download", href: SITE.downloads.mac, keys: "install free apple" },
  { id: "pricing", group: "Get PacedMind", label: "See pricing", icon: "tag", keys: "price plans cost free cloud" },
];
const GROUPS = ["Plan", "Agents", "Get PacedMind"];
const TYPED = "Plan my day";
// Narrower than this, the result goes above the commands.
const SPLIT = 980;

const words = (q: string) => q.toLowerCase().replace(/’/g, "'").split(/\s+/).filter(Boolean);
const matches = (c: Command, q: string) => {
  const hay = `${c.label} ${c.keys}`.toLowerCase().replace(/’/g, "'");
  return words(q).every((w) => hay.includes(w));
};

const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (cb: () => void) => {
  const m = window.matchMedia(motionQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
// The site marks the visitor's system before the first paint (app/layout.tsx); it doesn't change. Neither does the
// page's HTML being the browser's, once it is.
const noSubscribe = () => () => {};

/**
 * PacedMind's command palette, to try: type to filter, move with the arrow keys, run with Enter, or tap. Ctrl K
 * (⌘ K) or "/" brings it into view from anywhere on the page. The static HTML shows it with Plan my day's result.
 */
export function CommandPalette({ className = "" }: { className?: string }) {
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => false);
  const mac = useSyncExternalStore(noSubscribe, () => document.documentElement.dataset.os === "mac", () => false);
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const [query, setQuery] = useState("");
  // The palette's own typing, the first time it's seen; `ran` once it has pressed Enter.
  const [typed, setTyped] = useState<{ text: string; ran?: boolean; picked?: boolean } | null>(null);
  const [active, setActive] = useState("plan");
  const [pane, setPane] = useState<PaneId>("plan");
  // Each time a result is shown it plays in; 0 is the page's own, which doesn't.
  const [shows, setShows] = useState(0);
  // The page's HTML shows the day planned. With motion, it's unplanned until the palette runs "Plan my day" itself,
  // or the visitor takes over.
  const [planRun, setPlanRun] = useState(false);
  const planned = planRun || !hydrated || reduced;
  // On screen with the tab visible; `ready` once the input has come well into the window.
  const [live, setLive] = useState(false);
  const [ready, setReady] = useState(false);
  const [width, setWidth] = useState(0);
  const [down, setDown] = useState("");
  const [said, setSaid] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const inputRow = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const played = useRef(false);
  const stop = useRef<(() => void) | null>(null);
  const pointer = useRef("mouse");
  const id = useId();

  const q = typed ? typed.text : query;
  const shown = COMMANDS.filter((c) => matches(c, q));
  const current = shown.find((c) => c.id === active) ?? shown[0];
  const wide = width >= SPLIT;

  const press = (key: string) => {
    setDown(key);
    window.setTimeout(() => setDown((d) => (d === key ? "" : d)), 160);
  };
  // The visitor takes over: the palette's own typing stops (or never starts), with the day planned.
  const takeOver = () => {
    played.current = true;
    setPlanRun(true);
    stop.current?.();
  };
  const show = (c: Command) => {
    if (!c.pane) return;
    setPane(c.pane);
    setShows((n) => n + 1);
  };

  const run = (c: Command | undefined) => {
    if (!c) return;
    takeOver();
    if (c.href) {
      trackDownload(c.id === "mac" ? "mac" : "windows", "palette");
      window.location.href = c.href;
      return;
    }
    if (c.id === "pricing") {
      const el = document.getElementById("pricing");
      if (location.hash === "#pricing") el?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
      else location.hash = "pricing";
      return;
    }
    show(c);
    setActive(c.id);
    setQuery("");
    setSaid(c.say ?? "");
    // Stacked, the result is above the commands: bring it into view.
    const r = root.current?.getBoundingClientRect();
    if (!wide && r && (r.top < 0 || r.top > innerHeight * 0.45)) root.current?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  };

  // Moving through the commands shows each one's result, where there's room for it beside them.
  const choose = (c: Command | undefined) => {
    if (!c) return;
    setActive(c.id);
    if (wide && c.pane !== pane) show(c);
  };

  // The width decides between side by side and stacked. Motion runs while the palette is in the upper part of the
  // window; its typing starts once the whole input is there, however tall the palette is.
  useEffect(() => {
    const el = root.current;
    if (!el || !inputRow.current) return;
    let onScreen = false;
    const update = () => setLive(onScreen && !document.hidden);
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === el) onScreen = entry.isIntersecting;
        else if (entry.intersectionRatio === 1) setReady(true);
      }
      update();
    }, { rootMargin: "0px 0px -30% 0px", threshold: [0, 1] });
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    io.observe(el);
    io.observe(inputRow.current);
    ro.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  // The one orchestrated moment: it types "Plan my day", presses Enter, the day gets planned, and it hands over.
  useEffect(() => {
    if (!live || !ready || played.current) return;
    played.current = true;
    if (window.matchMedia(motionQuery).matches) return;
    const timers: number[] = [];
    let ms = 0;
    const at = (fn: () => void) => timers.push(window.setTimeout(fn, ms));
    at(() => setTyped({ text: "" }));
    ms += 450;
    for (let i = 1; i <= TYPED.length; i++) {
      ms += 55 + ((i * 29) % 50);
      at(() => setTyped({ text: TYPED.slice(0, i) }));
    }
    ms += 420;
    at(() => press("Enter"));
    ms += 160;
    at(() => {
      setTyped({ text: TYPED, ran: true });
      setPlanRun(true);
      setPane("plan");
      setShows((n) => n + 1);
      setSaid(COMMANDS[0].say!);
    });
    ms += 1500;
    at(() => setTyped({ text: TYPED, ran: true, picked: true }));
    ms += 520;
    at(() => stop.current?.());
    stop.current = () => {
      timers.forEach(window.clearTimeout);
      stop.current = null;
      setTyped(null);
      setPlanRun(true);
    };
    // Leaving the window, or the page, ends it where it's going: the day planned.
    return () => stop.current?.();
  }, [live, ready]);

  // Ctrl K (⌘ K), or "/" outside a text field, brings the palette into view with its input ready.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const commandK = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k";
      const field = (e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]");
      if (!commandK && (e.key !== "/" || field || e.ctrlKey || e.metaKey || e.altKey)) return;
      e.preventDefault();
      takeOver();
      if (commandK) press("k");
      const el = root.current!;
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) {
        el.scrollIntoView({ block: r.height > innerHeight ? "start" : "center", behavior: window.matchMedia(motionQuery).matches ? "auto" : "smooth" });
      }
      input.current?.focus({ preventScroll: true });
      input.current?.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // The selection bar sits under the chosen command, and glides once it's been placed.
  useLayoutEffect(() => {
    const b = bar.current;
    const el = current && list.current?.querySelector<HTMLElement>(`[data-command="${current.id}"]`);
    if (!b) return;
    b.style.opacity = el ? "1" : "0";
    if (!el) return;
    b.style.transform = `translateY(${el.offsetTop}px)`;
    b.style.height = `${el.offsetHeight}px`;
    b.toggleAttribute("data-disabled", !!current.disabled);
    requestAnimationFrame(() => b.setAttribute("data-glide", ""));
  });

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      press(e.key);
      const i = current ? shown.indexOf(current) : -1;
      choose(shown[(i + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      press("Enter");
      run(current);
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      press("Escape");
      setQuery("");
    }
  };

  const listId = `${id}-list`;
  const cap = (k: string, label: string, cls = "") => <kbd className={`${s.key} ${cls}`} data-down={down === k || undefined}>{label}</kbd>;

  return (
    <div ref={root} data-nosnippet="" data-filtering={(typed ? !typed.ran : !!query) || undefined} data-still={!live || undefined}
      onPointerDown={takeOver} className={`${s.palette} scroll-mt-6 ${className}`}>
      <div className={s.frame}>
        <div ref={inputRow} className={`${s.inputRow} ${typed ? s.typing : ""} flex h-[62px] items-center gap-3.5 border-b border-app-line bg-app-panel pl-6 pr-5`}>
          <Sym name="search" size={19} className="text-app-mut2" />
          <div className="relative h-full min-w-0 flex-1">
            <input ref={input} value={query} role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
              aria-activedescendant={current ? `${id}-${current.id}` : undefined} aria-label="Command" aria-describedby={`${id}-help`}
              placeholder="Type a command" autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="go"
              onFocus={takeOver} onKeyDown={onKeyDown}
              onChange={(e) => {
                const v = e.target.value;
                setQuery(v);
                if (words(v).length) choose(COMMANDS.find((c) => matches(c, v)));
              }}
              className="h-full w-full bg-transparent text-[22px] text-app-strong outline-none placeholder:text-app-dim" />
            {typed && (
              <div aria-hidden="true" className={`${s.typed} pointer-events-none absolute inset-0 flex items-center whitespace-pre text-[22px] text-app-strong`}>
                <span className={typed.picked ? s.picked : ""}>{typed.text}</span><span className={s.caret} />
              </div>
            )}
          </div>
          <span className={`${s.modHint} flex gap-1 transition-opacity`} aria-hidden="true">{cap("k", mac ? "⌘" : "Ctrl")}{cap("k", "K")}</span>
        </div>
        <p id={`${id}-help`} className="sr-only">Use the up and down arrow keys to choose a command and Enter to run it.</p>

        <div className={s.body}>
          <div ref={list} id={listId} role="listbox" aria-label="Commands" className={s.list}
            onPointerDown={(e) => { pointer.current = e.pointerType; }}>
            <span ref={bar} className={s.bar} aria-hidden="true" style={{ transform: "translateY(36px)" }} />
            {GROUPS.map((group) => {
              const items = shown.filter((c) => c.group === group);
              return items.length > 0 && (
                <div key={group} role="group" aria-labelledby={`${id}-${group}`}>
                  <div id={`${id}-${group}`} role="presentation" className="flex h-7 items-end px-3 pb-1.5 text-[12px] text-app-mut2">{group}</div>
                  {items.map((c) => (
                    <div key={c.id} id={`${id}-${c.id}`} data-command={c.id} role="option" aria-selected={c === current} aria-disabled={c.disabled || undefined}
                      className={s.option}
                      onClick={() => {
                        setActive(c.id);
                        run(c);
                        if (pointer.current === "mouse" && !c.href) input.current?.focus({ preventScroll: true });
                      }}>
                      <Sym name={c.icon} size={15} />
                      <span className="min-w-0 flex-1"><Keys text={c.label} mono /></span>
                      {c.hint === "dot"
                        ? <span className={`${s.hint} flex items-center`}><i className="h-1.5 w-1.5 rounded-full bg-app-accent" /><span className="sr-only">, something is waiting</span></span>
                        : c.hint && <span className={`${s.hint} shrink-0 text-[12px]`}>{c.hint}</span>}
                      <span aria-hidden="true" className="contents">{cap("Enter", "↵", s.runKey)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
            {shown.length === 0 && <p className="px-3.5 py-6 text-center text-[12.5px] text-app-mut2">No matches. Try “plan”, “codex” or “flow”.</p>}
          </div>

          <div className={s.result} role="region" aria-label="Result">
            <div key={shows} className={`${s.pane} ${shows ? s.play : ""}`}>
              <Pane id={pane} planned={planned} />
            </div>
          </div>
        </div>

        <div className="flex h-11 items-center gap-5 border-t border-app-line bg-app-panel px-[18px] text-[12px] whitespace-nowrap text-app-mut2">
          <span className={`${s.keysHint} flex items-center gap-[7px]`}>{cap("ArrowUp", "↑")}<span className="-ml-1">{cap("ArrowDown", "↓")}</span>to move</span>
          <span className={`${s.keysHint} flex items-center gap-[7px]`}>{cap("Enter", "↵")}to run</span>
          <span className={`${s.keysHint} flex items-center gap-[7px]`}>{cap("Escape", "Esc")}to clear</span>
          <span className={`${s.keysHint} ${s.footWide} ml-auto flex items-center gap-[7px]`}>
            {cap("k", mac ? "⌘" : "Ctrl")}<span className="-ml-1">{cap("k", "K")}</span>from anywhere on this page
          </span>
          <span className={s.touchHint}>Tap a command to run it.</span>
        </div>
      </div>
      <p aria-live="polite" className="sr-only">{said}</p>
    </div>
  );
}
