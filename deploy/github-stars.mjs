// Copies PacedMind's star count on GitHub into the file named on the command line, as {"stars": N}. The site's
// header reads it as pacedmind.com/github.json (Caddyfile), so visitors' browsers never contact GitHub themselves.
// pacedmind-github.timer runs it every ten minutes, well inside GitHub's 60 requests an hour for one address;
// deploy.sh installs it as /usr/local/lib/pacedmind/github-stars.mjs. On any failure the last count stays.
import { renameSync, writeFileSync } from "node:fs";

const REPO = "NeverMind-d2/pacedmind"; // SITE.repo in site/lib/site.ts
const file = process.argv[2];
if (!file) throw new Error("usage: node github-stars.mjs <file>");

const res = await fetch(`https://api.github.com/repos/${REPO}`, {
  headers: { accept: "application/vnd.github+json", "user-agent": "pacedmind.com" },
  signal: AbortSignal.timeout(20_000),
});
if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
const stars = (await res.json()).stargazers_count;
if (!Number.isSafeInteger(stars) || stars < 0) throw new Error("GitHub's answer has no star count");
// Written beside the file, then renamed over it, so Caddy never serves half of one.
writeFileSync(`${file}.new`, `${JSON.stringify({ stars })}\n`);
renameSync(`${file}.new`, file);
