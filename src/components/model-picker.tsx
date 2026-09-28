"use client";

import { useEffect, useId, useState } from "react";
import { taskModelsAction } from "@/app/model-actions";
import { modelSelectionProblem, type ModelSelection } from "@/lib/agent-models";
import type { AgentId, Surface } from "@/lib/types";
import { Icon } from "./icons";
import { Menu, cx } from "./ui";

type Report = Awaited<ReturnType<typeof taskModelsAction>>;
type ModelPickerProps = {
  agent: AgentId; deviceId: string | null; surface: Surface | null; value: ModelSelection | null;
  onChange: (value: ModelSelection | null, deviceId: string | null) => void;
  onDeviceChange: (deviceId: string | null) => void;
  disabled?: boolean; showComputer?: boolean;
};

export function ModelSettings(props: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const value = props.value?.agent === props.agent ? props.value : null;
  const summary = value
    ? [value.model, value.effort && `${value.effort} thinking`, value.speed && `${value.speed} speed`].filter(Boolean).join(" · ")
    : "Agent defaults";
  return <div className="min-w-0">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}
      className="flex w-full min-w-0 items-center gap-2 rounded-md py-2 text-left text-[12.5px] text-fg2 hover:bg-hover">
      <Icon name="chevronDown" size={13} className={cx("shrink-0 text-mut2 transition-transform", !open && "-rotate-90")} />
      <span className="shrink-0">Model settings</span>
      <span className="min-w-0 flex-1 truncate text-right text-mut2" title={summary}>{summary}</span>
    </button>
    <div id={id} hidden={!open}>
      {open && <div className="pb-1 pt-2"><ModelPicker {...props} /></div>}
    </div>
  </div>;
}

function ModelPicker({ agent, deviceId, surface, value, onChange, onDeviceChange, disabled = false, showComputer = true }: ModelPickerProps) {
  const [report, setReport] = useState<{ key: string; data: Report } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const key = `${agent}:${deviceId ?? "auto"}:${revision}`;
  useEffect(() => {
    let current = true;
    taskModelsAction(agent, deviceId).then((data) => {
      if (current) setReport({ key, data });
    }).catch(() => { if (current) setFailed(key); });
    return () => { current = false; };
  }, [agent, deviceId, key]);
  const data = report?.key === key ? report.data : null;
  const waiting = !data && failed !== key;
  const catalog = data?.catalog;
  const models = catalog?.available ? catalog.models : [];
  const selection = value?.agent === agent ? value : null;
  const model = models.find((m) => m.id === selection?.model);
  const terminal = !surface || surface === "terminal";
  const problem = value && data ? modelSelectionProblem(value, agent, surface ?? "terminal", catalog ?? undefined) : null;
  const chip = "flex h-7 items-center gap-1.5 rounded-md border border-ctl bg-hover px-2 text-[12.5px] text-fg3 hover:bg-sel disabled:opacity-50";
  const update = (patch: Partial<ModelSelection>) => selection && onChange({ ...selection, ...patch }, data?.deviceId || null);
  return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap gap-1.5">
      {showComputer && data && (data.devices.length > 1 || (!data.name && data.devices.length > 0)) && <Menu
        trigger={<button type="button" className={chip} disabled={disabled} aria-label="Computer for model settings">{data.name ?? "Choose computer"}</button>}
        items={data.devices.map((d) => ({ value: d.id, label: d.name }))}
        onSelect={(id) => onDeviceChange(id || null)} />}
      <Menu trigger={<button type="button" className={chip} aria-label="Model" disabled={disabled || waiting || !terminal}>
        Model: {selection ? model?.name ?? selection.model : "Default"}
      </button>}
        items={[{ value: "", label: "Default", hint: "Use the agent's own configuration" }, ...models.map((m) => ({ value: m.id, label: m.name }))]}
        onSelect={(id) => onChange(id ? { agent, model: id, effort: null, speed: null } : null, data?.deviceId || null)} />
      {model && model.efforts.length > 0 && <Menu
        trigger={<button type="button" className={chip} aria-label="Thinking" disabled={disabled || !terminal}>Thinking: {selection?.effort ?? "Default"}</button>}
        items={[{ value: "", label: "Default" }, ...model.efforts.map((e) => ({ value: e, label: e }))]}
        onSelect={(effort) => update({ effort: effort || null })} />}
      {model && model.speeds.length > 0 && <Menu
        trigger={<button type="button" className={chip} aria-label="Speed" disabled={disabled || !terminal}>Speed: {model.speeds.find((s) => s.id === selection?.speed)?.name ?? selection?.speed ?? "Default"}</button>}
        items={[{ value: "", label: "Default" }, ...model.speeds.map((s) => ({ value: s.id, label: s.name }))]}
        onSelect={(speed) => update({ speed: speed || null })} />}
      <button type="button" className={chip} disabled={waiting} onClick={() => setRevision((n) => n + 1)}>Refresh models</button>
      {value && <button type="button" className={chip} disabled={disabled} onClick={() => onChange(null, deviceId)}>Reset to defaults</button>}
    </div>
    <p aria-live="polite" className="text-[12px] text-mut2">
      {!terminal ? "Choose model settings in the agent's app or cloud. PacedMind applies them to terminal sessions."
        : waiting ? "Checking the selected computer's agent account…"
        : problem ?? (!catalog?.available ? "Model list unavailable. Sign in to the agent on the selected computer, then refresh. Default uses its own settings."
        : `${data?.name ?? "This computer"} · ${data?.local ? "Current agent account" : `${data?.online ? "Last reported" : "Offline · last reported"} ${new Date(catalog.checkedAt).toLocaleString()}`}`)}
    </p>
  </div>;
}
