import type { Metadata } from "next";
import Link from "next/link";
import { Emblem } from "@/components/emblem";

// Where the payment and billing pages send someone from the desktop app back to (supabase/functions/_shared/
// billing.ts): the desktop app's own server only answers its window, so the browser lands here instead. Not a page
// for search engines.
export const metadata: Metadata = { title: "Back to PacedMind", robots: { index: false, follow: false } };

export default function Subscribed() {
  return (
    <>
      <header className="mx-auto flex h-[76px] max-w-[1120px] items-center px-5 sm:px-8">
        <Link href="/" aria-label="PacedMind" className="rounded-[7px]"><Emblem size={30} /></Link>
      </header>
      <main className="mx-auto max-w-[1120px] px-5 pb-24 pt-[clamp(56px,12vh,112px)] sm:px-8">
        <h1 className="text-[clamp(34px,4.6vw,58px)] leading-[1.05] font-light tracking-[-0.01em] text-ink">Go back to PacedMind.</h1>
        <p className="mt-[22px] max-w-[560px] text-[18px] leading-[1.55] text-mut sm:text-[20px]">
          You can close this tab. PacedMind shows any change to your plan within a few seconds.
        </p>
      </main>
    </>
  );
}
