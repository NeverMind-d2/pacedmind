import prices from "@/prices.json";
import { SITE, absoluteUrl } from "@/lib/site";
import { formatPlanPrice } from "@/lib/markets";
import { CLOUD, COST, DESCRIPTION, DOWNLOAD_NOTE, FAQ, NAME, ONE_DEVICE, PRICING, SUMMARY, TAGLINE, VIEWS } from "@/lib/content";

/**
 * /llms.txt and /llms-full.txt (https://llmstxt.org): PacedMind in plain Markdown for answer engines
 * and assistants, built from the page's own words. Like the page, never name the music service.
 */

const DOCS = absoluteUrl(SITE.docs);
const list = (items: readonly string[]) => items.map((item) => `- ${item}`).join("\n");

export function llmsTxt() {
  return `# ${NAME}

> ${DESCRIPTION}

${NAME} is a desktop planner for Windows and macOS. Tasks, time blocks, deadlines and calendar events share one calendar and one timeline. ${NAME} also coordinates AI coding agents: it starts Claude Code and Codex sessions from your tasks, each in its own terminal, runs them one after another in a flow if you like, and tells you when a session is waiting for you. The agents report back to ${NAME} over MCP (the Model Context Protocol), on your computer. ${NAME} doesn't run an AI model of its own and needs no API key.

- Plans: ${COST}
- Your data: on one device, your plan stays on your computer, with no account.
- Name: "${NAME}", one word. Its line is "${TAGLINE}"

## Docs

- [${NAME} documentation](${DOCS}): Guides and reference for ${NAME}.
- [Documentation index for language models](${DOCS}/llms.txt): The documentation, listed in this format.
- [The whole documentation](${DOCS}/llms-full.txt): Every page of the documentation in one Markdown file.

## Website

- [Home page](${absoluteUrl("/")}): What ${NAME} does, with its Today, Timeline and Flow views.
- [Pricing](${absoluteUrl("/#pricing")}): The free plan for one device, and Cloud with its price in your country.
- [Frequently asked questions](${absoluteUrl("/#faq")}): Price, systems, agents, API keys, where your plan is stored, and the source code.

## Download

- [${NAME} for Windows](${SITE.downloads.windows})
- [${NAME} for macOS](${SITE.downloads.mac})

## Source code

- [${NAME} on GitHub](${SITE.source}): The source code, under the GNU AGPL.

## Optional

- [Full text](${absoluteUrl("/llms-full.txt")}): The home page as text, with Cloud's price in every country and the answers to the frequently asked questions.
`;
}

export function llmsFullTxt() {
  const markets = Object.entries(prices.markets)
    .map(([code, { name, currency, locale, amount }]) => ({ code, name, currency, locale, amount }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return `# ${NAME}

> ${DESCRIPTION}

The ${NAME} home page, ${absoluteUrl("/")}, as text. The documentation is at ${DOCS}, with an index for language models at ${DOCS}/llms.txt and all of it in one file at ${DOCS}/llms-full.txt.

## ${TAGLINE}

${SUMMARY}

- [Download ${NAME} for Windows](${SITE.downloads.windows})
- [Download ${NAME} for macOS](${SITE.downloads.mac})

${DOWNLOAD_NOTE}

## Views

${VIEWS.map(({ tab, title, body }) => `### ${tab}: ${title}\n\n${body}`).join("\n\n")}

## Pricing

${PRICING.title} ${PRICING.subtitle} ${PRICING.plans}

### One device: free

${list(ONE_DEVICE)}

### Cloud: coming soon

${list(CLOUD)}

Cloud's monthly price in each country, as of ${prices.checkedOn}:

${list(markets.map((market) => `${market.name}: ${formatPlanPrice(market)} (${market.currency})`))}

## Frequently asked questions

${FAQ.map(({ question, answer }) => `### ${question}\n\n${answer}`).join("\n\n")}
`;
}
