import "server-only";
import * as repo from "./repo";
import { cleanPreference, isPreferenceTopic } from "./store/shared";
import {
  MAX_PREFERENCES, PREFERENCE_TOPICS, PREFERENCE_TOPIC_LABEL, type Preference, type PreferenceSource, type PreferenceTopic,
} from "@/lib/types";

/*
 * Preferences: how the user likes to work, in their words, which agents read before they plan, schedule or create
 * tasks (get_preferences, and get_overview while they're short). You edit them in Settings; agents add to them over MCP
 * once you said so (update_preferences). A session PacedMind started only reads them.
 */

export interface PreferenceChanges {
  add?: { topic: PreferenceTopic; text: string }[];
  change?: { id: number; topic?: PreferenceTopic; text?: string }[];
  remove?: number[];
}

export interface PreferencesChanged {
  added: Preference[];
  changed: Preference[];
  removed: Preference[];
  /** What was already there, word for word: not added again. */
  kept: string[];
}

/** A user-facing problem with the changes; nothing was saved. */
export class PreferenceProblem extends Error {}

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

/**
 * Applies the changes, checked first so that a problem saves none of them: every id exists, every text has words, and
 * the list stays within MAX_PREFERENCES. Text the list has already (in any topic) isn't added twice.
 */
export async function changePreferences(changes: PreferenceChanges, source: PreferenceSource): Promise<PreferencesChanged> {
  const ids = [...(changes.change ?? []).map((c) => c.id), ...(changes.remove ?? [])];
  if (ids.some((id) => !Number.isSafeInteger(id))) throw new PreferenceProblem("Preferences are named by their ids.");
  const topics = [...(changes.add ?? []).map((a) => a.topic), ...(changes.change ?? []).flatMap((c) => (c.topic === undefined ? [] : [c.topic]))];
  if (topics.some((t) => !isPreferenceTopic(t))) throw new PreferenceProblem(`Topics are ${PREFERENCE_TOPICS.join(", ")}.`);
  const texts = [...(changes.add ?? []).map((a) => a.text), ...(changes.change ?? []).flatMap((c) => (c.text === undefined ? [] : [c.text]))];
  if (texts.some((t) => typeof t !== "string")) throw new PreferenceProblem("A preference needs some words.");
  const now = await repo.listPreferences();
  const byId = new Map(now.map((p) => [p.id, p]));
  const missing = [...(changes.change ?? []).map((c) => c.id), ...(changes.remove ?? [])].filter((id) => !byId.has(id));
  if (missing.length) throw new PreferenceProblem(`No preference ${missing.map((id) => `#${id}`).join(", ")}. get_preferences lists them with their ids.`);
  const removing = new Set(changes.remove ?? []);
  const edits = (changes.change ?? []).filter((c) => !removing.has(c.id)).map((c) => ({ ...c, text: c.text === undefined ? undefined : cleanPreference(c.text) }));
  if (edits.some((c) => c.text === "")) throw new PreferenceProblem("A preference needs some words.");

  const kept: string[] = [];
  const adds: { topic: PreferenceTopic; text: string }[] = [];
  const staying = now.filter((p) => !removing.has(p.id)).map((p) => edits.find((c) => c.id === p.id)?.text ?? p.text);
  for (const a of changes.add ?? []) {
    const text = cleanPreference(a.text);
    if (!text) throw new PreferenceProblem("A preference needs some words.");
    if ([...staying, ...adds.map((x) => x.text)].some((t) => same(t, text))) kept.push(text);
    else adds.push({ topic: a.topic, text });
  }
  if (staying.length + adds.length > MAX_PREFERENCES) {
    throw new PreferenceProblem(`At most ${MAX_PREFERENCES} preferences: change or remove some first (there are ${now.length}).`);
  }

  const out: PreferencesChanged = { added: [], changed: [], removed: [], kept };
  for (const id of removing) if (await repo.deletePreference(id)) out.removed.push(byId.get(id)!);
  for (const c of edits) {
    const was = byId.get(c.id)!;
    if ((c.topic ?? was.topic) === was.topic && (c.text ?? was.text) === was.text) continue;
    const p = await repo.updatePreference(c.id, { topic: c.topic, text: c.text, source });
    if (p) out.changed.push(p);
  }
  for (const a of adds) out.added.push(await repo.addPreference({ ...a, source }));
  return out;
}

/** The preferences as text, by topic, with their ids: for get_preferences and get_overview. */
export function preferencesText(list: Preference[], ids = true): string {
  return PREFERENCE_TOPICS.flatMap((topic) => {
    const mine = list.filter((p) => p.topic === topic);
    return mine.length ? [`${PREFERENCE_TOPIC_LABEL[topic]} (${topic}):\n${mine.map((p) => `- ${ids ? `[${p.id}] ` : ""}${p.text}`).join("\n")}`] : [];
  }).join("\n\n");
}
