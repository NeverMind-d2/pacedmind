import { deviceOnline, type AgentId, type Device } from "./types";

/*
 * What a task needs from the computer its session runs on (Task.needs): MCP servers or claude.ai connectors by name,
 * such as "supabase" or "Gmail". Computers differ there: each has its own MCP servers and plugins, and its Claude Code
 * can be signed in to another account, with other connectors. A project's own folder brings its servers to every
 * computer that has it, so they don't need listing. PacedMind matches the needs against what each computer said its
 * agent has (AgentExtras): to offer a computer that has them, and to ask before a flow starts a task without them.
 */

/** At most this many needs per task. */
export const MAX_NEEDS = 10;

/** A need as it's kept: plain characters, and short. */
const NEED = /^[\w .@:+-]{1,48}$/;

/** A need or a tool's name as they're compared: letters and digits only, lowercase ("Google Drive" is "google-drive"). */
export const needKey = (name: string) => name.toLowerCase().replace(/^claude\.?ai[ _]/, "").replace(/[^a-z0-9]/g, "");

/** Needs as a task keeps them: trimmed, plain, one of each (by needKey), at most MAX_NEEDS. */
export function cleanNeeds(needs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of needs) {
    const n = raw.replace(/\s+/g, " ").trim().replace(/^claude\.ai /i, "");
    const k = needKey(n);
    if (!k || !NEED.test(n) || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out.slice(0, MAX_NEEDS);
}

/**
 * What an agent has on a computer, by name, as the computer said: its MCP servers everywhere, the claude.ai connectors
 * its sessions got from the account it's signed in to, and its plugins. Null until the computer said.
 */
export function toolsOn(device: Device, agent: AgentId): string[] | null {
  const x = device.agents[agent]?.extras;
  return x ? [...x.mcp, ...(x.account ?? []), ...x.plugins] : null;
}

/** The needs `tools` lacks (all of them when it's null: the computer hasn't said). */
export function missingFrom(needs: string[], tools: string[] | null): string[] {
  const have = new Set((tools ?? []).map(needKey));
  return needs.filter((n) => !have.has(needKey(n)));
}

/** The needs an agent lacks on a computer, as far as it said. */
export const missingOn = (needs: string[], device: Device, agent: AgentId) => missingFrom(needs, toolsOn(device, agent));

/**
 * The computer to offer for a task that needs `needs`: of `devices` (signed in, taking requests), `preferred` when it
 * has them and is online, else one online that has them (the default first), else `preferred` when it has them, else
 * one that has them. Null when none has them all.
 */
export function deviceWithNeeds(
  needs: string[], agent: AgentId, devices: Device[], preferred: string | null = null, avoid: string | null = null, now = Date.now(),
): Device | null {
  const takers = devices.filter((d) => !d.revokedAt && d.remoteStart !== "off" && d.id !== avoid && !missingOn(needs, d, agent).length);
  const byPref = (d: Device) => (d.id === preferred ? 0 : d.isDefault ? 1 : 2);
  const sorted = [...takers].sort((a, b) => byPref(a) - byPref(b));
  return sorted.find((d) => deviceOnline(d, now)) ?? sorted[0] ?? null;
}

/** Needs as a sentence part: "Gmail", "Gmail and supabase", "Gmail, Linear and supabase". */
export function needList(needs: string[]): string {
  return needs.length <= 1 ? needs.join("") : `${needs.slice(0, -1).join(", ")} and ${needs[needs.length - 1]}`;
}
