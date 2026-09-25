"use client";

import { useEffect, useState } from "react";
import { approveLaunchAction, denyLaunchAction } from "@/app/actions";
import type { LaunchRequestKind, Surface } from "@/lib/types";
import { Button, useAction } from "./ui";

export interface ApprovalView {
  id: string;
  /** Start a session, resume one, or send one back with changes (src/server/requests.ts). */
  kind?: LaunchRequestKind;
  key: string;
  title: string;
  /** The agent and where it runs, in words ("Claude Code · Terminal"). */
  agent: string;
  surface?: Surface;
  folder: string;
  from: string;
  /** For kind "changes": what should change, as whoever asked wrote it. */
  changes?: string | null;
  requestedAt: number;
  expiresAt: number;
}

function ago(ms: number, now: number) {
  const min = Math.max(0, Math.round((now - ms) / 60_000));
  return min < 1 ? "just now" : `${min} min ago`;
}

function question(a: ApprovalView): string {
  if (a.kind === "changes") return "Send a session back with changes?";
  if (a.kind === "resume") {
    if (a.surface === "cloud") return "Pull a cloud session into a terminal here?";
    return a.surface === "desktop" ? "Continue a session in the desktop app here?" : "Resume a session on this computer?";
  }
  return "Start a session on this computer?";
}

/** Who asked. The server's words also say what was asked, which the card shows on its own (and the changes in full). */
const asker = (a: ApprovalView) => a.from.replace(/, (sending the session back with changes: “[\s\S]*”|resuming its session)$/, "");

/**
 * Sessions asked for from outside this window (an agent over MCP, the web app, another computer) wait here for you:
 * nothing opens a terminal on this computer until you allow it. Shows what would run and where, and for a session sent
 * back with changes, the changes as they were written: the agent acts on them, so read them before allowing it.
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
      className="fixed right-4 top-[52px] z-40 flex max-h-[calc(100dvh-64px)] w-[380px] flex-col gap-2 overflow-y-auto max-md:inset-x-3 max-md:w-auto">
      {open.map((a) => (
        <div key={a.id} className="flex shrink-0 flex-col gap-2.5 rounded-lg border border-line2 bg-raised p-3.5 shadow-[var(--shadow-popover)]">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-strong">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            {question(a)}
          </div>
          <div className="text-[12.5px] leading-relaxed text-fg3">
            <span className="font-mono text-fg2">{a.key}</span> {a.title}
            <br />
            {a.agent} in <span className="break-all font-mono text-[11.5px] text-fg2">{a.folder}</span>
          </div>
          {a.kind === "changes" && a.changes && (
            <div className="flex flex-col gap-1">
              <span className="text-[11.5px] text-mut2">What the agent is asked to change, as sent:</span>
              {/* Plain text, as it came: nothing in it is a link or formatting. */}
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-line2 bg-input px-2.5 py-2 text-[12px] leading-relaxed text-fg2 wrap-break-word">
                {a.changes}
              </p>
            </div>
          )}
          <div className="text-[12px] text-mut2">Asked by {asker(a)} · {ago(a.requestedAt, now)}</div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => run(() => denyLaunchAction(a.id), "Refused")}>Refuse</Button>
            <Button variant="primary" onClick={() => run(() => approveLaunchAction(a.id))}>Allow</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
