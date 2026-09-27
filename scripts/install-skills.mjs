// Installs PacedMind's agent skills (skills/*) for Claude Code (~/.claude/skills) and, when Codex is
// installed, for Codex (~/.codex/skills). Run it again after changing the skills.
//
//   npm run skills              install or update
//   npm run skills -- --remove  uninstall
//
// Only the skills from this repo are touched; other skills in those folders are left alone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "skills");
const remove = process.argv.includes("--remove");

/** Checks the frontmatter rules both Claude Code and Codex rely on. */
function check(name) {
  const text = fs.readFileSync(path.join(source, name, "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1];
  if (!front) throw new Error(`${name}/SKILL.md has no frontmatter`);
  const field = (key) => new RegExp(`^${key}: (.+)$`, "m").exec(front)?.[1]?.trim();
  if (field("name") !== name) throw new Error(`${name}/SKILL.md: name must be "${name}"`);
  if (!/^[a-z0-9-]{1,64}$/.test(name)) throw new Error(`${name}: use lowercase letters, digits and hyphens (max 64)`);
  const description = field("description");
  if (!description || description.length > 1024) throw new Error(`${name}/SKILL.md: description must be 1-1024 characters`);
}

const skills = fs.readdirSync(source).filter((n) => fs.existsSync(path.join(source, n, "SKILL.md")));
for (const name of skills) check(name);

const targets = [
  { app: "Claude Code", home: path.join(os.homedir(), ".claude") },
  { app: "Codex", home: path.join(os.homedir(), ".codex") },
];

for (const { app, home } of targets) {
  if (!fs.existsSync(home)) {
    console.log(`${app}: not installed (${home} is missing), skipped.`);
    continue;
  }
  const dir = path.join(home, "skills");
  fs.mkdirSync(dir, { recursive: true });
  for (const name of skills) {
    const dest = path.join(dir, name);
    fs.rmSync(dest, { recursive: true, force: true }); // So files deleted from a skill don't linger.
    if (!remove) fs.cpSync(path.join(source, name), dest, { recursive: true });
  }
  console.log(`${app}: ${remove ? "removed" : "installed"} ${skills.join(", ")} ${remove ? "from" : "in"} ${dir}`);
}
if (!remove) console.log("Start a new Claude Code or Codex session to pick them up.");
