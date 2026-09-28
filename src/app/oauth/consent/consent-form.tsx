"use client";

import { useState, useTransition } from "react";
import { Button, cx } from "@/components/ui";
import { approveAgentAction, denyAgentAction } from "./actions";

type Note = { text: string; error: boolean } | null;

/** Allow or refuse an agent's sign-in; both leave for the agent's own address, or say what happened. */
export function ConsentForm({ id, held }: { id: string; held: string | null }) {
  const [note, setNote] = useState<Note>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string } | undefined>) =>
    start(async () => {
      const r = await fn();
      if (!r) return;
      setNote({ text: (r.ok ? r.message : r.error) ?? "Something went wrong.", error: !r.ok });
      if (r.ok) setDone(true);
    });

  return (
    <div className="flex flex-col gap-3">
      {note && (
        <p role={note.error ? "alert" : "status"}
          className={cx("rounded-md border px-3 py-2 text-[12.5px] leading-relaxed", note.error ? "border-line-strong text-fg" : "border-line2 text-fg3")}>
          {note.text}
        </p>
      )}
      {!done && (
        <div className="flex gap-2">
          <Button type="button" disabled={pending} onClick={() => run(() => denyAgentAction(id, held !== null))} className="h-9 flex-1 justify-center text-[13px]">
            Deny
          </Button>
          <Button type="button" variant="primary" disabled={pending} onClick={() => run(() => approveAgentAction(id, held))} className="h-9 flex-1 justify-center text-[13px]">
            Allow
          </Button>
        </div>
      )}
    </div>
  );
}
