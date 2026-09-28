"use client";

import { createContext, useContext, type ReactNode } from "react";
import { MAX_NEEDS, cleanNeeds, deviceWithNeeds, missingOn, needKey, toolsOn } from "@/lib/needs";
import { AGENT_LABEL, APP_LABEL, deviceOnline, mcpReaches, surfaceOf, type AgentId, type Device, type Surface } from "@/lib/types";
import { Picker } from "./picker";

type ExecutionContext = { devices: Device[]; hereId: string | null; desktop: boolean };
const Context = createContext<ExecutionContext>({ devices: [], hereId: null, desktop: false });
export function ExecutionProvider({ children, ...value }: ExecutionContext & { children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useExecution = () => useContext(Context);

export function harnesses(d: Device): string[] {
  return (["claude", "codex"] as const).flatMap((a) => [
    ...(d.agents[a].cli ? [AGENT_LABEL[a]] : []), ...(d.agents[a].app ? [APP_LABEL[a]] : []),
  ]);
}

export function ComputerPicker({ value, inherited, onChange }: { value: string | null; inherited?: string | null; onChange: (id: string | null) => void }) {
  const { devices, hereId, desktop } = useExecution();
  const parent = devices.find((d) => d.id === inherited);
  const options = [
    { value: "", label: parent ? `Project default: ${parent.name}` : "Automatic computer", detail: desktop ? "Uses the project's computer, otherwise starts here; missing tools may offer another computer" : "Uses the project's computer, then available tools and the default computer" },
    ...devices.filter((d) => !!d.id).map((d) => ({ value: d.id, label: d.name,
      detail: [d.id === hereId ? "This computer" : deviceOnline(d) ? "Online" : "Offline", harnesses(d).join(", ") || "No harnesses reported", d.id !== hereId && d.remoteStart === "off" ? "Remote starts refused" : ""].filter(Boolean).join(" · ") })),
  ];
  if (value && !options.some((o) => o.value === value)) options.push({ value, label: "Unavailable computer", detail: "Choose another computer or Automatic" });
  return <Picker label="Computer" values={[value ?? ""]} options={options} onChange={([id]) => onChange(id || null)} />;
}

export function NeedsPicker({ values, onChange, agent, tools, deferred = false }: {
  values: string[]; onChange: (values: string[]) => void; agent?: AgentId; deferred?: boolean; tools?: { name: string; on: string[] }[];
}) {
  const { devices } = useExecution();
  const choices = new Map<string, { name: string; on: Set<string> }>();
  const add = (name: string, on: string[]) => {
    const clean = cleanNeeds([name])[0];
    if (!clean) return;
    const key = needKey(clean);
    const item = choices.get(key) ?? { name: clean, on: new Set<string>() };
    on.forEach((d) => item.on.add(d)); choices.set(key, item);
  };
  if (tools) tools.forEach((t) => add(t.name, t.on));
  else devices.forEach((d) => (agent ? [agent] : ["claude", "codex"] as const).forEach((a) => (toolsOn(d, a) ?? []).forEach((name) => add(name, [d.name]))));
  values.forEach((v) => add(v, []));
  return <Picker label="MCP servers and connectors" multiple deferred={deferred} values={values.map(needKey)} max={MAX_NEEDS}
    placeholder="Add MCP servers or connectors" options={[...choices].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([key, t]) => ({
      value: key, label: t.name, detail: t.on.size ? `On ${[...t.on].join(", ")}` : "Not reported by a computer",
    }))} custom={(text) => cleanNeeds([text])[0] ?? null}
    onChange={(keys) => onChange(cleanNeeds(keys.map((k) => choices.get(k)?.name ?? k)))} />;
}

export function ExecutionInfo({ deviceId, agent, runIn, folder, needs = [] }: {
  deviceId: string | null; agent: AgentId; runIn: Surface | null; folder: string | null; needs?: string[];
}) {
  const { devices, hereId, desktop } = useExecution();
  const fallback = devices.find((d) => d.isDefault);
  const automatic = desktop ? devices.find((d) => d.id === hereId)
    : (needs.length ? deviceWithNeeds(needs, agent, devices, fallback?.id) : null) ?? fallback;
  const device = deviceId ? devices.find((d) => d.id === deviceId) : automatic;
  const local = desktop && device?.id === hereId;
  const tools = device?.agents[agent];
  const surface = surfaceOf(runIn, device?.checkedAt ? tools : undefined);
  const missing = device && surface !== "cloud" ? missingOn(needs, device, agent) : [];
  return <div className="space-y-1 text-[11.5px] leading-relaxed text-mut2">
    {deviceId && !device && <p>The selected computer is unavailable. Choose another computer.</p>}
    {device && <p>{device.name} · {local ? "This computer" : deviceOnline(device) ? "Online" : "Offline"}</p>}
    {device && <p>{harnesses(device).join(" · ") || (device.checkedAt ? "No harnesses found" : "Harnesses have not been checked yet")}</p>}
    {!runIn && device && <p>Automatic harness: {surface === "desktop" ? APP_LABEL[agent] : `${AGENT_LABEL[agent]} in a terminal`}</p>}
    {surface === "desktop" && tools?.app && <p>{mcpReaches(tools.mcp) ? "App connected to PacedMind" : "App is not connected to this PacedMind"}</p>}
    {tools && device?.checkedAt && (surface === "desktop" ? !tools.app : !tools.cli) && <p>The selected harness is not installed on this computer.</p>}
    {local && surface !== "cloud" && <p className="break-all">Workspace: {folder ?? "A private folder will be created for this task"}</p>}
    {!local && surface !== "cloud" && <p>Workspace folders are configured on the selected computer.</p>}
    {surface === "cloud" && <p>Runs in the agent&apos;s cloud using the project&apos;s repository.</p>}
    {missing.length > 0 && <p>Not reported for {AGENT_LABEL[agent]}: {missing.join(", ")}</p>}
  </div>;
}
