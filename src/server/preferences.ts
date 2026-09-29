import "server-only";
import * as repo from "./repo";
import { cleanPreference, cleanTopic } from "./store/shared";
import { MAX_PREFERENCES, SUGGESTED_TOPICS, sameTopic, topicOrder, type Preference, type PreferenceSource } from "@/lib/types";

/*
 * Preferences: how the user likes to work, in their words, which agents read before they plan, schedule or create
 * tasks (get_preferences, and get_overview while they're short). You edit them in Settings; agents add to them over MCP
 * once you said so (update_preferences). A session PacedMind started only reads them. Each sits under a topic: a
 * suggested one or the user's own, matched whatever its case, so one topic never shows up twice.
 */

export interface PreferenceChanges {
  add?: { topic: string; text: string }[];
  change?: { id: number; topic?: string; text?: string }[];
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

const sameText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

/**
 * Applies the changes, checked first so that a problem saves none of them: every id exists, every text and topic has
 * words, and the list stays within MAX_PREFERENCES. Text the list has already isn't added twice, and a topic takes the
 * spelling it has already (or a suggested one's).
 */
export async function changePreferences(changes: PreferenceChanges, source: PreferenceSource): Promise<PreferencesChanged> {
  const ids = [...(changes.change ?? []).map((c) => c.id), ...(changes.remove ?? [])];
  if (ids.some((id) => !Number.isSafeInteger(id))) throw new PreferenceProblem("Preferences are named by their ids.");
  const strings = [
    ...(changes.add ?? []).flatMap((a) => [a.topic, a.text]),
    ...(changes.change ?? []).flatMap((c) => [c.topic ?? "", c.text ?? ""]),
  ];
  if (strings.some((s) => typeof s !== "string")) throw new PreferenceProblem("A preference needs some words, and a topic.");

  const now = await repo.listPreferences();
  const byId = new Map(now.map((p) => [p.id, p]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new PreferenceProblem(`No preference ${missing.map((id) => `#${id}`).join(", ")}. get_preferences lists them with their ids.`);

  const known = [...new Set(now.map((p) => p.topic)), ...SUGGESTED_TOPICS.map((s) => s.name)];
  const topicOf = (raw: string) => {
    const topic = cleanTopic(raw);
    if (!topic) throw new PreferenceProblem("A preference needs a topic.");
    return known.find((k) => sameTopic(k, topic)) ?? topic;
  };
  const words = (raw: string) => {
    const text = cleanPreference(raw);
    if (!text) throw new PreferenceProblem("A preference needs some words.");
    return text;
  };

  const removing = new Set(changes.remove ?? []);
  const edits = (changes.change ?? []).filter((c) => !removing.has(c.id)).map((c) => ({
    id: c.id, topic: c.topic === undefined ? undefined : topicOf(c.topic), text: c.text === undefined ? undefined : words(c.text),
  }));
  const kept: string[] = [];
  const adds: { topic: string; text: string }[] = [];
  const staying = now.filter((p) => !removing.has(p.id)).map((p) => edits.find((c) => c.id === p.id)?.text ?? p.text);
  for (const a of changes.add ?? []) {
    const topic = topicOf(a.topic);
    const text = words(a.text);
    if ([...staying, ...adds.map((x) => x.text)].some((t) => sameText(t, text))) kept.push(text);
    else adds.push({ topic, text });
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
  const topics = [...new Set(list.map((p) => p.topic))].sort(topicOrder);
  return topics.map((topic) => {
    const mine = list.filter((p) => p.topic === topic);
    return `${topic}:\n${mine.map((p) => `- ${ids ? `[${p.id}] ` : ""}${p.text}`).join("\n")}`;
  }).join("\n\n");
}
