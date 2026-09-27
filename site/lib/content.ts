import { SITE } from "@/lib/site";

/**
 * The page's words, shared by the home page, /llms.txt, /llms-full.txt and the structured data, so
 * search and answer engines read what visitors see. The entity is always "PacedMind".
 */
export const NAME = "PacedMind";
export const TAGLINE = "Find your pace.";
/** The link preview's title, as on the preview image. */
export const TITLE = `${NAME}: ${TAGLINE}`;

export const SUMMARY =
  "A calm planner for your tasks, time blocks and deadlines. It starts your Claude Code and Codex sessions and tells you when one is waiting for you.";
export const DESCRIPTION = `${SUMMARY} Free on one device, for Windows and macOS.`;
/** Under the download buttons. */
export const DOWNLOAD_NOTE = "Free on one device. No account needed.";

/** The home page in search results: what PacedMind is, and a description that fits the snippet (~155 characters). */
export const SEARCH_TITLE = `${NAME}: a calm planner for tasks and coding agents`;
export const SEARCH_DESCRIPTION =
  "A calm planner for tasks, time blocks and deadlines. It starts Claude Code and Codex sessions and tells you when one is waiting. Free for Windows and macOS.";

/** The three views in the screen deck. */
export const VIEWS = [
  {
    tab: "Today",
    title: "Plan the day you have",
    body: "Tasks, time blocks, deadlines and events share one calendar. When an agent finishes, PacedMind tells you and books a short check in your day.",
  },
  {
    tab: "Timeline",
    title: "See the whole plan",
    body: "Every project, deadline and agent session on one timeline, next to the hours you have planned for each day.",
  },
  {
    tab: "Flow",
    title: "Agents, one after another",
    body: "Place Claude Code and Codex sessions anywhere on the grid and connect them. The next one starts when the last finishes, after you sign off, or at a time you choose.",
  },
] as const;

/**
 * The source code: why it's public, the commands that build it (the repository's README), and what anyone can do
 * with it. The FAQ's last answer says the same in short.
 */
export const OPEN_SOURCE = {
  title: "Open source, every line.",
  subtitle: "Read it, build it, change it.",
  intro:
    "PacedMind starts agents on your computer, so you should be able to see exactly what it does. The desktop app, the web app and Cloud's database rules are all on GitHub, under the GNU AGPL.",
  /** After the download note in the hero, as a link to this section. */
  hero: "Open source.",
  license: "GNU AGPL-3.0",
  commands: [`git clone ${SITE.source}`, `cd ${SITE.repo.split("/")[1]}`, "npm install", "npm run desktop"],
  items: [
    {
      icon: "code",
      name: "Read the code",
      body: "See what PacedMind does with your plan and your agents, down to the database rules that keep every Cloud account private.",
      link: "Browse the repository",
      href: SITE.source,
    },
    {
      icon: "terminal",
      name: "Build it yourself",
      body: "With Node.js and Git, the four commands above build PacedMind on Windows or macOS, install it and start it.",
      link: "Build from the source code",
      href: `${SITE.docs}/getting-started/install#build-from-the-source-code`,
    },
    {
      icon: "pullRequest",
      name: "Make it better",
      body: "Report a bug, suggest an idea or send a pull request. Fixes and clearer documentation are always welcome.",
      link: "How to contribute",
      href: SITE.contributing,
    },
  ],
  note: "The GNU AGPL keeps it that way: whoever shares a changed version of PacedMind, or runs one for other people over a network, has to share its source code too.",
} as const;

/**
 * Two plans. One device is free and needs no account. Cloud costs what a music subscription costs in
 * each country (prices.json) and starts with a free trial. The structured data offers One device at a
 * price of 0 (lib/seo.ts).
 */
export const PRICING = {
  title: "A little more peace of mind.",
  subtitle: "For about the price of a music subscription.",
  plans: "Free on one device. Cloud starts with 7 days free.",
};
export const ONE_DEVICE = ["Tasks, time blocks, calendar and deadlines", "Claude Code and Codex sessions, and flows", "Windows and macOS", "Your plan stays on your computer", "No account needed"];
export const CLOUD = ["Everything in One device", "Unlimited tasks in the cloud", "All your devices, in sync", "Start sessions on your other computers"];
/** The price question's answer, also the plans line in /llms.txt. */
export const COST =
  "PacedMind is free on one device, without an account. Cloud, with unlimited tasks in the cloud and all your devices in sync, is coming soon for about the price of a music subscription in your country. It starts with 7 days free.";

/** Shown on the page and in its FAQPage data word for word: search engines check that the two match. */
export const FAQ = [
  {
    question: "What is PacedMind?",
    answer: "PacedMind is a calm planner for your tasks, time blocks and deadlines. It starts your Claude Code and Codex sessions and tells you when one is waiting for you.",
  },
  {
    question: "How much does PacedMind cost?",
    answer: COST,
  },
  {
    question: "Which computers does PacedMind run on?",
    answer: "Windows and macOS.",
  },
  {
    question: "How does PacedMind work with Claude Code and Codex?",
    answer: "Start a session from a task, and PacedMind opens Claude Code or Codex in its own terminal, where you talk to the agent as usual. Connect tasks into a flow, and the next session starts when the last one finishes, after you sign off, or at a time you choose. When an agent finishes, PacedMind tells you and books a short check in your day.",
  },
  {
    question: "Do I need Claude Code or Codex to use PacedMind?",
    answer: "No. Tasks, time blocks, the calendar and deadlines work on their own. The agent sessions are there when you want them.",
  },
  {
    question: "Does PacedMind need an API key?",
    answer: "No. PacedMind doesn't run an AI model of its own. It starts the Claude Code and Codex you already use, and they report back to PacedMind on your computer.",
  },
  {
    question: "Where is my plan stored?",
    answer: "On your computer, and you don't need an account. With Cloud, when it arrives, you sign in and your plan stays in sync across all your devices.",
  },
  {
    question: "Is PacedMind open source?",
    answer: "Yes. The desktop app, the web app and Cloud's database rules are on GitHub at github.com/Pacedmind/pacedmind, under the GNU AGPL. You can read the code, build PacedMind yourself and send changes.",
  },
];
