import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentId } from "@/lib/types";
import { catalogFromAgent, type ModelCatalog } from "@/lib/agent-models";
import { agentEnv, shellFor } from "./shell";

/** A metadata-only handshake: never sends a prompt, starts a turn, or enables MCP tools or user hooks. */
export async function readAgentCatalog(agent: AgentId, command: string | null): Promise<ModelCatalog> {
  const unavailable = (): ModelCatalog => ({ checkedAt: new Date().toISOString(), available: false, models: [] });
  if (!command) return unavailable();
  let dir: string | undefined;
  let config: string | undefined;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pacedmind-models-"));
    config = path.join(dir, "probe.json");
    // Print-mode requires an explicit, per-process fast-mode opt-in before reporting account eligibility.
    // This only probes metadata: no prompt is sent, and the user's settings are never written.
    fs.writeFileSync(config, JSON.stringify({ mcpServers: {}, disableAllHooks: true, fastMode: true }), { mode: 0o600 });
    // The path is generated locally; it must still survive both shells.
    if (/["%^&|<>!`$\r\n]/.test(config)) return unavailable();
    const line = agent === "codex" ? `${command} app-server`
      : `${command} -p --input-format stream-json --output-format stream-json --verbose --no-session-persistence --strict-mcp-config --mcp-config "${config}" --settings "${config}" --setting-sources user`;
    return await new Promise<ModelCatalog>((resolve) => {
      const shell = shellFor(line);
      const child = spawn(/* turbopackIgnore: true */ shell.file, shell.args, {
        cwd: dir, env: agentEnv(), windowsHide: true, windowsVerbatimArguments: shell.verbatim, detached: process.platform !== "win32",
      });
      let finished = false;
      let buffer = "";
      let bytes = 0;
      let pages = 0;
      const rows: unknown[] = [];
      const send = (message: unknown) => { if (!finished) child.stdin.write(JSON.stringify(message) + "\n"); };
      const finish = (catalog = unavailable()) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        child.stdin.end();
        // Kill the shell's own process tree on Windows; otherwise a hung CLI outlives the timeout.
        if (process.platform === "win32" && child.pid) {
          const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
          killer.on("error", () => {});
        } else if (child.pid) {
          try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); }
        }
        resolve(catalog);
      };
      const timeout = setTimeout(() => finish(), 20_000);
      child.on("error", () => finish());
      child.on("close", () => finish());
      child.stdin.on("error", () => finish());
      child.stderr.resume(); // Auth errors can contain identifying data. Never retain or forward them.
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 2_000_000) { finish(); return; }
        buffer += chunk;
        let end: number;
        while (!finished && (end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          let message;
          try { message = JSON.parse(line); } catch { continue; }
          if (!message || typeof message !== "object" || Array.isArray(message)) continue;
          if (agent === "claude") {
            if (message.type === "control_response" && message.response?.request_id === "catalog") {
              finish(catalogFromAgent(agent, message.response.response));
            }
          } else if (message.id === 1) {
            if (message.error) { finish(); return; }
            send({ method: "initialized", params: {} });
            send({ id: 2, method: "model/list", params: { limit: 50, includeHidden: false } });
          } else if (message.id === 2) {
            if (!Array.isArray(message.result?.data)) { finish(); return; }
            rows.push(...message.result.data);
            const cursor = message.result.nextCursor;
            if (typeof cursor === "string" && ++pages < 10 && rows.length < 50) send({ id: 2, method: "model/list", params: { limit: 50, includeHidden: false, cursor } });
            else finish(catalogFromAgent(agent, { data: rows }));
          }
        }
      });
      send(agent === "codex"
        ? { id: 1, method: "initialize", params: { clientInfo: { name: "pacedmind", version: "0.1.0" }, capabilities: { experimentalApi: true } } }
        : { type: "control_request", request_id: "catalog", request: { subtype: "initialize" } });
    });
  } catch { return unavailable(); }
  finally {
    // Only remove our two entries. A CLI may have made files of its own while initializing.
    try { if (config) fs.unlinkSync(config); if (dir) fs.rmdirSync(dir); } catch { /* The OS temp cleaner can remove a nonempty probe folder. */ }
  }
}
