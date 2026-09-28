import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot } from "./folders";
import { repoOf } from "./store/shared";

/*
 * Which repository a folder holds, the same way on every computer, so a project found on one computer is recognized
 * on another (project-links.ts, import.ts). Read from git's own files, without running git: the checkout's config,
 * or for a worktree the config of the checkout it was made from.
 */

/**
 * On macOS, reading a file in these folders makes the system ask you whether PacedMind may, and the read waits for
 * your answer, which would hold up the whole server. Their repositories aren't read: such a folder is matched to a
 * project by its name instead. Only reading asks; seeing that a file is there doesn't.
 */
const ASKS = process.platform === "darwin"
  ? ["Desktop", "Documents", "Downloads", path.join("Library", "Mobile Documents"), path.join("Library", "CloudStorage")]
    .map((d) => path.join(os.homedir(), d).toLowerCase())
  : [];
export const asks = (file: string) => {
  const key = path.resolve(file).toLowerCase();
  return ASKS.some((d) => key === d || key.startsWith(d + path.sep));
};

const read = (file: string): string | null => {
  if (asks(file)) return null;
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

/** The git directory a checkout and its worktrees share, where the config is; null when `root` has no .git. */
function commonDir(root: string): string | null {
  const dotGit = path.join(root, ".git");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dotGit);
  } catch {
    return null;
  }
  if (stat.isDirectory()) return dotGit;
  // A worktree or a submodule: .git is a file that names its git directory.
  const gitDir = read(dotGit)?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
  if (!gitDir) return null;
  const own = path.resolve(root, gitDir);
  const common = read(path.join(own, "commondir"))?.trim();
  return common ? path.resolve(own, common) : own;
}

/** The URL of the remote called origin, else of the first remote in a git config. */
function remoteUrl(config: string): string | null {
  const urls = new Map<string, string>();
  let remote: string | null = null;
  for (const line of config.split(/\r?\n/)) {
    const section = line.match(/^\s*\[\s*([^\]\s"]+)(?:\s+"([^"]*)")?\s*\]/);
    if (section) {
      remote = section[1].toLowerCase() === "remote" ? (section[2] ?? null) : null;
      continue;
    }
    const url = remote !== null ? line.match(/^\s*url\s*=\s*(.+?)\s*$/i)?.[1] : undefined;
    if (url && !urls.has(remote!)) urls.set(remote!, url.replace(/^"(.*)"$/, "$1"));
  }
  return urls.get("origin") ?? urls.values().next().value ?? null;
}

/**
 * A remote's address as host/path, lowercase: without the scheme, user, password, port and ".git", so the https and
 * ssh addresses of one repository are the same and a token in the URL never gets further. Null for a remote that is a
 * folder or a file, which means nothing on another computer.
 */
export function remoteIdentity(url: string): string | null {
  const u = url.trim();
  let host: string;
  let where: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
    try {
      const parsed = new URL(u);
      if (!["https:", "http:", "ssh:", "git:", "git+ssh:", "ssh+git:"].includes(parsed.protocol)) return null;
      host = parsed.hostname;
      where = decodeURIComponent(parsed.pathname);
    } catch {
      return null;
    }
  } else {
    // The short ssh form, git@github.com:owner/repo.git. A one-letter "host" is a Windows drive.
    const scp = u.match(/^(?:[^@/\s]+@)?([^:/\s]{2,}):(?!\/\/)(.+)$/);
    if (!scp) return null;
    [, host, where] = scp;
  }
  where = where.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  return repoOf(`${host.toLowerCase().replace(/^www\./, "")}/${where}`.toLowerCase().replace(/#.*$/, "") || null);
}

/**
 * The repository a folder is in, as a project keeps it (REPO in store/shared.ts): its remote, and after "#" the
 * folder's place inside it when that isn't the root. A worktree is its repository. Null outside a repository, or for
 * one without a remote elsewhere.
 */
export function repoIdentity(folder: string): string | null {
  const root = repoRoot(folder);
  const common = root && commonDir(root);
  const config = common && read(path.join(common, "config"));
  const url = config && remoteUrl(config);
  const remote = url ? remoteIdentity(url) : null;
  if (!remote || !root) return null;
  const inside = path.relative(root, path.resolve(folder)).split(path.sep).join("/").toLowerCase();
  return inside ? repoOf(`${remote}#${inside}`) : remote;
}

/** The checkout a worktree was made from, or the folder itself: a submodule, or a worktree of a bare repository, stays itself. */
export function mainCheckout(root: string): string {
  const common = commonDir(root);
  return common && path.basename(common) === ".git" && path.dirname(common) !== path.resolve(root) ? path.dirname(common) : root;
}
