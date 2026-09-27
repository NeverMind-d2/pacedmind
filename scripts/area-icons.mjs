// Makes the icons an area can show from Lucide (https://lucide.dev, ISC): src/lib/area-icons.ts (names by
// category, with words to search them by) and src/components/area-icon-paths.ts (each icon as one path).
// To offer another icon, add its Lucide name to a category below and run `node scripts/area-icons.mjs`.
// It downloads the sprite and the tags of the version below, or reads them from a folder given as argument.
import fs from "node:fs";
import path from "node:path";

const LUCIDE = "1.48.0";
const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");

/** The picker's categories, in order; an icon listed twice stays in the first. */
const CATEGORIES = {
  Work: [
    "briefcase", "briefcase-business", "building", "factory", "landmark", "store", "handshake", "presentation",
    "chart-line", "chart-column", "chart-pie", "trending-up", "target", "clipboard-list", "clipboard-check", "list-todo",
    "square-check-big", "kanban", "file-text", "folder", "folder-open", "archive", "inbox", "mail", "send", "calendar",
    "calendar-days", "calendar-check", "clock", "timer", "alarm-clock", "hourglass", "award", "crown", "scale", "gavel",
    "stamp", "id-card",
  ],
  Tech: [
    "code", "code-xml", "terminal", "braces", "bug", "git-branch", "git-merge", "git-pull-request", "cpu", "database",
    "server", "cloud", "cloud-cog", "laptop", "monitor", "smartphone", "tablet", "keyboard", "mouse", "wifi", "globe",
    "network", "shield", "shield-check", "lock", "key-round", "fingerprint-pattern", "bot", "sparkles", "wand-sparkles", "rocket",
    "satellite", "radar", "layers", "layout-dashboard", "blocks", "puzzle", "component", "box", "package", "boxes",
    "hard-drive", "cable", "plug", "battery", "zap", "power", "settings", "wrench", "hammer", "cog", "workflow", "webhook",
    "qr-code",
  ],
  People: [
    "user", "users", "user-round", "contact", "baby", "heart-handshake", "hand-heart", "face-slightly-smiling", "message-circle",
    "message-square", "messages-square", "phone", "video", "mic", "megaphone", "bell", "at-sign", "share-2", "rss",
    "party-popper", "person-standing", "accessibility",
  ],
  Learning: [
    "graduation-cap", "school", "book", "book-open", "book-bookmark", "library", "notebook", "notebook-pen", "pencil",
    "pen-tool", "highlighter", "languages", "brain", "lightbulb", "microscope", "flask-conical", "atom", "dna", "telescope",
    "calculator", "sigma", "ruler", "earth", "map", "compass", "glasses", "scroll-text",
  ],
  Health: [
    "heart", "heart-pulse", "activity", "stethoscope", "pill", "syringe", "hospital", "cross", "dumbbell", "bike",
    "footprints", "apple", "salad", "bed", "eye", "brain-circuit", "thermometer", "bandage", "droplet", "face-grinning",
  ],
  Home: [
    "house", "sofa", "armchair", "lamp", "bath", "shower-head", "key", "door-open", "bed-double", "sprout", "flower",
    "flower-2", "trees", "tree-pine", "tree-deciduous", "shopping-cart", "shopping-bag", "shirt", "scissors",
    "washing-machine", "dog", "cat", "paw-print", "fish", "bird", "rabbit", "turtle", "gift", "cake", "calendar-heart",
    "paint-roller", "trash", "recycle",
  ],
  Food: [
    "utensils", "utensils-crossed", "chef-hat", "cooking-pot", "soup", "coffee", "cup-soda", "wine", "beer", "martini",
    "pizza", "sandwich", "croissant", "ice-cream-cone", "cookie", "egg", "cherry", "grape", "banana", "citrus", "carrot",
    "popcorn", "candy", "milk",
  ],
  Travel: [
    "plane", "plane-takeoff", "car", "car-taxi-front", "bus", "train-front", "tram-front", "ship", "sailboat", "anchor",
    "map-pin", "navigation", "route", "signpost", "tent", "caravan", "mountain", "mountain-snow", "tree-palm", "luggage",
    "ticket", "hotel", "fuel",
  ],
  Nature: [
    "sun", "moon", "cloud-sun", "cloud-rain", "snowflake", "umbrella", "flame", "waves-horizontal", "wind", "rainbow", "sunrise",
    "sunset", "star", "sparkle", "leaf", "clover", "feather", "shell",
  ],
  Money: [
    "wallet", "piggy-bank", "coins", "banknote", "credit-card", "receipt", "badge-dollar-sign", "dollar-sign", "euro",
    "percent", "tag", "tags", "gem", "chart-candlestick", "bitcoin", "hand-coins", "vault", "chart-no-axes-combined",
  ],
  Media: [
    "palette", "brush", "paintbrush", "music", "music-2", "headphones", "guitar", "piano", "camera", "image", "film",
    "clapperboard", "tv", "radio", "mic-vocal", "gamepad-2", "dices", "drama", "book-audio", "disc-3", "speaker",
    "projector", "aperture",
  ],
  Sports: ["trophy", "medal", "volleyball", "goal", "joystick", "flag", "swords", "sword", "dice-5", "spade", "timer-reset"],
  Symbols: [
    "bookmark", "circle", "square", "triangle", "hexagon", "diamond", "octagon", "pentagon", "infinity", "hash", "asterisk",
    "check", "circle-check", "badge", "sun-moon", "moon-star", "orbit", "circle-dot", "shapes",
  ],
};

const local = process.argv[2];
const read = async (file) => (local ? fs.readFileSync(path.join(local, file), "utf8")
  : await (await fetch(`https://cdn.jsdelivr.net/npm/lucide-static@${LUCIDE}/${file}`)).text());
const sprite = await read(local ? "lucide-sprite.svg" : "sprite.svg");
const tags = JSON.parse(await read(local ? "lucide-tags.json" : "tags.json"));

const symbols = new Map([...sprite.matchAll(/<symbol id="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g)].map((m) => [m[1], m[2]]));
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([a-zA-Z0-9:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const f = (v) => String(Math.round(v * 1000) / 1000);

/** A path's first moveto is absolute even when written "m"; its implicit linetos stay relative, so they get an "l". */
function absoluteStart(d) {
  if (d[0] !== "m") return d;
  const num = /\s*,?\s*(-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?)/y;
  let i = 1;
  const xy = [];
  for (let k = 0; k < 2; k++) {
    num.lastIndex = i;
    const m = num.exec(d);
    xy.push(m[1]);
    i = num.lastIndex;
  }
  const rest = d.slice(i);
  return `M${xy[0]} ${xy[1]}` + (/^\s*,?\s*[-.\d]/.test(rest) ? "l" + rest.replace(/^\s*,?\s*/, "") : rest);
}

function toPath(name, a) {
  const n = Number;
  switch (name) {
    case "path": return absoluteStart(a.d.trim());
    case "rect": {
      const x = n(a.x ?? 0), y = n(a.y ?? 0), w = n(a.width), h = n(a.height);
      const rx = Math.min(n(a.rx ?? a.ry ?? 0), w / 2), ry = Math.min(n(a.ry ?? a.rx ?? 0), h / 2);
      if (!rx) return `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}z`;
      return `M${f(x + rx)} ${f(y)}h${f(w - 2 * rx)}a${f(rx)} ${f(ry)} 0 0 1 ${f(rx)} ${f(ry)}v${f(h - 2 * ry)}`
        + `a${f(rx)} ${f(ry)} 0 0 1 ${f(-rx)} ${f(ry)}h${f(-(w - 2 * rx))}a${f(rx)} ${f(ry)} 0 0 1 ${f(-rx)} ${f(-ry)}`
        + `v${f(-(h - 2 * ry))}a${f(rx)} ${f(ry)} 0 0 1 ${f(rx)} ${f(-ry)}z`;
    }
    case "circle": {
      const cx = n(a.cx), cy = n(a.cy), r = n(a.r);
      return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`;
    }
    case "ellipse": {
      const cx = n(a.cx), cy = n(a.cy), rx = n(a.rx), ry = n(a.ry);
      return `M${f(cx - rx)} ${f(cy)}a${f(rx)} ${f(ry)} 0 1 0 ${f(2 * rx)} 0a${f(rx)} ${f(ry)} 0 1 0 ${f(-2 * rx)} 0`;
    }
    case "line": return `M${a.x1} ${a.y1}L${a.x2} ${a.y2}`;
    case "polyline":
    case "polygon": {
      const p = a.points.trim().split(/[\s,]+/).map(Number);
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 2; i < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
      return name === "polygon" ? d + "z" : d;
    }
    default: throw new Error(`Unknown element <${name}>`);
  }
}

const seen = new Set();
const missing = [];
const categories = [];
const paths = {};
const words = {};
for (const [category, names] of Object.entries(CATEGORIES)) {
  const icons = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    const body = symbols.get(name);
    if (!body) { missing.push(name); continue; }
    seen.add(name);
    icons.push(name);
    paths[name] = [...body.matchAll(/<(path|rect|circle|ellipse|line|polyline|polygon)\b([^>]*)\/?>/g)].map((m) => toPath(m[1], attrs(m[2]))).join(" ");
    const own = name.replace(/-\d+$/, "").split("-");
    words[name] = [...new Set([...own, ...(tags[name] ?? []).map((t) => t.toLowerCase())])].join(" ").slice(0, 160);
  }
  categories.push({ name: category, icons });
}
if (missing.length) console.warn(`Not in Lucide ${LUCIDE}, left out: ${missing.join(", ")}`);

const header = `// Made by scripts/area-icons.mjs from Lucide ${LUCIDE}: change the list there and run it again.\n`;
fs.writeFileSync(path.join(root, "src/lib/area-icons.ts"), `${header}
/*
 * The icons an area can show in its color instead of its dot: Lucide's names, by category in the order the area's
 * menu offers them, with words to find each one by. src/components/area-icon-paths.ts draws them; the data keeps
 * only the name.
 */
export const AREA_ICON_CATEGORIES = [
${categories.map((c) => `  { name: ${JSON.stringify(c.name)}, icons: [${c.icons.map((i) => JSON.stringify(i)).join(", ")}] },`).join("\n")}
] as const;

export type AreaIcon = (typeof AREA_ICON_CATEGORIES)[number]["icons"][number];

export const AREA_ICONS: readonly AreaIcon[] = AREA_ICON_CATEGORIES.flatMap((c) => c.icons);

const known = new Set<string>(AREA_ICONS);

export const isAreaIcon = (v: unknown): v is AreaIcon => typeof v === "string" && known.has(v);

/** An area's icon as stored: null when it has none, or a name this version doesn't draw. */
export const areaIconOf = (v: unknown): AreaIcon | null => (isAreaIcon(v) ? v : null);

/** What an icon is called: its name without Lucide's variant number, such as "Graduation cap". */
export const areaIconLabel = (icon: AreaIcon) => {
  const words = icon.replace(/-\\d+$/, "").replace(/-/g, " ");
  return words[0].toUpperCase() + words.slice(1);
};

/** Words each icon can be found by: its name and Lucide's tags. */
export const AREA_ICON_WORDS: Record<AreaIcon, string> = {
${Object.entries(words).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n")}
};

/** The icons whose name or words contain every word of \`query\`, in the picker's order. */
export function findAreaIcons(query: string): AreaIcon[] {
  const parts = query.toLowerCase().split(/\\s+/).filter(Boolean);
  if (!parts.length) return [...AREA_ICONS];
  return AREA_ICONS.filter((icon) => parts.every((p) => icon.includes(p) || AREA_ICON_WORDS[icon].includes(p)));
}
`);

fs.writeFileSync(path.join(root, "src/components/area-icon-paths.ts"), `${header}
/*
 * The icons an area can show (src/lib/area-icons.ts), each redrawn as one path in a 24 × 24 box, like icons.tsx.
 *
 * Lucide, ISC License. Copyright (c) 2026 Lucide Icons and Contributors. Permission to use, copy, modify, and/or
 * distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright
 * notice and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS
 * ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO
 * EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
 * TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
import type { AreaIcon } from "@/lib/area-icons";

export const AREA_ICON_PATHS: Record<AreaIcon, string> = {
${Object.entries(paths).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n")}
};
`);
console.log(`${seen.size} icons in ${categories.length} categories: ${categories.map((c) => `${c.name} ${c.icons.length}`).join(", ")}`);
