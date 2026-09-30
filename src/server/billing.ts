import "server-only";
import { cache } from "react";
import { MODE, authState, supabase } from "./supabase";
import { planOf, type BillingPeriod, type Plan } from "@/lib/billing";
import { canUsePlanner } from "@/lib/auth-access";

/*
 * The signed-in account's PacedMind Cloud plan, and the way to Stripe's pages for subscribing and managing it. Stripe
 * itself is only reached by the billing Edge Functions in Supabase (supabase/functions), which hold its key: the app
 * calls them with the account's own session, and they answer with a page to open. Nothing here decides whether the
 * account may write; the database does, and refuses with SQLSTATE PT402 once Cloud has ended (CloudReadOnly).
 */

async function fetchPlan(): Promise<Plan | null> {
  const state = await authState();
  if (!canUsePlanner(state)) return null;
  const { data, error } = await (await supabase()).rpc("cloud_plan");
  return error ? null : planOf(data);
}

/** The account's plan for this request; null without an account, before its second factor, or if it can't be read. */
export const readPlan = cache(fetchPlan);

const g = globalThis as unknown as { __pacedmindPlan?: { plan: Plan | null; at: number; user: string } };

/**
 * Whether the account in use may write, for the background loop (desktop): read at most once a minute. True without an
 * account, and when the plan can't be read (the database still decides each write).
 */
export async function cloudWritable(): Promise<boolean> {
  const state = await authState();
  if (!state || !canUsePlanner(state)) return true;
  const cached = g.__pacedmindPlan;
  if (!cached || cached.user !== state.user.id || Date.now() - cached.at > 60_000) {
    g.__pacedmindPlan = { plan: await fetchPlan(), at: Date.now(), user: state.user.id };
  }
  return g.__pacedmindPlan!.plan?.writable ?? true;
}

/** Calls a billing function as the signed-in account; its own error message when it refuses. */
async function invoke(name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await (await supabase()).functions.invoke(name, { body: { ...body, return: MODE } });
  if (error) {
    const res = (error as { context?: unknown }).context;
    if (res instanceof Response) {
      const answer = await res.json().catch(() => null);
      if (answer && typeof answer.error === "string") throw new Error(answer.error);
    }
    throw new Error("Billing can't be reached right now. Try again in a moment.");
  }
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

/**
 * Subscribing, for a country's price, monthly or yearly: Stripe's Checkout page to open. With a subscription already,
 * it switches that one between monthly and yearly instead (at the price of the country it was bought in).
 */
export async function subscribe(country: string, period: BillingPeriod): Promise<{ url: string } | { switched: true }> {
  const answer = await invoke("billing-checkout", { country, period });
  if (answer.switched === true) return { switched: true };
  if (typeof answer.url === "string" && answer.url.startsWith("https://")) return { url: answer.url };
  throw new Error("Stripe didn't answer with a page to open.");
}

/** Stripe's page for the card, invoices and cancelling. */
export async function billingPortal(): Promise<string> {
  const answer = await invoke("billing-portal", {});
  if (typeof answer.url === "string" && answer.url.startsWith("https://")) return answer.url;
  throw new Error("Stripe didn't answer with a page to open.");
}
