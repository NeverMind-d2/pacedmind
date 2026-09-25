/**
 * The page's words, shared by the home page, /llms.txt, /llms-full.txt and the structured data, so
 * search and answer engines read what visitors see. The entity is always "PacedMind". app/page.tsx
 * also writes out the hero and the pricing heading in full: keep them the same as TAGLINE, SUMMARY
 * and PRICING.
 */
export const NAME = "PacedMind";
export const TAGLINE = "Find your pace.";
/** The link preview's title, as on the preview image. */
export const TITLE = `${NAME}: ${TAGLINE}`;

export const SUMMARY =
  "A calm planner for your tasks, time blocks and deadlines. It starts your Claude Code and Codex sessions and tells you when one is waiting for you.";
// No price in the metadata, the structured data, the FAQ or llms.txt: PacedMind won't be free on one
// device (a one-device plan and Cloud, with a 7-day trial), and the plans aren't on the page yet. The
// page's note under the downloads and its pricing section still describe the old free plan.
export const DESCRIPTION = `${SUMMARY} For Windows and macOS.`;

/** The home page in search results: what PacedMind is, and a description that fits the snippet (~155 characters). */
export const SEARCH_TITLE = `${NAME}: a calm planner for tasks and coding agents`;
export const SEARCH_DESCRIPTION =
  "A calm planner for tasks, time blocks and deadlines. It starts your Claude Code and Codex sessions and tells you when one is waiting. For Windows and macOS.";

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

export const PRICING = {
  title: "A little more peace of mind.",
  subtitle: "For about the price of a music subscription.",
};
export const FREE = ["Tasks, time blocks, calendar and deadlines", "Claude Code and Codex sessions, and flows", "Windows and macOS", "Your plan stays on your computer"];
export const CLOUD = ["Everything in Open source", "Unlimited tasks in the cloud", "All your devices, in sync"];

/** Shown on the page and in its FAQPage data word for word: search engines check that the two match. */
export const FAQ = [
  {
    question: "What is PacedMind?",
    answer: "PacedMind is a calm planner for your tasks, time blocks and deadlines. It starts your Claude Code and Codex sessions and tells you when one is waiting for you.",
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
    answer: "On your computer. With Cloud, when it arrives, your plan stays in sync across all your devices.",
  },
];
