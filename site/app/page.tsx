import Link from "next/link";
import prices from "@/prices.json";
import { SITE } from "@/lib/site";
import type { Market } from "@/lib/markets";
import { CLOUD, DOWNLOAD_NOTE, FAQ, ONE_DEVICE, PRICING, SUMMARY, TAGLINE, VIEWS as VIEW_COPY } from "@/lib/content";
import { faqPage, graph, pageMetadata, softwareApplication } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
import { Emblem } from "@/components/emblem";
import { Wordmark } from "@/components/wordmark";
import { ScreenDeck, type DeckItem } from "@/components/screen-deck";
import { TodayScreen } from "@/components/screens/today";
import { TimelineScreen } from "@/components/screens/timeline";
import { FlowScreen } from "@/components/screens/flow";
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

export default function Home() {
  return (
    <>
      <JsonLd data={graph(softwareApplication(), faqPage(FAQ))} />
      <header className="mx-auto flex h-[76px] max-w-[1440px] items-center justify-between px-5 sm:px-8">
        <Link href="/" aria-label="PacedMind" className="rounded-[7px]"><Emblem size={30} /></Link>
        <nav className="flex gap-[30px] text-[16px] text-mut">
          <a href="#pricing" className="hover:text-ink">Pricing</a>
          <a href={SITE.docs} className="hover:text-ink">Docs</a>
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
              <a className="download" data-os="windows" href={SITE.downloads.windows}>Download for Windows</a>
              <a className="download" data-os="mac" href={SITE.downloads.mac}>Download for macOS</a>
            </div>
            <p className="mt-4 text-[15px] text-mut">{DOWNLOAD_NOTE}</p>
          </div>
          <ScreenDeck items={VIEWS} className={{ stage: `min-w-0 ${DECK_WIDTH}`, controls: `lg:col-start-2 ${DECK_WIDTH}` }} />
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
              <a className="download for-windows mt-10" href={SITE.downloads.windows}>Download for Windows</a>
              <a className="download for-mac mt-10" href={SITE.downloads.mac}>Download for macOS</a>
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
            <span>© 2026</span>
          </div>
        </div>
      </footer>
    </>
  );
}
