// Whether this checkout may replace what every checkout shares: the installed app (scripts/build-desktop.mjs) and
// what's published (scripts/release.mjs; deploy/deploy.sh has the same check in sh). Several sessions work in their
// own checkouts at once, and each of these takes whatever its checkout holds, so one that doesn't contain master rolls
// back work that already landed there: an install once dropped a feature that way. What gets published must also be
// committed, so nothing goes out that isn't in git. A copy without git, or without a master branch, isn't checked.
import { execFileSync } from "node:child_process";

/**
 * Throws unless the checkout at `root` contains master and, with `committed`, has no uncommitted changes (untracked
 * files included, ignored ones not). `skip` names the option that turns the check off, for the message.
 */
export function assertLanded(root, { committed = false, skip }) {
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  try {
    git("rev-parse", "--verify", "--quiet", "master");
  } catch {
    return; // Not a git checkout, or no master to compare with.
  }
  try {
    git("merge-base", "--is-ancestor", "master", "HEAD");
  } catch {
    throw new Error(`This checkout doesn't contain master, so it would roll back work that already landed there. Merge master into it first, or use ${skip} for a test.`);
  }
  if (committed && git("status", "--porcelain").trim()) {
    throw new Error(`This checkout has uncommitted changes, which would go out without being in git. Commit them first, or use ${skip} for a test.`);
  }
}
