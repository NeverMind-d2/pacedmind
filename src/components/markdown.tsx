import type { ReactNode } from "react";

/*
 * The small part of Markdown that agents write in reports: headings, paragraphs, lists, quotes, code and
 * tables (shown as they are), with `code`, **bold**, *italic* and links inline. It builds React elements,
 * never HTML, and only http(s) addresses become links.
 */

type Block =
  | { kind: "p" | "quote"; text: string }
  | { kind: "h"; text: string }
  | { kind: "ul" | "ol"; items: { text: string; depth: number }[] }
  | { kind: "pre"; text: string };

const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBER = /^(\s*)\d+[.)]\s+(.*)$/;
const startsBlock = (line: string) => /^\s*(```|#{1,6}\s|>|\|)/.test(line) || BULLET.test(line) || NUMBER.test(line);

function blocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      out.push({ kind: "pre", text: body.join("\n") });
      i++;
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) { out.push({ kind: "h", text: heading[1] }); i++; continue; }
    if (/^\s*\|/.test(line)) {
      const rows: string[] = [];
      for (; i < lines.length && /^\s*\|/.test(lines[i]); i++) rows.push(lines[i].trim());
      out.push({ kind: "pre", text: rows.join("\n") });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ""));
      out.push({ kind: "quote", text: quote.join(" ") });
      continue;
    }
    const list = BULLET.test(line) ? BULLET : NUMBER.test(line) ? NUMBER : null;
    if (list) {
      const items: { text: string; depth: number }[] = [];
      while (i < lines.length) {
        const m = list.exec(lines[i]);
        if (m) {
          items.push({ text: m[2], depth: Math.min(3, Math.floor(m[1].replace(/\t/g, "  ").length / 2)) });
          i++;
        } else if (items.length && /^\s+\S/.test(lines[i]) && !startsBlock(lines[i])) {
          items[items.length - 1].text += ` ${lines[i].trim()}`;
          i++;
        } else break;
      }
      out.push({ kind: list === BULLET ? "ul" : "ol", items });
      continue;
    }
    const para: string[] = [];
    for (; i < lines.length && lines[i].trim() && !startsBlock(lines[i]); i++) para.push(lines[i].trim());
    out.push({ kind: "p", text: para.join(" ") });
  }
  return out;
}

// Link text and addresses have a length limit, so a long run of unclosed brackets can't make a text slow to show.
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]{1,300})\]\((https?:\/\/[^)\s]{1,2000})\)|(https?:\/\/[^\s)<>]+[^\s)<>.,;:!?'"])|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|(?<!\w)_([^_\s][^_]*?)_(?!\w)/g;

const linkClass = "text-fg2 underline decoration-line-strong underline-offset-2 hover:decoration-fg3";

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = out.length;
    if (m[1] !== undefined) out.push(<code key={key} className="rounded bg-hover px-1 py-px font-mono text-[11.5px] text-fg3">{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={key} className="font-semibold text-fg2">{m[2]}</strong>);
    else if (m[3] !== undefined) out.push(<a key={key} href={m[4]} target="_blank" rel="noreferrer" className={linkClass}>{m[3]}</a>);
    else if (m[5] !== undefined) out.push(<a key={key} href={m[5]} target="_blank" rel="noreferrer" className={`${linkClass} break-all`}>{m[5]}</a>);
    else out.push(<em key={key}>{m[6] ?? m[7]}</em>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Inline Markdown only: for one-line texts such as a criterion's note or a question. */
export function InlineMarkdown({ text }: { text: string }) {
  return <>{inline(text)}</>;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 text-[12.5px] leading-relaxed text-mut ${className ?? ""}`}>
      {blocks(text).map((b, i) => {
        switch (b.kind) {
          case "h":
            return <p key={i} className="pt-1 font-medium text-fg2">{inline(b.text)}</p>;
          case "p":
            return <p key={i}>{inline(b.text)}</p>;
          case "quote":
            return <p key={i} className="border-l-2 border-line-strong pl-3 text-mut2">{inline(b.text)}</p>;
          case "pre":
            return <pre key={i} className="overflow-x-auto rounded-md border border-line bg-raised px-3 py-2 font-mono text-[11.5px] leading-[1.55] text-fg3">{b.text}</pre>;
          default: {
            const Tag = b.kind === "ul" ? "ul" : "ol";
            return (
              <Tag key={i} className={`flex flex-col gap-1 pl-5 ${b.kind === "ul" ? "list-disc" : "list-decimal"} marker:text-dim`}>
                {b.items.map((it, k) => <li key={k} style={it.depth ? { marginLeft: it.depth * 16 } : undefined}>{inline(it.text)}</li>)}
              </Tag>
            );
          }
        }
      })}
    </div>
  );
}
