// Makes the brand marks Settings shows next to MCP servers and connectors, from Simple Icons (https://simpleicons.org,
// CC0): src/components/tool-icon-paths.ts, each mark as one path on a 24 px square, and the names that lead to it.
// To add a brand, put its Simple Icons slug below, with the other names its servers go by, and run
// `node scripts/tool-icons.mjs`. A slug Simple Icons doesn't have (brands leave it) is skipped with a warning.
import fs from "node:fs";
import path from "node:path";

const SIMPLE_ICONS = "16.33.0";
const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");

/** Simple Icons slug: other names a server or connector goes by (compared as letters and digits only, lowercase). */
const BRANDS = {
  gmail: [],
  googlecalendar: ["gcal", "calendar"],
  googledrive: ["drive", "gdrive"],
  googledocs: [],
  googlesheets: [],
  googlechrome: ["chrome", "chromedevtools", "claudeinchrome"],
  googlegemini: ["gemini"],
  github: ["gh"],
  gitlab: ["glab"],
  supabase: [],
  linear: [],
  figma: [],
  notion: [],
  stripe: [],
  vercel: [],
  sentry: [],
  jira: [],
  confluence: [],
  atlassian: [],
  postgresql: ["postgres", "pg"],
  docker: [],
  obsidian: [],
  blender: [],
  hubspot: [],
  asana: [],
  cloudflare: [],
  netlify: [],
  zapier: [],
  airtable: [],
  todoist: [],
  dropbox: [],
  anthropic: [],
  claude: [],
  huggingface: ["hf"],
  mongodb: ["mongo"],
  redis: [],
  mysql: [],
  sqlite: [],
  firebase: [],
  npm: [],
  icons8: [],
  spotify: [],
  discord: [],
  telegram: [],
  whatsapp: [],
  trello: [],
  miro: [],
  shopify: [],
  wordpress: [],
  webflow: [],
  framer: [],
  posthog: [],
  grafana: [],
  datadog: [],
  elevenlabs: [],
  youtube: [],
  reddit: [],
  zoom: [],
  resend: [],
  nodedotjs: ["node", "nodejs"],
  clickup: [],
  intercom: [],
  perplexity: [],
  brave: [],
  mlflow: [],
  kubernetes: ["k8s", "kubectl"],
  terraform: [],
  googlecloud: ["gcp"],
  cursor: [],
  python: [],
};

const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function svgOf(slug) {
  const res = await fetch(`https://cdn.jsdelivr.net/npm/simple-icons@${SIMPLE_ICONS}/icons/${slug}.svg`);
  const text = await res.text();
  if (!res.ok || !text.startsWith("<svg")) return null;
  const d = /<path d="([^"]+)"/.exec(text)?.[1];
  const title = /<title>([^<]+)<\/title>/.exec(text)?.[1];
  return d && title ? { d, title: title.replace(/&amp;/g, "&") } : null;
}

const paths = {};
const names = {};
for (const [slug, aliases] of Object.entries(BRANDS)) {
  const icon = await svgOf(slug);
  if (!icon) {
    console.warn(`Simple Icons ${SIMPLE_ICONS} has no ${slug}; skipped.`);
    continue;
  }
  paths[slug] = icon.d;
  for (const n of [slug, key(icon.title), ...aliases.map(key)]) names[n] ??= slug;
}

const out = `// Made by scripts/tool-icons.mjs from Simple Icons ${SIMPLE_ICONS} (https://simpleicons.org, CC0). Don't edit by hand.

/** Each brand's mark as one path on a 24 px square, by its Simple Icons slug. */
export const TOOL_ICON_PATHS: Record<string, string> = ${JSON.stringify(paths, null, 2)};

/** The names a server or connector goes by (letters and digits, lowercase), and the slug of its brand's mark. */
export const TOOL_ICON_NAMES: Record<string, string> = ${JSON.stringify(names, null, 2)};
`;
fs.writeFileSync(path.join(root, "src/components/tool-icon-paths.ts"), out);
console.log(`${Object.keys(paths).length} marks, ${Object.keys(names).length} names`);
