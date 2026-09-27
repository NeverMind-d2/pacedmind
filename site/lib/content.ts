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

/*
 * The sections between the hero and the pricing tell one day three ways: your day beside the agents' (DAY), where
 * each session runs (PLACES) and how the next one starts (FLOW). The places and the ways to start are the app's own
 * (Runs in, and the ways to start in the Flow editor). Their widgets (day-strip, departures-board, session-flow and
 * the command palette) share this day, so change it in all of them together:
 * - You: 08:30 standup, 09:00–11:00 focus on the pricing page, checks at 11:00 (WEB-10), 11:15 (WEB-12) and 11:30
 *   (APP-31), 12:30 lunch with Ana, 13:30 check (WEB-14), 14:00 PER-8 Book the dentist, 15:00–16:30 WRK-31 (due 17:00).
 * - WEB-10 Draft the home page: Claude Code in the Claude app, 09:10–09:52. WEB-12 Write the pricing page: Claude Code
 *   in a terminal, on its own at 09:52, finished 10:42, marked done 11:20. APP-31 Fix calendar sync after sleep: Codex
 *   in a terminal, 09:40–11:10. WEB-14 Compress the hero images: Codex cloud, after WEB-12 is marked done, 11:20–13:20.
 *   WEB-16 Draft the launch announcement: Claude Code in a terminal at 18:00, back 18:47; WEB-17 Proofread the
 *   announcement carries on in the same session until 19:30.
 */

/** Your day and the agents' sessions on one timeline, with the checks PacedMind books when a session finishes. */
export const DAY = {
  title: "Your day, and your agents'.",
  subtitle: "When one finishes, a check lands in your day.",
  intro:
    "Tasks, time blocks, deadlines and events share your line. Claude Code and Codex each get one of their own. Press play to watch a day go by, at the pace you choose.",
};

/** Where each session runs. */
export const PLACES = {
  title: "Every session in its place.",
  subtitle: "In a terminal, the agent's app or the cloud.",
  intro:
    "Each task says where its session runs. PacedMind finds Claude Code and Codex on your computer by itself, starts every session in its place and keeps track of all of them.",
  items: [
    { icon: "terminal", name: "In a terminal", body: "Claude Code or Codex opens in a new terminal, in the task's folder, with the task as its first message." },
    { icon: "appWindow", name: "In the agent's app", body: "The Claude or Codex app opens a new session in the task's folder, with the first message written for you to send." },
    { icon: "cloud", name: "In the agent's cloud", body: "Claude Code on the web and Codex cloud work on a copy of your repository, on a new branch named after the task." },
  ],
  note: "Until you choose, a task runs in a terminal, or in the agent's app when its command-line tool isn't there. With Cloud, when it arrives, a task can also run on another of your computers.",
  harnesses: "Claude Code and Codex today. Support for more agent harnesses is coming soon.",
} as const;

/** How a flow starts the next session. */
export const FLOW = {
  title: "Sessions that start on their own.",
  subtitle: "One after another, in the order you choose.",
  intro:
    "Connect a project's tasks into a flow. When a task's turn comes, PacedMind starts its session with Claude Code or Codex, where the task runs, and tells you when one needs you.",
  modes: [
    { mode: "auto", name: "Automatically", body: "As soon as the session before it is finished." },
    { mode: "manual", name: "After you mark it done", body: "You check the work first, then the next session starts." },
    { mode: "session", name: "In the same session", body: "The agent carries on without stopping, with everything it learned." },
    { mode: "time", name: "At a set time", body: "At 18:00 or tomorrow at 9:00, once the task before it is finished." },
  ],
  note: "A task waits for every task connected to it. Work handed back partly done or blocked waits for you.",
} as const;

/** The command palette, to try on the page. It shows what PacedMind does, not the app's own Ctrl K. */
export const TRY = {
  title: "Try it here.",
  subtitle: "Pick something to do and see what happens.",
};

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
    answer: "Start a session from a task, and PacedMind opens Claude Code or Codex in a terminal or in the agent's desktop app, where you talk to the agent as usual, or sends the task to the agent's cloud. Connect tasks into a flow, and the next session starts when the last one finishes, after you mark it done, in the same session, or at a time you choose. When an agent finishes, PacedMind tells you and books a short check in your day.",
  },
  {
    question: "Which coding agents does PacedMind work with?",
    answer: "Claude Code and Codex, in a terminal, in their desktop apps or in their cloud. Support for more agent harnesses is coming soon.",
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
    answer: "Yes. The desktop app, the web app and Cloud's database rules are on GitHub at github.com/NeverMind-d2/pacedmind, under the GNU AGPL. You can read the code, build PacedMind yourself and send changes.",
  },
];
