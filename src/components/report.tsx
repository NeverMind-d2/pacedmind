"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import { parseLocal } from "@/lib/dates";
import { AGENT_LABEL, OUTCOME_LABEL, VERDICT_LABEL, type AgentId, type Attachment, type Report, type ReportCriterion } from "@/lib/types";
import { Icon, VerdictIcon } from "./icons";
import { InlineMarkdown, Markdown } from "./markdown";
import { Button, cx } from "./ui";

/* What an agent handed back: the report card body, its images and the full-size viewer. */

/** Compares "Done when" texts the way the server matches them. */
export const sameText = (a: string, b: string) => norm(a) === norm(b);
const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();

export const imageUrl = (a: Attachment) => `/api/attachments/${a.id}`;

export function criteriaCount(criteria: ReportCriterion[]): string {
  const met = criteria.filter((c) => c.verdict === "met").length;
  return `${met} of ${criteria.length} met`;
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[12px] font-medium text-fg3">
        {title}
        {aside && <span className="font-normal text-mut2">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

/** One "Done when" item with the agent's answer and note. */
export function CriterionRow({ c }: { c: ReportCriterion }) {
  return (
    <div className="flex items-start gap-2.5 py-[3px]">
      <span className="mt-[3px] shrink-0" title={c.verdict ? VERDICT_LABEL[c.verdict] : "Not answered"}>
        <VerdictIcon verdict={c.verdict ?? "unanswered"} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cx("text-[12.5px] leading-[1.5]", c.verdict === "met" ? "text-fg2" : "text-fg3")}>{c.text}</div>
        {(c.note || !c.verdict) && (
          <div className="text-[12px] leading-[1.5] text-mut2">{c.note ? <InlineMarkdown text={c.note} /> : "Not answered"}</div>
        )}
      </div>
    </div>
  );
}

/** What the user asked to change after reading a report. */
export function ChangesNote({ report }: { report: Report }) {
  if (!report.changes) return null;
  return (
    <div className="flex flex-col gap-1 border-l-2 border-line-strong pl-3">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-fg3">
        <Icon name="user" size={12} className="text-mut2" />
        You asked for changes
        {report.changesAt && <span className="font-normal text-mut2">· {format(parseLocal(report.changesAt), "d MMM HH:mm")}</span>}
      </div>
      <p className="whitespace-pre-wrap text-[12.5px] leading-[1.55] text-fg2">{report.changes}</p>
    </div>
  );
}

/**
 * A report in a session's card. While the agent works on changes the user asked for (`working`), the
 * changes come first and the report they answer folds away.
 */
export function SessionReport({ report, criteria, working }: { report: Report; criteria: ReportCriterion[]; working: boolean }) {
  const [open, setOpen] = useState(false);
  if (!working) return <ReportBody report={report} criteria={criteria} />;
  return (
    <div className="flex flex-col gap-3">
      <ChangesNote report={report} />
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 self-start text-[12px] text-mut2 hover:text-fg2">
        <Icon name={open ? "chevronDown" : "chevronRight"} size={12} strokeWidth={2.2} />
        The report from {format(parseLocal(report.createdAt), "d MMM HH:mm")}
      </button>
      {open && <ReportBody report={report} criteria={criteria} hideChanges />}
    </div>
  );
}

/**
 * Asks for changes to a hand-back. The agent goes back to work in a new terminal: Claude Code continues its
 * conversation (`resumes`), otherwise a new one starts with the report and the changes.
 */
export function RequestChangesForm({ agent, resumes, pending, onSend, onCancel }: {
  agent: AgentId;
  resumes: boolean;
  pending: boolean;
  onSend: (changes: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const send = () => { if (text.trim() && !pending) onSend(text.trim()); };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line2 bg-raised p-2.5">
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label="What should change"
        placeholder="What should change? Be as specific as you'd be with a colleague."
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        className="field-sizing-content min-h-[76px] w-full resize-none bg-transparent text-[12.5px] leading-[1.55] text-fg2 outline-none placeholder:text-mut2" />
      <div className="text-[11.5px] leading-[1.45] text-mut2">
        {resumes
          ? `${AGENT_LABEL[agent]} continues its conversation in a new terminal.`
          : `${AGENT_LABEL[agent]} starts again in a new terminal, with its last report and your changes.`}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={!text.trim() || pending} onClick={send}>
          Send to {AGENT_LABEL[agent]} <span className="rounded bg-ink/15 px-1.5 font-mono text-[10.5px]">Ctrl ↵</span>
        </Button>
      </div>
    </div>
  );
}

/**
 * The body of a report: summary, the answered "Done when" items passed in `criteria` (the task panel shows
 * the rest on its own list), images, how to check, questions, details, links, follow-ups and the changes
 * the user asked for after reading it.
 */
export function ReportBody({ report, criteria, hideChanges }: { report: Report; criteria: ReportCriterion[]; hideChanges?: boolean }) {
  const long = report.details.length > 600 || report.details.split("\n").length > 10;
  const [open, setOpen] = useState(false);
  const clipped = long && !open;
  const web = (url: string) => /^https?:\/\//i.test(url);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-[1.6] text-fg2">
        {report.outcome !== "done" && (
          <span className="mr-2 inline-flex h-5 translate-y-[-1px] items-center rounded-full border border-line-strong px-2 align-middle text-[11.5px] font-medium text-fg3">
            {OUTCOME_LABEL[report.outcome]}
          </span>
        )}
        {report.summary}
      </p>

      {criteria.length > 0 && (
        <Section title="Done when" aside={criteriaCount(criteria)}>
          <div className="flex flex-col">{criteria.map((c, i) => <CriterionRow key={i} c={c} />)}</div>
        </Section>
      )}

      {report.images.length > 0 && <Gallery images={report.images} />}

      {report.questions.length > 0 && (
        <Section title={report.questions.length === 1 ? "Question for you" : "Questions for you"}>
          <ul className="flex flex-col gap-1.5">
            {report.questions.map((q, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[12.5px] leading-[1.5] text-fg2">
                <Icon name="help" size={14} className="mt-[2px] shrink-0 text-mut" />
                <span className="min-w-0"><InlineMarkdown text={q} /></span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {report.verify.length > 0 && (
        <Section title="How to check it">
          <ol className="flex flex-col gap-1">
            {report.verify.map((v, i) => (
              <li key={i} className="flex items-baseline gap-2.5 text-[12.5px] leading-[1.5] text-mut">
                <span className="w-3 shrink-0 text-right font-mono text-[11px] text-dim">{i + 1}</span>
                <span className="min-w-0"><InlineMarkdown text={v} /></span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {report.details && (
        <Section title="Details">
          <div className={cx("relative", clipped && "max-h-[150px] overflow-hidden")}>
            <Markdown text={report.details} />
            {clipped && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-panel to-transparent" />}
          </div>
          {long && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="self-start text-[12px] text-mut2 hover:text-fg2">
              {open ? "Show less" : "Show all"}
            </button>
          )}
        </Section>
      )}

      {(report.links.length > 0 || report.followUps.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {report.links.map((l, i) => web(l.url) ? (
            <a key={i} href={l.url} target="_blank" rel="noreferrer" title={l.url}
              className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border border-ctl px-2 text-[12px] text-fg3 hover:bg-hover">
              <Icon name="external" size={12} className="shrink-0 text-mut2" /><span className="truncate">{l.label}</span>
            </a>
          ) : (
            <span key={i} title={l.url} className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border border-line px-2 text-[12px] text-mut">
              <Icon name="link" size={12} className="shrink-0 text-mut2" /><span className="truncate">{l.label === l.url ? l.url : `${l.label} · ${l.url}`}</span>
            </span>
          ))}
          {report.followUps.map((f) => f.href ? (
            <Link key={f.key} href={f.href} title="Follow-up task"
              className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border border-ctl px-2 text-[12px] text-fg3 hover:bg-hover">
              <Icon name="plus" size={12} className="shrink-0 text-mut2" />
              <span className="font-mono text-[11px] text-mut2">{f.key}</span><span className="truncate">{f.title}</span>
            </Link>
          ) : (
            <span key={f.key} className="inline-flex h-6 items-center rounded-md border border-line px-2 font-mono text-[11px] text-mut2">{f.key}</span>
          ))}
        </div>
      )}

      {!hideChanges && <ChangesNote report={report} />}
    </div>
  );
}

/** Thumbnails; an odd count gives the first image the full width. Clicking one opens the viewer. */
export function Gallery({ images }: { images: Attachment[] }) {
  const [shown, setShown] = useState<number | null>(null);
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {images.map((a, i) => (
          <button key={a.id} type="button" onClick={() => setShown(i)} title={a.caption || "Open image"}
            className={cx("group flex min-w-0 flex-col gap-1 text-left", images.length % 2 === 1 && i === 0 && "col-span-2")}>
            <span className="block aspect-[16/10] w-full overflow-hidden rounded-md border border-line2 bg-raised group-hover:border-line-strong">
              {/* eslint-disable-next-line @next/next/no-img-element -- served from disk by /api/attachments, nothing to optimize */}
              <img src={imageUrl(a)} alt={a.caption || "Screenshot"} loading="lazy" decoding="async" className="h-full w-full object-cover object-top" />
            </span>
            {a.caption && <span className="line-clamp-2 text-[11.5px] leading-[1.45] text-mut2">{a.caption}</span>}
          </button>
        ))}
      </div>
      {shown !== null && <Lightbox images={images} start={shown} onClose={() => setShown(null)} />}
    </>
  );
}

/** Full-size images, one at a time. ← and → move, Escape closes, a click on the image shows it at its own size. */
export function Lightbox({ images, start, onClose }: { images: Attachment[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [actual, setActual] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const a = images[i];
  const go = (d: number) => { setI((x) => (x + d + images.length) % images.length); setActual(false); };

  useEffect(() => { box.current?.focus(); }, []);

  return createPortal(
    <div ref={box} role="dialog" aria-modal="true" aria-label="Image viewer" tabIndex={-1}
      className="fixed inset-0 z-[80] flex flex-col bg-bg/95 outline-none"
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); onClose(); }
        if (e.key === "ArrowRight" && images.length > 1) go(1);
        if (e.key === "ArrowLeft" && images.length > 1) go(-1);
      }}>
      <div className="flex h-12 shrink-0 items-center gap-3 px-4 text-[12.5px] text-mut">
        {images.length > 1 && <span className="font-mono text-[11.5px] text-mut2">{i + 1} / {images.length}</span>}
        <span className="min-w-0 flex-1 truncate text-fg2">{a.caption}</span>
        <span className="hidden font-mono text-[11px] text-dim sm:inline">
          {a.width && a.height ? `${a.width}×${a.height} · ` : ""}{format(parseLocal(a.createdAt), "d MMM HH:mm")}
        </span>
        <a href={imageUrl(a)} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-mut hover:bg-hover hover:text-fg2">
          <Icon name="external" size={13} />Open
        </a>
        <button type="button" aria-label="Close (Esc)" title="Close (Esc)" onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-mut hover:bg-hover hover:text-fg2">
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className={cx("relative flex min-h-0 flex-1", actual ? "overflow-auto" : "items-center justify-center px-14 pb-8")}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- served from disk by /api/attachments, nothing to optimize */}
        <img key={a.id} src={imageUrl(a)} alt={a.caption || "Screenshot"} onClick={() => setActual((x) => !x)}
          className={cx("rounded-md border border-line2", actual ? "m-auto max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain")} />
        {images.length > 1 && !actual && (
          <>
            <button type="button" aria-label="Previous image" onClick={() => go(-1)}
              className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-line2 bg-raised text-mut hover:text-fg2">
              <Icon name="chevronLeft" size={16} />
            </button>
            <button type="button" aria-label="Next image" onClick={() => go(1)}
              className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-line2 bg-raised text-mut hover:text-fg2">
              <Icon name="chevronRight" size={16} />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
