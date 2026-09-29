import { SITE } from "@/lib/site";
import type { IconName } from "@/components/screens/parts";

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

/** The views in the screen deck, in the order of their screenshots (site/screens, `npm run screenshots` in the app). */
export const VIEWS = [
  {
    tab: "Today",
    title: "Plan the day you have",
    body: "What's scheduled, overdue, due and planned for today, in one list. When an agent finishes, PacedMind tells you and books a short check in your day.",
  },
  {
    tab: "Week",
    title: "Give every task its hour",
    body: "Drag tasks onto your week, or let the auto-planner fill the free time around your events. Your agents' tasks show in their own colors.",
  },
  {
    tab: "Timeline",
    title: "See the whole plan",
    body: "Every project, deadline and agent session on one timeline, next to the hours you have planned for each day. Arrows show which task waits for which.",
  },
] as const;

/** One agent's way to connect to PacedMind Cloud: a command, a button or the address, and what happens next. */
export type ConnectAgent = {
  id: string;
  name: string;
  icon: IconName;
  how: string;
  /** Commands for a terminal, copied together. */
  commands?: readonly string[];
  /** A link that opens the agent's app, which asks to add the server. */
  install?: { label: string; href: string };
  /** Whether the server's address is there to copy. */
  address?: boolean;
  then: string;
};

/**
 * Connecting an agent to PacedMind Cloud's MCP server, in the home page's #connect section and at /connect. The
 * commands are the app's (src/server/connect.ts, Settings → Connect your agents) and the docs'
 * (docs/content/docs/mcp/connect-cloud.mdx); every agent then signs in in the browser, where you select Allow.
 */
const cursorInstall = `cursor://anysphere.cursor-deeplink/mcp/install?name=pacedmind&config=${encodeURIComponent(btoa(JSON.stringify({ url: SITE.mcp })))}`;
const vscodeInstall = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "pacedmind", type: "http", url: SITE.mcp }))}`;
const inBrowser = "PacedMind opens in your browser: sign in and select Allow.";

export const CONNECT = {
  title: "Connect your agent.",
  subtitle: "One command, then Allow.",
  intro:
    "Claude Code, Codex, Cursor, ChatGPT and other agents plan with you through PacedMind Cloud's MCP server: they read your day, add tasks and report on their work. You allow each one in the browser, so there's no token to copy.",
  /** The /connect page's description. */
  description:
    "Connect Claude Code, Codex, Cursor, VS Code, Claude or ChatGPT to PacedMind Cloud's MCP server: one command or one click, then Allow in the browser.",
  /** Above the agents' links in the hero. */
  hero: "Or connect the agent you already use:",
  account: "No account yet? PacedMind's page lets you create one, with 7 days free and no card.",
  local:
    "Rather keep your plan on your computer? The desktop app is free without an account and connects Claude Code and Codex to itself, in Settings → Connect your agents.",
  details: "Connection details",
  agents: [
    {
      id: "claude-code",
      name: "Claude Code",
      icon: "terminal",
      how: "Run these in a terminal.",
      commands: [`claude mcp add --transport http --scope user pacedmind ${SITE.mcp}`, "claude mcp login pacedmind"],
      then: `After the second one, ${inBrowser} Claude Code, and the Code sessions in the Claude app, can then use it.`,
    },
    {
      id: "codex",
      name: "Codex",
      icon: "terminal",
      how: "Run these in a terminal.",
      commands: [`codex mcp add pacedmind --url ${SITE.mcp}`, "codex mcp login pacedmind"],
      then: `After the second one, ${inBrowser} The Codex app uses the same setup.`,
    },
    {
      id: "cursor",
      name: "Cursor",
      icon: "code",
      how: "Add PacedMind to Cursor with one click.",
      install: { label: "Add to Cursor", href: cursorInstall },
      then: `Cursor shows the server with its address filled in: select Install. When it asks you to sign in, ${inBrowser}`,
    },
    {
      id: "vscode",
      name: "VS Code",
      icon: "code",
      how: "Add PacedMind to VS Code with one click.",
      install: { label: "Add to VS Code", href: vscodeInstall },
      then: `VS Code shows the server: select Install. When it asks you to sign in, ${inBrowser}`,
    },
    {
      id: "claude",
      name: "Claude",
      icon: "appWindow",
      how: "In Claude, open Customize → Connectors, select + and then Add custom connector, and paste this address.",
      address: true,
      then: `Select Add, then Connect. ${inBrowser}`,
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      icon: "appWindow",
      how: "In ChatGPT, turn on Developer mode in Settings → Apps → Advanced settings. Then create an app with this address and OAuth.",
      address: true,
      then: `When ChatGPT connects it, ${inBrowser}`,
    },
    {
      id: "other",
      name: "Other",
      icon: "plus",
      how: "In any MCP client that signs in with OAuth, add this address as a streamable HTTP server.",
      address: true,
      then: `The client finds PacedMind's sign-in and registers by itself. Then ${inBrowser}`,
    },
  ] satisfies ConnectAgent[] as readonly ConnectAgent[],
};

/*
 * The sections between the hero and the pricing tell one day two ways: your day beside the agents' (DAY) and where
 * each session runs (PLACES). The places are the app's own (Runs in). Their widgets (day-strip, departures-board and
 * the command palette's results) share this day, so change it in all of them together. Nothing in it starts by
 * itself: you start every session, from its task or by asking an agent in a chat, which PacedMind asks you to allow.
 * - You: 08:30 standup, 09:00–11:00 focus on the pricing page, checks at 11:00 (WEB-10), 11:15 (WEB-12) and 11:30
 *   (APP-31), 12:30 lunch with Ana, 13:30 check (WEB-14), 14:00 PER-8 Book the dentist, 15:00–16:30 WRK-31 (due 17:00).
 * - WEB-10 Draft the home page: Claude Code in the Claude app, 09:10–09:52. WEB-12 Write the pricing page, which waits
 *   for WEB-10: Claude Code in a terminal, started at 09:52, finished 10:42, marked done 11:20. APP-31 Fix calendar sync
 *   after sleep: Codex in a terminal, 09:40–11:10. WEB-14 Compress the hero images, which waits for WEB-12: ready at
 *   10:42, sent to Codex cloud once WEB-12 is marked done, 11:20–13:20. WEB-16 Draft the launch announcement: Claude
 *   Code in a terminal, asked for in a chat at 18:00, back 18:47.
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
  note: `Until you choose, a task runs in a terminal, or in the agent's app when its command-line tool isn't there. With Cloud${SITE.cloudOpen ? "" : ", when it arrives"}, a task can also run on another of your computers.`,
  harnesses: "Claude Code and Codex today. Support for more agent harnesses is coming soon.",
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
export const ONE_DEVICE = ["Tasks, time blocks, calendar and deadlines", "Claude Code and Codex sessions", "Windows and macOS", "Your plan stays on your computer", "No account needed"];
export const CLOUD = ["Everything in One device", "Unlimited tasks in the cloud", "All your devices, in sync", "Start sessions on your other computers"];
/** The price question's answer, also the plans line in /llms.txt. */
export const COST = SITE.cloudOpen
  ? "PacedMind is free on one device, without an account. Cloud, with unlimited tasks in the cloud and all your devices in sync, costs about the price of a music subscription in your country, monthly, or ten months' worth for a year. It starts with 7 days free, without a card."
  : "PacedMind is free on one device, without an account. Cloud, with unlimited tasks in the cloud and all your devices in sync, is coming soon for about the price of a music subscription in your country. It starts with 7 days free.";

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
    answer: "Start a session from a task, and PacedMind opens Claude Code or Codex in a terminal or in the agent's desktop app, where you talk to the agent as usual, or sends the task to the agent's cloud. You can also ask an agent in any chat to start one on any of your computers, and each asks you first unless you let it start them itself. Nothing starts on its own: the dependencies you draw on the Timeline only put the work in order. When an agent finishes, PacedMind tells you and books a short check in your day.",
  },
  {
    question: "How do I connect my agent to PacedMind?",
    answer: `With PacedMind Cloud, agents use its MCP server at ${SITE.mcp}. For Claude Code, run "claude mcp add --transport http --scope user pacedmind ${SITE.mcp}" and then "claude mcp login pacedmind"; for Codex, "codex mcp add pacedmind --url ${SITE.mcp}" and then "codex mcp login pacedmind". Cursor and VS Code add it with one click from pacedmind.com/connect, and Claude and ChatGPT as a custom connector. The agent then opens PacedMind in your browser, where you sign in and select Allow. Without an account, the desktop app connects Claude Code and Codex to itself, in Settings → Connect your agents.`,
  },
  {
    question: "Which coding agents does PacedMind work with?",
    answer: "PacedMind starts Claude Code and Codex, in a terminal, in their desktop apps or in their cloud; support for more agent harnesses is coming soon. Any agent that speaks MCP, such as Cursor, VS Code, Claude or ChatGPT, can plan with you through PacedMind Cloud.",
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
    answer: `On your computer, and you don't need an account. With Cloud${SITE.cloudOpen ? "" : ", when it arrives"}, you sign in and your plan stays in sync across all your devices.`,
  },
  {
    question: "Is PacedMind open source?",
    answer: "Yes. The desktop app, the web app and Cloud's database rules are on GitHub at github.com/Pacedmind/pacedmind, under the GNU AGPL. You can read the code, build PacedMind yourself and send changes.",
  },
];
