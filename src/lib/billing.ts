/*
 * PacedMind Cloud's plan, as the app shows it: the trial, the subscription, and whether Cloud has ended and the
 * account is read-only. The database decides all of it (public.cloud_plan(), the billing table and the trigger that
 * refuses writes); this only puts it into words. The prices are the site's (site/prices.json), so the app, the site
 * and Stripe's prices (scripts/stripe-prices.mjs) say the same.
 */
import prices from "../../site/prices.json";
import { formatPlanPrice, type Market } from "../../site/lib/markets";

export type BillingPeriod = "month" | "year";

/** trial: the 7 days from sign-up; canceling: paid until the period ends, then read-only; lapsed: read-only. */
export type PlanState = "trial" | "active" | "canceling" | "past_due" | "lapsed" | "comped";

export interface Plan {
  state: PlanState;
  /** Whether billing is on at all. Until it launches, every account uses Cloud and nothing about plans shows. */
  enforced: boolean;
  /** Whether the database lets the account write. */
  writable: boolean;
  trialEndsAt: string;
  /** Whether the account has paid before, so Manage billing has something to show. */
  customer: boolean;
  market: string | null;
  period: BillingPeriod | null;
  periodEnd: string | null;
}

/** What public.cloud_plan() answers, or null (no row, or not a two-factor session). */
export function planOf(raw: unknown, now = Date.now()): Plan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const trialEndsAt = str(r.trial_ends_at);
  if (!trialEndsAt) return null;
  const status = str(r.status) ?? "none";
  const periodEnd = str(r.period_end);
  const canceling = r.cancel_at_period_end === true;
  const state: PlanState = r.comped === true ? "comped"
    : status === "past_due" ? "past_due"
    : status === "active" || status === "trialing" ? (canceling ? "canceling" : "active")
    : Date.parse(trialEndsAt) > now ? "trial"
    : "lapsed";
  return {
    state,
    enforced: r.enforced === true,
    writable: r.writable !== false,
    trialEndsAt,
    customer: r.customer === true,
    market: str(r.market),
    period: r.period === "year" ? "year" : r.period === "month" ? "month" : null,
    periodEnd,
  };
}

/** Whole days left until a time, at least 0. */
export function daysLeft(until: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(until) - now) / 86_400_000));
}

/** The countries with their own price, by name, for the "Prices for" picker. */
export const MARKETS: Market[] = Object.entries(prices.markets)
  .map(([code, m]) => ({ code, name: m.name, currency: m.currency, locale: m.locale, amount: m.amount }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const FALLBACK_MARKET = prices.fallback;

export function marketOf(code: string | null | undefined): Market {
  return MARKETS.find((m) => m.code === code) ?? MARKETS.find((m) => m.code === FALLBACK_MARKET)!;
}

/** "$12.99" a month or "$129.90" a year: yearly is prices.json's yearlyMonths times monthly, as Stripe charges it. */
export function planPrice(market: Market, period: BillingPeriod): string {
  const amount = period === "year" ? Math.round(market.amount * prices.yearlyMonths * 100) / 100 : market.amount;
  return formatPlanPrice({ ...market, amount });
}

export const YEARLY_MONTHS = prices.yearlyMonths;

export const READ_ONLY_MESSAGE =
  "PacedMind Cloud is read-only: subscribe to keep working in it, or move your data to this computer.";

/** A write the database refused because Cloud has ended for the account (SQLSTATE PT402). */
export class CloudReadOnly extends Error {
  constructor(message = READ_ONLY_MESSAGE) {
    super(message);
    this.name = "CloudReadOnly";
  }
}
