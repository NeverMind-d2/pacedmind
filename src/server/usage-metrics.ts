import "server-only";
import * as repo from "./repo";
import type { SessionUsage, TokenCounts } from "@/lib/types";
import { NO_TOKENS, addTokens } from "@/lib/usage";

/*
 * What an agent's usage metrics say about a session: OpenTelemetry metrics, sent as JSON over HTTP (OTLP) to the
 * usage route by the Claude Code or Codex a session runs, which the launcher points there with the session's token
 * (launcher.ts). Only numbers are kept, per conversation: tokens by kind, what they'd cost at API prices (Claude Code
 * counts it; Codex doesn't), the seconds it worked, and the models' names. Everything else a data point carries (the
 * account's email and ids, the organization, the terminal, and every other metric) is dropped here and goes nowhere.
 *
 * Claude Code: claude_code.token.usage (by `type`), claude_code.cost.usage, claude_code.active_time.total (`type`
 * cli), each data point with its conversation (`session.id`). Codex: codex.turn.token_usage, a histogram per
 * `token_type` whose input includes what came from its cache, and codex.turn.e2e_duration_ms, without a conversation.
 */

/** claude_code.token.usage's `type`, as TokenCounts names it. */
const CLAUDE_TOKENS: Record<string, keyof TokenCounts> = { input: "input", output: "output", cacheRead: "cacheRead", cacheCreation: "cacheWrite" };
const CONVERSATION = /^[\w-]{1,64}$/;
const MODEL = /^[\w.:@/-]{1,80}$/;
/** As many conversations as a session's usage keeps (usageOf). */
const MAX_CONVERSATIONS = 20;

interface Delta {
  tokens: TokenCounts;
  /** Codex's input tokens, which include those from its cache: the fresh ones are what's left. */
  codexInput: number;
  costUsd: number;
  activeSeconds: number;
  models: Set<string>;
}

type Json = Record<string, unknown>;
const list = (v: unknown, max: number): Json[] =>
  Array.isArray(v) ? v.slice(0, max).filter((x): x is Json => !!x && typeof x === "object") : [];

/** The string attributes of a resource or a data point; nothing else is read. */
function attributes(v: unknown, into = new Map<string, string>()) {
  for (const a of list(v, 64)) {
    const value = a.value as Json | undefined;
    if (typeof a.key === "string" && typeof value?.stringValue === "string") into.set(a.key, value.stringValue);
  }
  return into;
}

const positive = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
};

/** A sum's data point: asDouble, or asInt (a string in OTLP's JSON for 64-bit numbers). A histogram's: its sum. */
const valueOf = (p: Json, histogram: boolean) => (histogram ? positive(p.sum) : positive(p.asDouble ?? p.asInt));

/** Delta temporality, which the launcher asks for: each export says what was added since the last. */
const isDelta = (t: unknown) => t === 1 || t === "AGGREGATION_TEMPORALITY_DELTA";

/** What an export adds, per conversation: the agent's own id for it, else `fallback`. */
export function readExport(body: unknown, fallback: string): Map<string, Delta> {
  const out = new Map<string, Delta>();
  const at = (id: string) => {
    let d = out.get(id);
    if (!d) out.set(id, (d = { tokens: { ...NO_TOKENS }, codexInput: 0, costUsd: 0, activeSeconds: 0, models: new Set() }));
    return d;
  };
  for (const rm of list((body as Json | null)?.resourceMetrics, 16)) {
    const resource = attributes((rm.resource as Json | undefined)?.attributes);
    for (const sm of list(rm.scopeMetrics, 16)) {
      for (const m of list(sm.metrics, 512)) {
        const histogram = !!m.histogram;
        const data = (m.sum ?? m.histogram) as Json | undefined;
        if (!data || !isDelta(data.aggregationTemporality)) continue;
        for (const p of list(data.dataPoints, 256)) {
          const n = valueOf(p, histogram);
          if (!n) continue;
          const attrs = attributes(p.attributes, new Map(resource));
          const own = attrs.get("session.id");
          const d = at(own && CONVERSATION.test(own) ? own : fallback);
          const model = attrs.get("model");
          const type = attrs.get("type");
          if (m.name === "claude_code.token.usage") {
            const kind = CLAUDE_TOKENS[type ?? ""];
            if (!kind) continue;
            d.tokens[kind] += Math.round(n);
          } else if (m.name === "claude_code.cost.usage") {
            d.costUsd += n;
          } else if (m.name === "claude_code.active_time.total" && type === "cli") {
            d.activeSeconds += n;
          } else if (m.name === "codex.turn.token_usage") {
            const kind = attrs.get("token_type");
            if (kind === "input") d.codexInput += Math.round(n);
            else if (kind === "cached_input") d.tokens.cacheRead += Math.round(n);
            else if (kind === "cache_write_input") d.tokens.cacheWrite += Math.round(n);
            else if (kind === "output") d.tokens.output += Math.round(n);
            else continue;
          } else if (m.name === "codex.turn.e2e_duration_ms") {
            d.activeSeconds += n / 1000;
          } else continue;
          if (model && MODEL.test(model)) d.models.add(model);
        }
      }
    }
  }
  for (const d of out.values()) {
    if (d.codexInput) d.tokens.input += Math.max(0, d.codexInput - d.tokens.cacheRead - d.tokens.cacheWrite);
  }
  return out;
}

const g = globalThis as unknown as { __pacedmindUsage?: Map<string, Promise<unknown>> };

/** Runs `f` after what's already running for the session: two exports at once would each add to the same old numbers. */
function serially(sessionId: string, f: () => Promise<void>): Promise<void> {
  const chain = (g.__pacedmindUsage ??= new Map());
  const next = (chain.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(f);
  chain.set(sessionId, next);
  void next.finally(() => {
    if (chain.get(sessionId) === next) chain.delete(sessionId);
  }).catch(() => {});
  return next;
}

const FALLBACK = "\0";

/**
 * Adds an export to a session's usage. `cli`: the conversation the route was called for (`?cli=`); without it (Codex),
 * the conversation the session runs, once its start hook said which.
 */
export async function recordUsage(sessionId: string, cli: string | null, body: unknown): Promise<void> {
  const deltas = readExport(body, cli ?? FALLBACK);
  for (const [id, d] of deltas) {
    const t = d.tokens;
    if (!t.input && !t.cacheRead && !t.cacheWrite && !t.output && !d.costUsd && !d.activeSeconds) deltas.delete(id);
  }
  if (!deltas.size) return;
  await serially(sessionId, async () => {
    const s = await repo.getSession(sessionId);
    if (!s) return;
    const fallback = s.cliSessionId && CONVERSATION.test(s.cliSessionId) ? s.cliSessionId : s.agent;
    const was = s.usage;
    const conversations = { ...(was?.conversations ?? {}) };
    let costUsd = was?.costUsd ?? 0;
    let activeSeconds = was?.activeSeconds ?? 0;
    let models = was?.models ?? [];
    for (const [key, d] of deltas) {
      const id = key === FALLBACK ? fallback : key;
      if (conversations[id] || Object.keys(conversations).length < MAX_CONVERSATIONS) conversations[id] = addTokens(conversations[id] ?? NO_TOKENS, d.tokens);
      costUsd += d.costUsd;
      activeSeconds += d.activeSeconds;
      for (const m of d.models) models = [m, ...models.filter((x) => x !== m)];
    }
    const usage: SessionUsage = {
      conversations, costUsd: Math.round(costUsd * 1e6) / 1e6, activeSeconds: Math.round(activeSeconds * 10) / 10,
      models: models.slice(0, 5), at: new Date().toISOString(),
    };
    await repo.updateSession(sessionId, { usage });
  });
}
