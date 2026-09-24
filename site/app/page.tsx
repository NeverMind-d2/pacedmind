import Link from "next/link";
import prices from "@/prices.json";
import { SITE } from "@/lib/site";
import type { Market } from "@/lib/markets";
import { Wordmark } from "@/components/wordmark";
import { ScreenDeck, type DeckItem } from "@/components/screen-deck";
import { TodayScreen } from "@/components/screens/today";
import { TimelineScreen } from "@/components/screens/timeline";
import { FlowScreen } from "@/components/screens/flow";
import { CloudPrice } from "@/components/cloud-price";

// Only what the price needs reaches the browser.
const markets: Market[] = Object.entries(prices.markets)
  .map(([code, { name, currency, locale, amount }]) => ({ code, name, currency, locale, amount }))
  .sort((a, b) => a.name.localeCompare(b.name));

// The screens render here, on the server; the deck only moves them.
const VIEWS: DeckItem[] = [
  {
    tab: "Today",
    title: "Plan the day you have",
    body: "Tasks, time blocks, deadlines and events share one calendar. When an agent finishes, PacedMind tells you and books a short check in your day.",
    screen: <TodayScreen />,
  },
  {
    tab: "Timeline",
    title: "See the whole plan",
    body: "Every project, deadline and agent session on one timeline, next to the hours you have planned for each day.",
    screen: <TimelineScreen />,
  },
  {
    tab: "Flow",
    title: "Agents, one after another",
    body: "Place Claude Code and Codex sessions anywhere on the grid and connect them. The next one starts when the last finishes, after you sign off, or at a time you choose.",
    screen: <FlowScreen />,
  },
];

const FREE = ["Tasks, time blocks, calendar and deadlines", "Claude Code and Codex sessions, and flows", "Windows and macOS", "Your plan stays on your computer"];
const CLOUD = ["Everything in Open source", "Unlimited tasks in the cloud", "All your devices, in sync"];

function Emblem({ size }: { size: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- a static export has no image optimizer
  return <img src="/brand/emblem.svg" width={size} height={size} alt="" />;
}

export default function Home() {
  return (
    <>
      <header className="mx-auto flex h-[76px] max-w-[1120px] items-center justify-between px-5 sm:px-8">
        <Link href="/" aria-label="PacedMind" className="rounded-[7px]"><Emblem size={30} /></Link>
        <nav className="flex gap-[30px] text-[16px] text-mut">
          <a href="#pricing" className="hover:text-ink">Pricing</a>
          <a href={SITE.repo} className="hover:text-ink">GitHub</a>
        </nav>
      </header>

      <main className="mx-auto max-w-[1120px] px-5 sm:px-8">
        <section className="pt-[clamp(56px,12vh,112px)]">
          <h1><Wordmark id="hero-wordmark" unfold className="w-full max-w-[780px] text-ink" /></h1>
          <p className="mt-[34px] text-[clamp(34px,4.6vw,58px)] leading-[1.05] font-light tracking-[-0.01em] text-ink sm:mt-11">
            Find your pace.
          </p>
          <p className="mt-[22px] max-w-[560px] text-[18px] leading-[1.55] text-mut sm:text-[20px]">
            A calm planner for your tasks, time blocks and deadlines. It starts your Claude Code and Codex
            sessions and tells you when one is waiting for you.
          </p>
          <div className="mt-[38px] flex flex-wrap gap-3">
            <a className="download" data-os="windows" href={SITE.downloads.windows}>Download for Windows</a>
            <a className="download" data-os="mac" href={SITE.downloads.mac}>Download for macOS</a>
          </div>
          <p className="mt-4 text-[15px] text-mut">Free and open source on one device.</p>
        </section>

        <ScreenDeck items={VIEWS} />

        <section id="pricing" className="mt-24 scroll-mt-8 sm:mt-[150px]">
          <h2 className="max-w-[20em] text-[clamp(30px,3.9vw,46px)] leading-[1.15] font-light tracking-[-0.01em] text-ink">
            A little more peace of mind.{" "}
            <span className="block text-mut">For about the price of a music subscription.</span>
          </h2>
          <div className="mt-12 grid border-t border-line sm:mt-16 md:grid-cols-2">
            <div className="pb-12 pt-10 md:pr-14">
              <h3 className="text-[22px] font-medium text-ink">Open source</h3>
              <p className="mt-6 text-[46px] leading-none font-light text-ink">Free</p>
              <p className="mt-3 text-[15px] leading-6 text-mut">On one device</p>
              <ul className="mt-8 space-y-3 text-[16px] text-text">
                {FREE.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <a className="download for-windows mt-10" href={SITE.downloads.windows}>Download for Windows</a>
              <a className="download for-mac mt-10" href={SITE.downloads.mac}>Download for macOS</a>
            </div>
            <div className="border-t border-line pb-12 pt-10 md:border-l md:border-t-0 md:pl-14">
              <h3 className="text-[22px] font-medium text-ink">Cloud</h3>
              <div className="mt-6"><CloudPrice markets={markets} fallback={prices.fallback} /></div>
              <ul className="mt-8 space-y-3 text-[16px] text-text">
                {CLOUD.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <p className="mt-10 flex h-12 items-center text-[16px] text-mut">Coming soon</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto mt-24 max-w-[1120px] px-5 sm:mt-32 sm:px-8">
        <div className="flex items-center justify-between border-t border-line py-8 text-[15px] text-mut">
          <span className="flex items-center gap-3 text-text"><Emblem size={20} />PacedMind</span>
          <a href={SITE.repo} className="hover:text-ink">Source on GitHub</a>
        </div>
      </footer>
    </>
  );
}
