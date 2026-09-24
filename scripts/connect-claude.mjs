// Connects Claude Code to the installed PacedMind app's MCP server for all your projects (user scope),
// with the app's access token. Run it again to refresh the connection, e.g. after resetting the token.
//
//   npm run connect              connect or refresh
//   npm run connect -- --remove  disconnect
//
// It reads the token from the app's database and never prints it.
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const NAME = "organizer"; // The MCP server id the skills and launched sessions use (mcp__organizer__*).
const URL = "http://127.0.0.1:4319/api/mcp";

/** Runs the claude CLI. On Windows it is usually an npm .cmd shim, which only starts through cmd.exe. */
function claude(args) {
  const opts = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  if (process.platform !== "win32") return execFileSync("claude", args, opts);
  for (const a of args) if (/["%^&|<>!\r\n]/.test(a)) throw new Error(`Refusing to pass "${a}" through cmd.exe.`);
  return execSync(["claude", ...args.map((a) => (/[\s:]/.test(a) ? `"${a}"` : a))].join(" "), opts);
}

try {
  claude(["--version"]);
} catch {
  console.error("Claude Code isn't installed, or `claude` isn't on your PATH.");
  process.exit(1);
}

// Start from a clean entry so the URL and token are current.
try {
  claude(["mcp", "remove", NAME, "--scope", "user"]);
} catch {
  // It wasn't configured.
}
if (process.argv.includes("--remove")) {
  console.log("Claude Code is no longer connected to PacedMind.");
  process.exit(0);
}

const dbFile = path.join(process.env.APPDATA ?? "", "Organizer", "data", "organizer.db");
if (!fs.existsSync(dbFile)) {
  console.error(`PacedMind's data isn't at ${dbFile}. Install and start the desktop app first (npm run desktop).`);
  process.exit(1);
}
const db = new DatabaseSync(dbFile, { readOnly: true });
const row = db.prepare("SELECT value FROM settings WHERE key = 'mcpToken'").get();
db.close();
const token = row ? JSON.parse(String(row.value)) : "";
if (!/^[A-Za-z0-9_-]+$/.test(token)) {
  console.error("PacedMind has no valid MCP token yet. Start the desktop app once, then run this again.");
  process.exit(1);
}

claude(["mcp", "add", "--transport", "http", "--scope", "user", NAME, URL, "--header", `Authorization: Bearer ${token}`]);
console.log(`Connected Claude Code to PacedMind (${URL}) as "${NAME}" for all projects.`);
console.log("New Claude Code sessions can use it. Check with: claude mcp list");
