import Link from "next/link";
import prices from "@/prices.json";
import { SITE, downloadEvent, signInEvent } from "@/lib/site";
import type { Market } from "@/lib/markets";
import { CLOUD, DAY, DOWNLOAD_NOTE, FAQ, FLOW, ONE_DEVICE, PLACES, PRICING, SUMMARY, TAGLINE, TRY, VIEWS as VIEW_COPY } from "@/lib/content";
import { faqPage, graph, pageMetadata, softwareApplication } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
import { Emblem } from "@/components/emblem";
import { Wordmark } from "@/components/wordmark";
import { ScreenDeck, type DeckItem } from "@/components/screen-deck";
import { TodayScreen } from "@/components/screens/today";
import { TimelineScreen } from "@/components/screens/timeline";
import { FlowScreen } from "@/components/screens/flow";
import { FLOW_LINE, Icon } from "@/components/screens/parts";
import { SessionFlow } from "@/components/session-flow";
import { DeparturesBoard } from "@/components/departures-board";
import { DayStrip } from "@/components/day-strip";
import { CommandPalette } from "@/components/command-palette";
import { CountryPicker, PlanPrice } from "@/components/plan-price";

export const metadata = pageMetadata("/");

// Only what the price needs reaches the browser.
const markets: Market[] = Object.entries(prices.markets)
  .map(([code, { name, currency, locale, amount }]) => ({ code, name, currency, locale, amount }))
  .sort((a, b) => a.name.localeCompare(b.name));

// The screens render here, on the server; the deck only moves them.
const SCREENS = { Today: <TodayScreen />, Timeline: <TimelineScreen />, Flow: <FlowScreen /> };
const VIEWS: DeckItem[] = VIEW_COPY.map((view) => ({ ...view, screen: SCREENS[view.tab] }));

// Beside the text, the screens take the column's width. In a short window they give up to 120 px of it, so the
// header, the padding and the tabs and caption (372 px together) fit around a 990 × 666 deck; narrower still,
// the caption goes below the fold. They keep to the column's right edge, under the menu.
const DECK_WIDTH = "lg:justify-self-end lg:w-[min(100%,max(100%_-_120px,calc((100svh_-_372px)*1.4865)))]";

/** A section's heading: a line in ink and one in grey, like the pricing's, and the paragraph under them. */
function Heading({ title, subtitle, intro }: { title: string; subtitle: string; intro?: string }) {
  return (
    <>
      <h2 className="max-w-[24em] text-[clamp(30px,3.9vw,46px)] leading-[1.15] font-light tracking-[-0.01em] text-balance text-ink">
        {title}{" "}
        <span className="block text-mut">{subtitle}</span>
      </h2>
      {intro && <p className="mt-6 max-w-[640px] text-[16px] leading-[1.6] text-balance text-text sm:mt-8 sm:text-[18px]">{intro}</p>}
    </>
  );
}

export default function Home() {
  return (
    <>
      <JsonLd data={graph(softwareApplication(), faqPage(FAQ))} />
      <header className="mx-auto flex h-[76px] max-w-[1440px] items-center justify-between px-5 sm:px-8">
        <Link href="/" aria-label="PacedMind" className="rounded-[7px]"><Emblem size={30} /></Link>
        <nav className="flex items-center gap-[30px] text-[16px] text-mut">
          <a href="#agents" className="hover:text-ink max-sm:hidden">Agents</a>
          <a href="#pricing" className="hover:text-ink">Pricing</a>
          <a href={SITE.docs} className="hover:text-ink">Docs</a>
          <a href={SITE.app} className="rounded-[10px] border border-line px-4 py-2 font-medium text-ink hover:border-mut" {...signInEvent("header")}>
            Sign in
          </a>
        </nav>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 sm:px-8">
        {/*
          The first view: the promise on the left and the app on the right, centered on the same line, with the tabs
          and the caption under the screens. The screens end where the menu does. Narrower windows stack them.
        */}
        <section className="grid pt-[clamp(40px,8vh,88px)] lg:min-h-[calc(100svh-76px)] lg:grid-cols-[380px_minmax(0,1fr)] lg:content-center lg:items-center lg:gap-x-16 lg:py-12 xl:grid-cols-[440px_minmax(0,1fr)] xl:gap-x-24">
          <div className="mb-16 lg:mb-0">
            <h1><Wordmark id="hero-wordmark" unfold className="w-full max-w-[560px] text-ink lg:max-w-[380px] xl:max-w-[440px]" /></h1>
            <p className="mt-8 text-[clamp(32px,4vw,46px)] leading-[1.08] font-light tracking-[-0.01em] text-ink sm:mt-10">
              {TAGLINE}
            </p>
            <p className="mt-5 max-w-[520px] text-[18px] leading-[1.55] text-pretty text-mut">{SUMMARY}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a className="download" data-os="windows" href={SITE.downloads.windows} {...downloadEvent("windows", "hero")}>Download for Windows</a>
              <a className="download" data-os="mac" href={SITE.downloads.mac} {...downloadEvent("mac", "hero")}>Download for macOS</a>
            </div>
            <p className="mt-4 text-[15px] text-mut">{DOWNLOAD_NOTE}</p>
          </div>
          <ScreenDeck items={VIEWS} className={{ stage: `min-w-0 ${DECK_WIDTH}`, controls: `lg:col-start-2 ${DECK_WIDTH}` }} />
        </section>

        {/*
          Between the hero and the pricing, one day three ways: your day beside the agents' (the day strip), where each
          session runs (the board) and how the next one starts (the flow). Their widgets share the day's tasks and times.
        */}
        <section id="day" className="mt-24 scroll-mt-8 sm:mt-[150px]">
          <Heading title={DAY.title} subtitle={DAY.subtitle} intro={DAY.intro} />
          <DayStrip className="mt-12 sm:mt-16" />
        </section>

        {/* The day's sessions on a board, then the places they run in, and a place kept for the agents still to come. */}
        <section id="agents" className="mt-24 scroll-mt-8 sm:mt-[150px]">
          <Heading title={PLACES.title} subtitle={PLACES.subtitle} intro={PLACES.intro} />
          <DeparturesBoard className="mt-12 sm:mt-16" />
          <ul className="mt-16 grid gap-x-14 gap-y-10 border-t border-line pt-12 sm:mt-20 md:grid-cols-3 md:pt-14">
            {PLACES.items.map(({ icon, name, body }) => (
              <li key={name}>
                <Icon name={icon} size={22} strokeWidth={1.6} className="text-mut" />
                <p className="mt-4 text-[17px] text-ink sm:text-[18px]">{name}</p>
                <p className="mt-1.5 text-[16px] leading-[1.6] text-mut">{body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-10 max-w-[720px] text-[16px] leading-[1.6] text-text">{PLACES.note}</p>
          <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-4 border-t border-line pt-10">
            <div aria-hidden="true" className="flex items-center gap-2 text-[15px]">
              {["Claude Code", "Codex"].map((agent) => (
                <span key={agent} className="flex h-9 items-center gap-2 rounded-[9px] border border-line px-3 text-ink">
                  <Icon name="terminal" size={15} className="text-mut" />{agent}
                </span>
              ))}
              <span className="flex h-9 w-12 items-center justify-center rounded-[9px] border border-dashed border-mut/60 text-mut">
                <Icon name="plus" size={15} />
              </span>
            </div>
            <p className="text-[16px] text-text sm:text-[18px]">{PLACES.harnesses}</p>
          </div>
        </section>

        {/* A project's flow playing through the day, then the four ways the next session starts, drawn as the flow draws them. */}
        <section id="flow" className="mt-24 scroll-mt-8 sm:mt-[150px]">
          <Heading title={FLOW.title} subtitle={FLOW.subtitle} intro={FLOW.intro} />
          <SessionFlow className="mt-12 sm:mt-16" />
          <ul className="mt-16 grid gap-x-14 gap-y-10 border-t border-line pt-12 sm:mt-20 sm:grid-cols-2 md:pt-14 xl:grid-cols-4">
            {FLOW.modes.map(({ mode, name, body }) => (
              <li key={name}>
                <svg width="34" height="22" viewBox="0 0 34 22" aria-hidden="true" className="text-mut">
                  <path d="M 1.5 11 L 32.5 11" stroke="currentColor" strokeWidth={FLOW_LINE[mode].width * 1.3}
                    strokeDasharray={FLOW_LINE[mode].dash} strokeLinecap="round" />
                </svg>
                <p className="mt-4 text-[17px] text-ink sm:text-[18px]">{name}</p>
                <p className="mt-1.5 text-[16px] leading-[1.6] text-mut">{body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-10 max-w-[720px] text-[16px] leading-[1.6] text-text">{FLOW.note}</p>
        </section>

        <section id="try" className="mt-24 scroll-mt-8 sm:mt-[150px]">
          <Heading title={TRY.title} subtitle={TRY.subtitle} />
          <CommandPalette className="mt-12 sm:mt-16" />
        </section>

        <section id="pricing" className="mt-24 scroll-mt-8 sm:mt-[150px]">
          <h2 className="max-w-[20em] text-[clamp(30px,3.9vw,46px)] leading-[1.15] font-light tracking-[-0.01em] text-ink">
            {PRICING.title}{" "}
            <span className="block text-mut">{PRICING.subtitle}</span>
          </h2>
          <div className="mt-6 flex flex-wrap items-baseline gap-x-8 gap-y-3 sm:mt-8">
            <p className="text-[16px] text-text sm:text-[18px]">{PRICING.plans}</p>
            <CountryPicker markets={markets} fallback={prices.fallback} />
          </div>
          <div className="mt-10 grid border-t border-line sm:mt-12 md:grid-cols-2">
            <div className="pb-12 pt-10 md:pr-14">
              <h3 className="text-[22px] font-medium text-ink">One device</h3>
              <p className="mt-6 text-[46px] leading-none font-light text-ink">Free</p>
              <ul className="mt-8 space-y-3 text-[16px] text-text">
                {ONE_DEVICE.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <a className="download for-windows mt-10" href={SITE.downloads.windows} {...downloadEvent("windows", "pricing")}>Download for Windows</a>
              <a className="download for-mac mt-10" href={SITE.downloads.mac} {...downloadEvent("mac", "pricing")}>Download for macOS</a>
            </div>
            <div className="border-t border-line pb-12 pt-10 md:border-l md:border-t-0 md:pl-14">
              <h3 className="text-[22px] font-medium text-ink">Cloud</h3>
              <div className="mt-6"><PlanPrice markets={markets} fallback={prices.fallback} /></div>
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

      <footer className="mx-auto mt-24 max-w-[1440px] px-5 sm:mt-32 sm:px-8">
        <div className="flex items-center justify-between border-t border-line py-8 text-[15px] text-mut">
          <span className="flex items-center gap-3 text-text"><Emblem size={20} />PacedMind</span>
          <div className="flex gap-6">
            <a href={SITE.docs} className="hover:text-ink">Docs</a>
            <a href={SITE.app} className="hover:text-ink" {...signInEvent("footer")}>Sign in</a>
            <span>© 2026</span>
          </div>
        </div>
      </footer>
    </>
  );
}
