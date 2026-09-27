import type { Metadata } from "next";
import Link from "next/link";
import { Emblem } from "@/components/emblem";

// Exported as out/404.html, which the server returns with a 404 status (deploy/). Next marks it
// noindex; it has no canonical URL, because it isn't a page of its own.
export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <>
      <header className="mx-auto flex h-[76px] max-w-[1120px] items-center px-5 sm:px-8">
        <Link href="/" aria-label="PacedMind" className="rounded-[7px]"><Emblem size={30} /></Link>
      </header>
      <main className="mx-auto max-w-[1120px] px-5 pb-24 pt-[clamp(56px,12vh,112px)] sm:px-8">
        <h1 className="text-[clamp(34px,4.6vw,58px)] leading-[1.05] font-light tracking-[-0.01em] text-ink">Page not found.</h1>
        <p className="mt-[22px] max-w-[560px] text-[18px] leading-[1.55] text-mut sm:text-[20px]">
          The address may be mistyped, or the page has moved.
        </p>
        <Link href="/" className="download mt-[38px]">Go to the home page</Link>
      </main>
    </>
  );
}
