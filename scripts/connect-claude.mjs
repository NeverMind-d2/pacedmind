// Connecting Claude Code to PacedMind moved into the app: Settings → Connect your agents → Connect.
//
// The app keeps its MCP token in an encrypted file only it can open, and hands it to Claude Code itself,
// so no script (and no other program on the computer) can read it. This command only says where to go,
// and `--remove` still disconnects.
//
//   npm run connect              how to connect
//   npm run connect -- --remove  disconnect
import { execFileSync, execSync } from "node:child_process";

const NAME = "pacedmind"; // The MCP server's name the skills and launched sessions use (mcp__pacedmind__*).
const OLD_NAME = "organizer"; // Its name before: connecting replaces it.

/** Runs the claude CLI. On Windows it is usually an npm .cmd shim, which only starts through cmd.exe. */
function claude(args) {
  const opts = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  if (process.platform !== "win32") return execFileSync("claude", args, opts);
  for (const a of args) if (/["%^&|<>!\r\n]/.test(a)) throw new Error(`Refusing to pass "${a}" through cmd.exe.`);
  return execSync(["claude", ...args.map((a) => (/[\s:]/.test(a) ? `"${a}"` : a))].join(" "), opts);
}

if (process.argv.includes("--remove")) {
  let removed = false;
  for (const name of [NAME, OLD_NAME]) {
    try {
      claude(["mcp", "remove", name, "--scope", "user"]);
      removed = true;
    } catch {
      // Not set up under this name.
    }
  }
  console.log(removed ? "Claude Code is no longer connected to PacedMind." : "Claude Code wasn't connected to PacedMind.");
  process.exit(0);
}

console.log("Open PacedMind, go to Settings → Connect your agents, and click Connect next to Claude Code.");
console.log("It adds PacedMind for all your projects, with this computer's token, without showing the token.");
