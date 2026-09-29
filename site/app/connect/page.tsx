import Link from "next/link";
import { Connect, ConnectAnchors } from "@/components/connect";
import { Emblem } from "@/components/emblem";
import { CONNECT } from "@/lib/content";
import { pageMetadata } from "@/lib/seo";
import { SITE, signInEvent } from "@/lib/site";

export const metadata = pageMetadata("/connect", { title: "Connect your agent", description: CONNECT.description });

/**
 * The home page's Connect section on a page of its own, a short link to hand out: pacedmind.com/connect, or
 * /connect#connect-codex for one agent.
 */
export default function ConnectPage() {
  // A link to one agent picks it and leaves the page at its top: the anchors are the page's first lines.
  return (
    <div className="relative">
      <ConnectAnchors />
      <header className="mx-auto flex h-[76px] max-w-[1120px] items-center justify-between px-5 sm:px-8">
        <Link href="/" aria-label="PacedMind" className="rounded-[7px]"><Emblem size={30} /></Link>
        <nav className="flex items-center gap-[18px] text-[16px] text-mut sm:gap-[30px]">
          <a href={SITE.docs} className="hover:text-ink">Docs</a>
          <a href={SITE.app} className="rounded-[10px] border border-line px-4 py-2 font-medium whitespace-nowrap text-ink hover:border-mut" {...signInEvent("header")}>
            Sign in
          </a>
        </nav>
      </header>
      <main className="mx-auto max-w-[1120px] px-5 pb-24 pt-10 sm:px-8 sm:pt-16">
        <h1 className="max-w-[24em] text-[clamp(32px,4.2vw,48px)] leading-[1.1] font-light tracking-[-0.01em] text-balance text-ink">
          {CONNECT.title}{" "}
          <span className="block text-mut">{CONNECT.subtitle}</span>
        </h1>
        <p className="mt-6 max-w-[640px] text-[16px] leading-[1.6] text-balance text-text sm:mt-8 sm:text-[18px]">{CONNECT.intro}</p>
        <Connect className="mt-12 sm:mt-16" />
        <nav className="mt-16 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-6 text-[15px] text-mut">
          <Link href="/" className="hover:text-ink">Home</Link>
          <a href={`${SITE.docs}/mcp`} className="hover:text-ink">MCP server</a>
          <Link href="/#pricing" className="hover:text-ink">Pricing</Link>
        </nav>
      </main>
    </div>
  );
}
