import "server-only";
import { execFileSync, execSync } from "node:child_process";
import { deviceConfig } from "./device";
import { mcpUrl } from "./launcher";

/*
 * Connects your own Claude Code to this computer's PacedMind (user scope, all projects) with the owner token,
 * without the token passing through a clipboard or a terminal's history. Runs the claude CLI the way
 * scripts used to: on Windows it's usually an npm .cmd shim, which only starts through cmd.exe, so every
 * argument is checked for characters cmd.exe would act on.
 */

const NAME = "organizer"; // The MCP server id the skills and launched sessions use (mcp__organizer__*).

function claude(args: string[]): string {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(ORGANIZER_.*|SUPABASE_.*|NODE_ENV|PORT|ELECTRON_RUN_AS_NODE)$/i.test(key)) delete env[key];
  const opts = { encoding: "utf8" as const, stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"], env, timeout: 30_000, windowsHide: true };
  if (process.platform !== "win32") return execFileSync("claude", args, opts);
  for (const a of args) if (/["%^&|<>!\r\n]/.test(a)) throw new Error("Refusing to pass that through cmd.exe.");
  return execSync(["claude", ...args.map((a) => (/[\s:]/.test(a) ? `"${a}"` : a))].join(" "), opts);
}

export function connectClaudeCode(): { ok: boolean; error?: string; message?: string } {
  try {
    claude(["--version"]);
  } catch {
    return { ok: false, error: "Claude Code isn't installed, or `claude` isn't on your PATH." };
  }
  try {
    claude(["mcp", "remove", NAME, "--scope", "user"]);
  } catch {
    // It wasn't configured.
  }
  try {
    claude(["mcp", "add", "--transport", "http", "--scope", "user", NAME, mcpUrl(), "--header", `Authorization: Bearer ${deviceConfig().ownerToken}`]);
  } catch (e) {
    return { ok: false, error: `Claude Code didn't take it: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` };
  }
  return { ok: true, message: "Connected Claude Code for all your projects. New Claude Code sessions can use PacedMind." };
}
