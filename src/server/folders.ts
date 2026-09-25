import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * Characters that would break out of the quoting in the start.cmd / start.sh scripts, and `;`, which
 * Windows Terminal reads as the start of another command even inside its -d argument.
 */
const UNSAFE_PATH = /["%!^&|<>`$;\u0000-\u001f]/;

/** Why a folder can't be a project's working folder for agent sessions, or null when it can. */
export function folderProblem(folder: string): string | null {
  if (!path.isAbsolute(folder)) return "Use an absolute path, like C:\\code\\my-app.";
  if (UNSAFE_PATH.test(folder)) return "The path contains characters that can't be passed to a terminal safely (\" % ! ^ & | < > ` $ ;).";
  try {
    if (!fs.statSync(folder).isDirectory()) return "That path is a file, not a folder.";
  } catch {
    return "That folder doesn't exist.";
  }
  return null;
}
