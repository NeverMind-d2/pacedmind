"use client";

import { useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Icon } from "@/components/screens/parts";
import { CONNECT } from "@/lib/content";
import { SITE, connectEvent } from "@/lib/site";

const AGENTS = CONNECT.agents;

// A link to #connect-<id>, such as the hero's, picks that agent.
const subscribeHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const linkedAgent = () => {
  const hash = window.location.hash;
  const id = hash.startsWith("#connect-") ? hash.slice("#connect-".length) : "";
  return AGENTS.some((a) => a.id === id) ? id : null;
};

/**
 * Where the links to one agent land: the top of the section or page that holds them, so its heading shows too.
 * Put them first in a positioned box.
 */
export function ConnectAnchors() {
  return AGENTS.map((a) => <span key={a.id} id={`connect-${a.id}`} aria-hidden="true" className="absolute top-0 scroll-mt-8" />);
}

/**
 * Connecting an agent to PacedMind Cloud: a tab for each agent, with its commands, its button or the server's address
 * to copy, and what happens next. The first agent shows until one is picked here or by a link.
 */
export function Connect({ className = "" }: { className?: string }) {
  const linked = useSyncExternalStore(subscribeHash, linkedAgent, () => null);
  // A pick here holds until a link picks another agent.
  const [pick, setPick] = useState<{ id: string; linked: string | null } | null>(null);
  const current = pick && pick.linked === linked ? pick.id : (linked ?? pick?.id ?? AGENTS[0].id);
  const agent = AGENTS.find((a) => a.id === current) ?? AGENTS[0];
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const choose = (id: string) => setPick({ id, linked });
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (AGENTS.indexOf(agent) + step + AGENTS.length) % AGENTS.length;
    choose(AGENTS[next].id);
    tabs.current[next]?.focus();
  };

  return (
    <div className={className}>
      <div role="tablist" aria-label="Agents" onKeyDown={onKey} className="flex flex-wrap gap-2">
        {AGENTS.map((a, i) => {
          const on = a.id === agent.id;
          return (
            <button key={a.id} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`connect-tab-${a.id}`}
              aria-selected={on} aria-controls="connect-panel" tabIndex={on ? 0 : -1} onClick={() => choose(a.id)}
              className={`flex h-10 items-center gap-2 rounded-[10px] border px-3.5 text-[15px] transition-colors sm:text-[16px] ${
                on ? "border-ink text-ink" : "border-line text-mut hover:border-mut hover:text-text"}`}>
              <Icon name={a.icon} size={15} />
              {a.name}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="connect-panel" aria-labelledby={`connect-tab-${agent.id}`} className="mt-8 sm:mt-10">
        <p className="max-w-[760px] text-[16px] leading-[1.6] text-text sm:text-[18px]">{agent.how}</p>
        {agent.open && <a href={agent.open.href} target="_blank" rel="noreferrer"
          className="mt-4 inline-block text-[16px] text-text underline underline-offset-4">{agent.open.label}</a>}
        {agent.commands && <Copyable agent={agent.id} lines={agent.commands} commands />}
        {agent.address && <Copyable agent={agent.id} lines={[SITE.mcp]} />}
        {agent.install && (
          <a href={agent.install.href} className="download mt-6" {...connectEvent(agent.id, "install")}>{agent.install.label}</a>
        )}
        <p className="mt-6 max-w-[760px] text-[16px] leading-[1.6] text-mut">{agent.then}</p>
      </div>

      <div className="mt-12 grid gap-x-14 gap-y-4 border-t border-line pt-8 text-[16px] leading-[1.6] text-mut sm:mt-14 md:grid-cols-2">
        <p>{CONNECT.account}</p>
        <p>
          {CONNECT.local}{" "}
          <a href={`${SITE.docs}/mcp/connect-cloud`} className="whitespace-nowrap text-text underline decoration-line underline-offset-4 hover:text-ink hover:decoration-mut">
            {CONNECT.details}
          </a>
        </p>
      </div>
    </div>
  );
}

/** Copies text: with the Clipboard API, else the older copy command, which some browsers allow when that's refused. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const done = document.execCommand("copy");
    area.remove();
    return done;
  }
}

/**
 * Text to copy with one click: commands (each after a prompt the copy leaves out) or the server's address. Where the
 * browser allows no copying, the click selects the text instead, for Ctrl+C.
 */
function Copyable({ agent, lines, commands = false }: { agent: string; lines: readonly string[]; commands?: boolean }) {
  const [copied, setCopied] = useState(false);
  const code = useRef<HTMLElement>(null);
  const copy = async () => {
    if (await copyText(lines.join("\n"))) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else if (code.current) {
      window.getSelection()?.selectAllChildren(code.current);
    }
  };
  return (
    <div className="mt-6 flex items-start gap-4 rounded-[14px] border border-line py-3.5 pl-5 pr-3.5 sm:py-4 sm:pl-7">
      <pre className="min-w-0 flex-1 overflow-x-auto py-1.5 font-mono text-[14px] leading-[1.9] text-text sm:text-[15px]">
        <code ref={code}>
          {lines.map((line) => (
            <span key={line} className="block">
              {commands && <span aria-hidden="true" className="text-mut select-none">$ </span>}
              {line}
            </span>
          ))}
        </code>
      </pre>
      <button type="button" onClick={copy} {...connectEvent(agent, "copy")}
        className="flex h-10 shrink-0 items-center gap-2 rounded-[10px] border border-line px-3.5 text-[15px] font-medium text-ink hover:border-mut">
        <Icon name={copied ? "check" : "copy"} size={15} />
        {copied ? "Copied" : "Copy"}
      </button>
      <span aria-live="polite" className="sr-only">{copied ? "Copied" : ""}</span>
    </div>
  );
}
