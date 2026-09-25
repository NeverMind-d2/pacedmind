"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { requestSessionAction, startSessionAction } from "@/app/actions";
import { AGENT_LABEL, type AgentId, type Device, type Doer, type Surface } from "@/lib/types";
import { Button, Segmented, cx, toast } from "./ui";

const EVENT = "pacedmind:remote-start";

/**
 * Starts a session: in the desktop app it opens here, where the task says (or `surface`). The web app can't
 * start anything, and a task that runs on another computer starts there, so both open the dialog below, which
 * asks that computer to start it.
 */
export async function startSessionOrAsk(taskId: number, agent?: Doer | null, surface?: Surface) {
  const wanted = agent === "claude" || agent === "codex" ? agent : null;
  const r = await startSessionAction(taskId, wanted, surface);
  if (!r.remote) return r;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { taskId, agent: wanted ?? "claude", deviceId: r.deviceId ?? null } }));
  return { ok: true };
}

const field = "h-8 w-full rounded-md border border-line2 bg-input px-2.5 text-[13px] text-fg outline-none focus:border-line-strong";

const canStart = (d: Device) => !d.revokedAt && d.remoteStart !== "off";

function seenRecently(d: Device) {
  return !!d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < 3 * 60_000;
}

/**
 * The web app's "start on a computer" dialog: which computer, which agent, and a fresh two-factor code. The
 * database only takes the request with a code entered in the last five minutes, and the computer then
 * refuses it, asks you there, or starts it, as its own settings say.
 */
export function RemoteStart({ devices, tasks }: { devices: Device[]; tasks: { id: number; key: string; title: string }[] }) {
  const [ask, setAsk] = useState<{ taskId: number; agent: AgentId } | null>(null);
  const usable = devices.filter(canStart);
  const [deviceId, setDeviceId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ taskId: number; agent: AgentId; deviceId: string | null }>).detail;
      setAsk({ taskId: d.taskId, agent: d.agent });
      setCode("");
      const open = devices.filter(canStart);
      // The computer the task runs on, when it says; else the one you picked last, or one that's around.
      const named = d.deviceId && open.some((x) => x.id === d.deviceId) ? d.deviceId : null;
      setDeviceId((cur) => named ?? (cur || (open.find(seenRecently) ?? open[0])?.id || ""));
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [devices]);

  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAsk(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask]);

  if (!ask) return null;
  const task = tasks.find((t) => t.id === ask.taskId);
  const device = usable.find((d) => d.id === deviceId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!device) return;
    setBusy(true);
    const r = await requestSessionAction(ask.taskId, ask.agent, device.id, code);
    setBusy(false);
    if (!r.ok) return toast(r.error ?? "That didn't work", "error");
    toast(r.message ?? "Sent");
    setAsk(null);
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-overlay pt-32" onMouseDown={(e) => { if (e.target === e.currentTarget) setAsk(null); }}>
      <form role="dialog" aria-label="Start on a computer" onSubmit={submit}
        className="flex w-[460px] flex-col gap-4 rounded-xl border border-line2 bg-raised p-5 shadow-[var(--shadow-popover)]">
        <div className="flex flex-col gap-1">
          <h2 className="text-[15px] font-semibold text-strong">Start on a computer</h2>
          <p className="text-[12.5px] leading-relaxed text-mut">
            {task ? <><span className="font-mono text-fg2">{task.key}</span> {task.title}</> : "This task"} runs in a terminal on one of your
            computers with the PacedMind desktop app.
          </p>
        </div>
        {usable.length === 0 ? (
          <p className="rounded-md border border-line2 px-3 py-2 text-[12.5px] leading-relaxed text-fg3">
            No computer takes sessions from elsewhere. Sign in to the desktop app, and under Settings → This computer choose &ldquo;Ask me&rdquo; or &ldquo;Start&rdquo;.
          </p>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-mut">Computer</span>
              <select className={field} value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                {usable.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}{seenRecently(d) ? "" : " (not seen lately)"}</option>
                ))}
              </select>
              {device && (
                <span className="text-[11.5px] text-mut2">
                  {device.remoteStart === "auto" ? "It starts the session right away." : "It asks you on that computer before starting."}
                </span>
              )}
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] text-mut">Agent</span>
              <Segmented value={ask.agent} onChange={(v) => setAsk({ ...ask, agent: v })}
                options={(["claude", "codex"] as AgentId[]).map((a) => ({ value: a, label: AGENT_LABEL[a] }))} />
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] text-mut">Two-factor code</span>
              <input className={cx(field, "text-center font-mono text-[16px] tracking-[0.35em]")} value={code} autoFocus required
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" />
              <span className="text-[11.5px] text-mut2">Starting an agent from afar always takes a current code.</span>
            </label>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setAsk(null)}>Cancel</Button>
          {usable.length > 0 && <Button type="submit" variant="primary" disabled={busy || code.length !== 6 || !device}>Send</Button>}
        </div>
      </form>
    </div>,
    document.body,
  );
}
