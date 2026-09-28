import type { AgentId, Surface } from "./types";

export interface ModelOption {
  id: string;
  name: string;
  efforts: string[];
  speeds: { id: string; name: string }[];
}
export interface ModelCatalog {
  checkedAt: string;
  models: ModelOption[];
  available: boolean;
}
export interface ModelSelection {
  agent: AgentId;
  model: string;
  effort: string | null;
  speed: string | null;
}

// These values reach two different shells and TOML. Catalogs and cloud rows must pass the same boundary.
export const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/;
const OPTION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,29}$/;
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const label = (v: unknown, fallback: string) => typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 80) : fallback;

export function modelSelectionOf(value: unknown): ModelSelection | null {
  if (value == null) return null;
  const v = record(value);
  if ((v.agent !== "claude" && v.agent !== "codex") || typeof v.model !== "string" || !MODEL_ID.test(v.model)) return null;
  if (v.effort != null && (typeof v.effort !== "string" || !OPTION_ID.test(v.effort))) return null;
  if (v.speed != null && (typeof v.speed !== "string" || !OPTION_ID.test(v.speed))) return null;
  return { agent: v.agent, model: v.model, effort: v.effort as string ?? null, speed: v.speed as string ?? null };
}

export function checkedModelSelection(value: unknown): ModelSelection | null {
  const result = modelSelectionOf(value);
  if (value != null && !result) throw new Error("Invalid model settings. Select the model again.");
  return result;
}

export function modelCatalogOf(value: unknown): ModelCatalog | undefined {
  const v = record(value);
  if (typeof v.checkedAt !== "string" || !Number.isFinite(Date.parse(v.checkedAt))) return undefined;
  const models: ModelOption[] = [];
  for (const raw of (Array.isArray(v.models) ? v.models : []).slice(0, 50)) {
    const m = record(raw);
    if (typeof m.id !== "string" || !MODEL_ID.test(m.id) || models.some((x) => x.id === m.id)) continue;
    const efforts = [...new Set((Array.isArray(m.efforts) ? m.efforts : []).filter((x): x is string => typeof x === "string" && OPTION_ID.test(x)))].slice(0, 12);
    const speeds = (Array.isArray(m.speeds) ? m.speeds : []).slice(0, 8).flatMap((raw) => {
      const s = record(raw);
      return typeof s.id === "string" && OPTION_ID.test(s.id) ? [{ id: s.id, name: label(s.name, s.id) }] : [];
    });
    models.push({ id: m.id, name: label(m.name, m.id), efforts, speeds });
  }
  return { checkedAt: v.checkedAt, available: v.available === true && models.length > 0, models };
}

/** Only returned capabilities are offered; an older CLI may report models without effort or speed metadata. */
export function catalogFromAgent(agent: AgentId, response: unknown): ModelCatalog {
  const r = record(response);
  const rows = agent === "codex" ? r.data : r.models;
  const models = (Array.isArray(rows) ? rows : []).filter((x) => record(x).hidden !== true).map((raw) => {
    const m = record(raw);
    if (agent === "codex") return {
      id: m.model, name: m.displayName,
      efforts: (Array.isArray(m.supportedReasoningEfforts) ? m.supportedReasoningEfforts : []).map((e) => record(e).reasoningEffort),
      speeds: Array.isArray(m.serviceTiers) ? m.serviceTiers : [],
    };
    return {
      id: m.value, name: m.displayName,
      efforts: m.supportsEffort === true ? m.supportedEffortLevels : [],
      speeds: m.supportsFastMode === true && r.fast_mode_disabled_reason == null && (r.fast_mode_state === "on" || r.fast_mode_state === "off" || r.fast_mode_state === "cooldown")
        ? [{ id: "standard", name: "Standard" }, { id: "fast", name: "Fast (increased usage)" }] : [],
    };
  });
  return modelCatalogOf({ checkedAt: new Date().toISOString(), available: true, models })!;
}

export function modelSelectionProblem(selection: ModelSelection | null | undefined, agent: AgentId, surface: Surface, catalog?: ModelCatalog): string | null {
  if (!selection) return null;
  if (!modelSelectionOf(selection)) return "Invalid model settings. Select the model again.";
  if (selection.agent !== agent) return "The model was selected for another agent. Select it again or use Default.";
  if (surface !== "terminal") return "Model settings can be applied to terminal sessions. Choose Terminal or use Default model settings.";
  if (!catalog?.available) return "Couldn't check this account's models on this computer. Refresh the model list or use Default.";
  const model = catalog.models.find((m) => m.id === selection.model);
  if (!model) return "This model is no longer available on this computer's agent account. Select it again or use Default.";
  if (selection.effort && !model.efforts.includes(selection.effort)) return "This thinking level is no longer available for the model. Select it again or use Default.";
  if (selection.speed && !model.speeds.some((s) => s.id === selection.speed)) return "This speed is no longer available for the model. Select it again or use Default.";
  return null;
}

/** Values have already been checked against a fresh catalog; still validate before building any command. */
export function modelFlags(value: ModelSelection | null | undefined): string {
  const s = checkedModelSelection(value);
  if (!s) return "";
  if (s.agent === "claude") return ` --model ${s.model}${s.effort ? ` --effort ${s.effort}` : ""}`;
  // Config overrides are global to Codex subcommands, including resume.
  return ` -c model=${s.model}${s.effort ? ` -c model_reasoning_effort=${s.effort}` : ""}${s.speed ? ` -c service_tier=${s.speed}` : ""}`;
}
