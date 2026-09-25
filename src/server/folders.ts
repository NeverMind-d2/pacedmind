import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Characters that would break out of the quoting in the start.cmd / start.command / start.sh scripts. */
const UNSAFE_PATH = /["%!^&|<>`$\u0000-\u001f]/;

/** Why a folder can't be a project's working folder for agent sessions, or null when it can. */
export function folderProblem(folder: string): string | null {
  if (!path.isAbsolute(folder)) return `Use an absolute path, like ${path.join(os.homedir(), "code", "my-app")}.`;
  if (UNSAFE_PATH.test(folder)) return "The path contains characters that can't be passed to a terminal safely (\" % ! ^ & | < > ` $).";
  // In the shell scripts of macOS and Linux, a backslash inside double quotes can escape what follows.
  if (process.platform !== "win32" && folder.includes("\\")) return "The path contains a backslash, which can't be passed to a terminal safely.";
  try {
    if (!fs.statSync(folder).isDirectory()) return "That path is a file, not a folder.";
  } catch {
    return "That folder doesn't exist.";
  }
  return null;
}
