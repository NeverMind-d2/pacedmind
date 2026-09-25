"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addMinutes, format } from "date-fns";
import { createEventAction, createTaskAction } from "@/app/actions";
import { parseQuickAdd } from "@/lib/parse";
import { parseLocal, timeOf, toDateTimeStr, dateOnly } from "@/lib/dates";
import { PRIORITY_LABEL, STATUS_LABEL, type Area, type Priority, type Project, type Status } from "@/lib/types";
import { Icon, PriorityIcon, StatusIcon } from "./icons";
import { DateField } from "./date-field";
import { Button, Dot, Menu, Segmented, Switch, cx, toast, useAction } from "./ui";

type Defaults = { projectId?: string | null; areaId?: string | null; plannedDate?: string | null; mode?: "task" | "activity" };

const HIGHLIGHT: Record<string, string> = {
  date: "bg-accent/20 text-accent-fg",
  priority: "bg-accent/20 text-accent-fg",
  label: "bg-accent/20 text-accent-fg",
  project: "bg-accent/20 text-accent-fg",
  duration: "bg-ink/10 text-fg2",
  repeat: "bg-accent/20 text-accent-fg",
};

export function QuickAdd({ areas, projects }: { areas: Area[]; projects: Project[] }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"task" | "activity">("task");
  const [text, setText] = useState("");
  const [desc, setDesc] = useState("");
  // "Done when" items, one per line; null while the field is hidden.
  const [doneWhen, setDoneWhen] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [scroll, setScroll] = useState(0);
  const [defaults, setDefaults] = useState<Defaults>({});
  const [ov, setOv] = useState<{
    areaId?: string | null; projectId?: string | null; status?: Status; priority?: Priority; due?: string | null; planned?: string | null; weekly?: boolean; duration?: number;
  }>({});
  const input = useRef<HTMLInputElement>(null);
  const { pending, run } = useAction();

  useEffect(() => {
    const show = (e: Event) => {
      const d = ((e as CustomEvent).detail ?? {}) as Defaults;
      setDefaults(d);
      setMode(d.mode ?? "task");
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.closest("input, textarea, select, [contenteditable=true]");
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        setDefaults({});
        setMode("task");
        setOpen(true);
      }
    };
    window.addEventListener("organizer:new", show);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("organizer:new", show); window.removeEventListener("keydown", onKey); };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open, mode]);

  const parsed = useMemo(() => parseQuickAdd(text), [text]);
  const projectFromText = parsed.projectQuery
    ? projects.find((p) => p.id.startsWith(parsed.projectQuery!) || p.name.toLowerCase().startsWith(parsed.projectQuery!))
    : undefined;
  const projectId = ov.projectId !== undefined ? ov.projectId : (projectFromText?.id ?? defaults.projectId ?? null);
  const project = projects.find((p) => p.id === projectId) ?? null;
  const areaId = ov.areaId !== undefined ? ov.areaId : (project?.areaId ?? defaults.areaId ?? null);
  const area = areas.find((a) => a.id === areaId) ?? null;
  const status = ov.status ?? "todo";
  const priority = ov.priority ?? parsed.priority ?? 0;
  const due = ov.due !== undefined ? ov.due : parsed.date;
  const planned = ov.planned !== undefined ? ov.planned : (defaults.plannedDate ?? null);
  const weekly = ov.weekly ?? parsed.weekly;
  const duration = ov.duration ?? parsed.durationMin ?? 60;
  const start = mode === "activity" ? (parsed.date && parsed.hasTime ? parsed.date : ov.due ?? null) : null;

  // One item per line; list markers someone typed or pasted ("- ", "1. ") are dropped.
  const doneItems = (doneWhen ?? "").split("\n").map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()).filter(Boolean);

  const close = () => {
    setOpen(false);
    setText("");
    setDesc("");
    setDoneWhen(null);
    setOv({});
  };

  const submit = () => {
    const title = parsed.title || text.trim();
    if (!title) { toast("Give it a title first", "error"); return; }
    if (mode === "task") {
      run(async () => {
        const r = await createTaskAction({
          title, description: desc, areaId, projectId, status, priority, dueDate: due, plannedDate: planned,
          labels: parsed.labels, estimateMin: parsed.durationMin ?? undefined, doneWhen: doneItems,
        });
        if (r.ok) toast(`Created ${r.key}`);
        return r.ok ? undefined : r;
      });
    } else {
      const st = start ?? toDateTimeStr(new Date());
      const s = parseLocal(st);
      run(async () => {
        const r = await createEventAction({
          title, areaId, start: toDateTimeStr(s), end: toDateTimeStr(addMinutes(s, duration)), recurrence: weekly ? "weekly" : null,
        });
        if (r.ok) toast(`Added ${title} to the calendar`);
        return r.ok ? undefined : r;
      });
    }
    if (more) { setText(""); setDesc(""); setDoneWhen(null); setOv({}); input.current?.focus(); } else close();
  };

  if (!open) return null;

  const segments: { text: string; cls?: string }[] = [];
  let pos = 0;
  for (const t of parsed.tokens) {
    if (t.index < pos) continue;
    segments.push({ text: text.slice(pos, t.index) });
    segments.push({ text: text.slice(t.index, t.index + t.text.length), cls: HIGHLIGHT[t.kind] });
    pos = t.index + t.text.length;
  }
  segments.push({ text: text.slice(pos) });

  const summary = mode === "task"
    ? [due && `due ${format(parseLocal(due), timeOf(due) ? "EEE d MMM 'at' HH:mm" : "EEE d MMM")}`,
      priority ? `${PRIORITY_LABEL[priority].toLowerCase()} priority` : null,
      parsed.labels.length ? `label ${parsed.labels.join(", ")}` : null,
      project && `in ${project.name}`,
      parsed.durationMin && `about ${parsed.durationMin} min`].filter(Boolean).join(", ")
    : [start ? format(parseLocal(start), "EEE d MMM, HH:mm") : "Starts now", `${duration} min`, weekly && "repeats weekly"].filter(Boolean).join(", ");

  const chip = "flex h-7 items-center gap-1.5 rounded-md border border-ctl bg-hover px-2 text-[12.5px] text-fg3 hover:bg-sel";
  const found = "border-accent/45 bg-accent/10 text-accent-fg";

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-overlay pt-24 max-md:px-3 max-md:pt-3" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-label={mode === "task" ? "New task" : "New activity"}
        className="flex h-fit w-[640px] max-w-full flex-col rounded-xl border border-line2 bg-raised shadow-[var(--shadow-popover)]"
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
        }}>
        <div className="flex h-12 items-center gap-2 pl-4 pr-3">
          <Menu
            trigger={<button type="button" className={chip}>{area ? <Dot color={area.color} size={7} /> : <Icon name="inbox" size={13} />}{area?.name ?? "Inbox"}<Icon name="chevronDown" size={12} /></button>}
            items={[{ value: null as string | null, label: "Inbox, no area", icon: <Icon name="inbox" size={13} /> },
              ...areas.map((a) => ({ value: a.id as string | null, label: a.name, icon: <Dot color={a.color} size={7} /> }))]}
            onSelect={(v) => setOv((o) => ({ ...o, areaId: v, projectId: v && project?.areaId !== v ? null : o.projectId }))}
          />
          <span className="text-faint">›</span>
          <span className="text-[12.5px] text-mut">{mode === "task" ? "New task" : "New activity"}</span>
          <span className="flex-1" />
          <Segmented value={mode} onChange={setMode} options={[{ value: "task", label: "Task" }, { value: "activity", label: "Activity" }]} />
          <button type="button" aria-label="Close" onClick={close} className="flex h-7 w-7 items-center justify-center rounded-md text-mut hover:bg-hover">
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-2 px-5 pt-1.5">
          <div className="relative overflow-hidden">
            <div aria-hidden className="pointer-events-none absolute inset-0 whitespace-pre text-[18px] font-medium leading-7 text-strong" style={{ transform: `translateX(${-scroll}px)` }}>
              {segments.map((s, i) => <span key={i} className={cx(s.cls, s.cls && "rounded-[3px]")}>{s.text}</span>)}
            </div>
            <input
              ref={input}
              value={text}
              onChange={(e) => { setText(e.target.value); setScroll(e.target.scrollLeft); }}
              onKeyUp={(e) => setScroll(e.currentTarget.scrollLeft)}
              onScroll={(e) => setScroll(e.currentTarget.scrollLeft)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); submit(); } }}
              aria-label={mode === "task" ? "Task title" : "Activity title"}
              placeholder={mode === "task" ? "Send invoice to Acme friday 10:00 !high #finance" : "Climbing with Tomek friday 18:00 for 2h every week"}
              className="relative w-full bg-transparent text-[18px] font-medium leading-7 text-transparent caret-strong outline-none placeholder:text-dim"
            />
          </div>
          <textarea aria-label="Description" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} placeholder="Add description…"
            className="w-full resize-none bg-transparent text-[13.5px] leading-relaxed text-fg3 outline-none placeholder:text-mut2" />
          {mode === "task" && doneWhen !== null && (
            <div className="flex flex-col gap-1 border-t border-line pb-1 pt-2.5">
              <span className="text-[12px] font-medium text-fg3">Done when</span>
              <textarea aria-label="Done when" value={doneWhen} onChange={(e) => setDoneWhen(e.target.value)} rows={3} autoFocus
                placeholder={"One per line, e.g.\nThe export downloads the rows for the current filters\nA screenshot of the new button"}
                className="field-sizing-content min-h-[60px] w-full resize-none bg-transparent text-[13px] leading-relaxed text-fg3 outline-none placeholder:text-dim" />
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 px-5 pb-3.5">
          {mode === "task" ? (
            <>
              <Menu trigger={<button type="button" className={chip}><StatusIcon status={status} size={13} />{STATUS_LABEL[status]}</button>}
                items={(["backlog", "todo", "progress"] as Status[]).map((s) => ({ value: s, label: STATUS_LABEL[s], icon: <StatusIcon status={s} size={13} /> }))}
                onSelect={(v) => setOv((o) => ({ ...o, status: v }))} />
              <Menu trigger={<button type="button" className={cx(chip, parsed.priority && ov.priority === undefined && found)}><PriorityIcon priority={priority} size={13} />{PRIORITY_LABEL[priority]}</button>}
                items={([1, 2, 3, 4, 0] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p], icon: <PriorityIcon priority={p} size={13} /> }))}
                onSelect={(v) => setOv((o) => ({ ...o, priority: v }))} />
              <DateField value={due} onChange={(v) => setOv((o) => ({ ...o, due: v }))}
                trigger={<button type="button" className={cx(chip, parsed.date && ov.due === undefined && found)}><Icon name="flag" size={13} />{due ? format(parseLocal(due), timeOf(due) ? "EEE d MMM, HH:mm" : "EEE d MMM") : "Due date"}</button>} />
              <DateField value={planned} withTime={false} onChange={(v) => setOv((o) => ({ ...o, planned: v ? dateOnly(v) : null }))}
                trigger={<button type="button" className={chip}><Icon name="calendarCheck" size={13} />{planned ? `Planned ${format(parseLocal(planned), "EEE d MMM")}` : "Plan for a day"}</button>} />
              <Menu trigger={<button type="button" className={cx(chip, projectFromText && ov.projectId === undefined && found)}><Icon name="layers" size={13} />{project?.name ?? "Project"}</button>}
                items={[{ value: null as string | null, label: "No project" },
                  ...projects.filter((p) => !areaId || p.areaId === areaId).map((p) => ({ value: p.id as string | null, label: p.name }))]}
                onSelect={(v) => setOv((o) => ({ ...o, projectId: v, areaId: v ? projects.find((p) => p.id === v)?.areaId ?? o.areaId : o.areaId }))} />
              {parsed.labels.map((l) => (
                <span key={l} className={cx(chip, found)}><Icon name="tag" size={13} />{l}</span>
              ))}
              <button type="button" aria-pressed={doneWhen !== null} onClick={() => setDoneWhen((d) => (d === null ? "" : d.trim() ? d : null))}
                title="What must be true when it's done" className={cx(chip, doneItems.length > 0 && found)}>
                <Icon name="target" size={13} />{doneItems.length ? `Done when · ${doneItems.length}` : "Done when"}
              </button>
            </>
          ) : (
            <>
              <DateField value={start} onChange={(v) => setOv((o) => ({ ...o, due: v }))}
                trigger={<button type="button" className={cx(chip, parsed.date && found)}><Icon name="calendar" size={13} />{start ? format(parseLocal(start), "EEE d MMM, HH:mm") : "When"}</button>} />
              <Menu trigger={<button type="button" className={cx(chip, parsed.durationMin && found)}><Icon name="clock" size={13} />{duration} min</button>}
                items={[15, 30, 45, 60, 90, 120, 180].map((m) => ({ value: m, label: `${m} min` }))}
                onSelect={(v) => setOv((o) => ({ ...o, duration: v }))} />
              <button type="button" onClick={() => setOv((o) => ({ ...o, weekly: !weekly }))} className={cx(chip, weekly && found)}>
                <Icon name="repeat" size={13} />{weekly ? "Every week" : "Does not repeat"}
              </button>
            </>
          )}
        </div>

        <div className="flex h-9 items-center gap-2 border-t border-line px-5 text-[12px] text-mut2">
          <Icon name="check" size={13} className="text-accent" />
          <span className="flex-1 truncate">{summary || "Type a title. Dates, !priority, #labels and @project are picked up as you type."}</span>
        </div>
        <div className="flex h-14 items-center gap-2 border-t border-line pl-5 pr-3">
          <Switch on={more} onChange={setMore} label="Create more" />
          <span className="text-[12.5px] text-mut">Create more</span>
          <span className="flex-1" />
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={pending} onClick={submit} className="h-8 px-3">
            {mode === "task" ? "Create task" : "Add to calendar"} <span className="rounded bg-ink/15 px-1.5 font-mono text-[10.5px] max-md:hidden">Ctrl ↵</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
