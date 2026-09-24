"use client";

import { useState, useSyncExternalStore } from "react";
import { formatPrice, guessCountry, type Market } from "@/lib/markets";

const subscribe = () => () => {};
let guessed: string | undefined | null = null;
const getGuess = () => (guessed === null ? (guessed = guessCountry()) : guessed);

/** The Cloud price in the visitor's country, with a picker for any other. */
export function CloudPrice({ markets, fallback }: { markets: Market[]; fallback: string }) {
  // The static HTML shows the fallback country; the browser switches to its own before anyone
  // scrolls down this far.
  const guess = useSyncExternalStore(subscribe, getGuess, () => undefined);
  const [chosen, setChosen] = useState<string>();
  const find = (code?: string) => markets.find((m) => m.code === code);
  const market = find(chosen) ?? find(guess) ?? find(fallback)!;
  return (
    <div>
      <p className="flex items-baseline gap-2 text-ink">
        <span className="text-[40px] leading-none font-light tracking-[-0.02em] tabular-nums">{formatPrice(market)}</span>
        <span className="text-[15px] text-mut">/ month</span>
      </p>
      <label className="relative mt-3 inline-flex items-center gap-1.5 text-[14px] text-mut">
        Price for
        <select value={market.code} onChange={(e) => setChosen(e.target.value)}
          className="country-select cursor-pointer appearance-none rounded-none border-0 border-b border-line bg-transparent py-0.5 pr-5 text-text">
          {markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
        </select>
        <svg aria-hidden="true" viewBox="0 0 12 12" className="pointer-events-none absolute right-0.5 h-3 w-3 text-mut">
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </label>
    </div>
  );
}
