import Link from "next/link";
import prices from "@/prices.json";
import { SITE } from "@/lib/site";
import type { Market } from "@/lib/markets";
import { CLOUD, FAQ, FREE, VIEWS as VIEW_COPY } from "@/lib/content";
import { faqPage, graph, pageMetadata, softwareApplication } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
import { Emblem } from "@/components/emblem";
import { Wordmark } from "@/components/wordmark";
import { ScreenDeck, type DeckItem } from "@/components/screen-deck";
import { TodayScreen } from "@/components/screens/today";
import { TimelineScreen } from "@/components/screens/timeline";
import { FlowScreen } from "@/components/screens/flow";
import { CloudPrice } from "@/components/cloud-price";

export const metadata = pageMetadata("/");

// Only what the price needs reaches the browser.
const markets: Market[] = Object.entries(prices.markets)
  .map(([code, { name, currency, locale, amount }]) => ({ code, name, currency, locale, amount }))
  .sort((a, b) => a.name.localeCompare(b.name));

// The screens render here, on the server; the deck only moves them.
const SCREENS = { Today: <TodayScreen />, Timeline: <TimelineScreen />, Flow: <FlowScreen /> };
const VIEWS: DeckItem[] = VIEW_COPY.map((view) => ({ ...view, screen: SCREENS[view.tab] }));

export default function Home() {
  return (
    <>
      <JsonLd data={graph(softwareApplication(), faqPage(FAQ))} />
      <header className="mx-auto flex h-[76px] max-w-[1120px] items-center justify-between px-5 sm:px-8">
        <Link href="/" aria-label="PacedMind" className="rounded-[7px]"><Emblem size={30} /></Link>
        <nav className="flex gap-[30px] text-[16px] text-mut">
          <a href="#pricing" className="hover:text-ink">Pricing</a>
          <a href={SITE.docs} className="hover:text-ink">Docs</a>
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

        {/* The same questions and answers are in the page's FAQPage data and in /llms-full.txt. */}
        <section id="faq" className="mt-24 scroll-mt-8 sm:mt-[150px]">
          <h2 className="text-[clamp(30px,3.9vw,46px)] leading-[1.15] font-light tracking-[-0.01em] text-ink">
            Frequently asked questions
          </h2>
          <div className="mt-12 border-t border-line sm:mt-16">
            {FAQ.map(({ question, answer }) => (
              <div key={question} className="grid gap-3 border-b border-line py-8 md:grid-cols-2 md:gap-0 md:py-10">
                <h3 className="text-[19px] leading-[1.35] font-medium text-ink sm:text-[20px] md:pr-14">{question}</h3>
                <p className="text-[16px] leading-[1.6] text-mut sm:text-[18px] md:pl-14">{answer}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto mt-24 max-w-[1120px] px-5 sm:mt-32 sm:px-8">
        <div className="flex items-center justify-between border-t border-line py-8 text-[15px] text-mut">
          <span className="flex items-center gap-3 text-text"><Emblem size={20} />PacedMind</span>
          <div className="flex gap-6">
            <a href={SITE.docs} className="hover:text-ink">Docs</a>
            <a href={SITE.repo} className="hover:text-ink">Source on GitHub</a>
          </div>
        </div>
      </footer>
    </>
  );
}
