"use client";

import { useSyncExternalStore } from "react";
import { formatPlanPrice, guessCountry, yearlyMarket, type Market } from "@/lib/markets";

// The country the prices are shown for, shared by the picker and every plan's price. The static HTML
// shows the fallback country; the browser switches to its own before anyone scrolls down this far.
let chosen: string | undefined;
let guessed: string | undefined | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getCountry = () => chosen ?? (guessed === null ? (guessed = guessCountry()) : guessed);
const choose = (code: string) => {
  chosen = code;
  listeners.forEach((listener) => listener());
};

function useMarket(markets: Market[], fallback: string) {
  const country = useSyncExternalStore(subscribe, getCountry, () => undefined);
  const find = (code?: string) => markets.find((m) => m.code === code);
  return find(country) ?? find(fallback)!;
}

/** Cloud's monthly price in the chosen country, and the yearly one (prices.json's yearlyMonths times it). */
export function PlanPrice({ markets, fallback, yearlyMonths }: { markets: Market[]; fallback: string; yearlyMonths: number }) {
  const market = useMarket(markets, fallback);
  return (
    <>
      <p className="flex items-baseline gap-2 text-ink">
        <span className="text-[46px] leading-none font-light tabular-nums">{formatPlanPrice(market)}</span>
        <span className="text-[16px] text-mut">/ month</span>
      </p>
      <p className="mt-3 text-[16px] text-mut">or <span className="tabular-nums">{formatPlanPrice(yearlyMarket(market, yearlyMonths))}</span> a year</p>
    </>
  );
}

/** The country every price on the page is for: the visitor's, guessed, or any other they pick. */
export function CountryPicker({ markets, fallback }: { markets: Market[]; fallback: string }) {
  const market = useMarket(markets, fallback);
  return (
    <label className="relative inline-flex items-center gap-1.5 text-[15px] text-mut">
      Prices for
      <select value={market.code} onChange={(e) => choose(e.target.value)}
        className="country-select cursor-pointer appearance-none rounded-none border-0 border-b border-line bg-transparent py-0.5 pr-5 text-text">
        {markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
      </select>
      <svg aria-hidden="true" viewBox="0 0 12 12" className="pointer-events-none absolute right-0.5 h-3 w-3 text-mut">
        <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}
