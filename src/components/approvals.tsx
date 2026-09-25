"use client";

import { useEffect, useState } from "react";
import { approveLaunchAction, denyLaunchAction } from "@/app/actions";
import { Button, useAction } from "./ui";

export interface ApprovalView {
  id: string;
  key: string;
  title: string;
  agent: string;
  folder: string;
  from: string;
  requestedAt: number;
  expiresAt: number;
}

function ago(ms: number, now: number) {
  const min = Math.max(0, Math.round((now - ms) / 60_000));
  return min < 1 ? "just now" : `${min} min ago`;
}

/**
 * Sessions asked for from outside this window (an agent over MCP, the web app, another computer) wait here
 * for you: nothing opens a terminal on this computer until you allow it. Shows what would run and where.
 */
export function Approvals({ items }: { items: ApprovalView[] }) {
  const { run } = useAction();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const open = items.filter((a) => a.expiresAt > now);
  if (!open.length) return null;
  return (
    // On a phone: the screen's width less a margin, and a list that scrolls when several wait.
    <div role="region" aria-label="Sessions waiting for you"
      className="fixed right-4 top-[52px] z-40 flex w-[380px] flex-col gap-2 max-md:inset-x-3 max-md:max-h-[calc(100dvh-64px)] max-md:w-auto max-md:overflow-y-auto">
      {open.map((a) => (
        <div key={a.id} className="flex flex-col gap-2.5 rounded-lg border border-line2 bg-raised p-3.5 shadow-[var(--shadow-popover)]">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-strong">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            Start a session on this computer?
          </div>
          <div className="text-[12.5px] leading-relaxed text-fg3">
            <span className="font-mono text-fg2">{a.key}</span> {a.title}
            <br />
            {a.agent} in <span className="break-all font-mono text-[11.5px] text-fg2">{a.folder}</span>
            <br />
            <span className="text-mut2">Asked by {a.from} · {ago(a.requestedAt, now)}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => run(() => denyLaunchAction(a.id), "Refused")}>Refuse</Button>
            <Button variant="primary" onClick={() => run(() => approveLaunchAction(a.id))}>Allow</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
