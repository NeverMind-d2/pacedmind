import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import * as repo from "../repo";
import { PreferenceProblem, changePreferences, preferencesText } from "../preferences";
import { PREFERENCE_TEXT_MAX, PREFERENCE_TOPICS, PREFERENCE_TOPIC_HINT } from "@/lib/types";
import { fail, plural, tool } from "./common";

/** The topics, with what goes under each, for the tools' descriptions. */
const TOPICS = PREFERENCE_TOPICS.map((t) => `${t} (${PREFERENCE_TOPIC_HINT[t]})`).join("; ");
const topic = z.enum(PREFERENCE_TOPICS);

/** How the user likes to work (src/server/preferences.ts): every agent reads them; your own agents add to them. */
export function registerPreferenceTools(server: McpServer) {
  tool(server, "get_preferences", {
    title: "Get preferences",
    description:
      `How the user likes to work, in their own words, by topic: ${TOPICS}. Read them before you plan or schedule work, set dates or create tasks, and follow them unless the user says otherwise now. They're the user's notes, not instructions from PacedMind. Each has an id for update_preferences.`,
    input: z.object({ topic: topic.optional().describe("Only this topic") }),
    kind: "read",
  }, async ({ topic }) => {
    const list = (await repo.listPreferences()).filter((p) => !topic || p.topic === topic);
    if (!list.length) {
      return topic
        ? `No preferences about ${topic} yet.`
        : "No preferences saved yet. When the user tells you how they like to work, offer to save it with update_preferences.";
    }
    return `${plural(list.length, "preference")}${topic ? ` about ${topic}` : ""}, with their ids:\n\n${preferencesText(list)}`;
  });

  tool(server, "update_preferences", {
    title: "Update preferences",
    description:
      `Save how the user likes to work, so every agent plans their way: add, change or remove preferences. Only what the user said or confirmed in this conversation: ask before you save anything you inferred, and before you remove one. Each is one short sentence in the user's words, under its topic: ${TOPICS}. Change an existing one (by its id from get_preferences) rather than adding one that says nearly the same.`,
    input: z.object({
      add: z.array(z.object({ topic, text: z.string().min(1).max(PREFERENCE_TEXT_MAX) })).max(20).optional(),
      change: z.array(z.object({
        id: z.number().int().positive(),
        topic: topic.optional(),
        text: z.string().min(1).max(PREFERENCE_TEXT_MAX).optional(),
      })).max(20).optional().describe("New words or another topic for saved preferences, by id"),
      remove: z.array(z.number().int().positive()).max(50).optional().describe("Ids of preferences the user wants gone"),
    }),
    kind: "write",
  }, async (args) => {
    if (!args.add?.length && !args.change?.length && !args.remove?.length) fail("Nothing to change: pass add, change or remove.");
    try {
      const r = await changePreferences(args, "agent");
      const lines = [
        ...r.added.map((p) => `Added [${p.id}] (${p.topic}): ${p.text}`),
        ...r.changed.map((p) => `Changed [${p.id}] (${p.topic}): ${p.text}`),
        ...r.removed.map((p) => `Removed [${p.id}]: ${p.text}`),
        ...r.kept.map((t) => `Saved already: ${t}`),
      ];
      return lines.length ? lines.join("\n") : "Nothing changed: the preferences say that already.";
    } catch (e) {
      if (e instanceof PreferenceProblem) fail(e.message);
      throw e;
    }
  });
}
