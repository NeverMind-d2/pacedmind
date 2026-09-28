// Subscribing to Cloud, or switching a subscription between monthly and yearly.
//
// POST { country: "PL", period: "month" | "year", return: "web" | "desktop" } with the user's own token.
// Answers { url } (Stripe's Checkout page) or { switched: true }. The price is the country's own (its lookup
// key), never one the caller names, and switching keeps the country the subscription was bought in, so nobody
// moves to a cheaper country's price. The Customer Portal offers no switching for the same reason.
import {
  caller,
  failure,
  HttpError,
  json,
  type Period,
  priceFor,
  readBody,
  returnUrls,
  RUNNING,
  stripe,
} from "../_shared/billing.ts";

Deno.serve(async (req) => {
  try {
    const body = await readBody(req);
    const { row, email } = await caller(req);
    const period: Period = body.period === "year" ? "year" : "month";
    const surface = body.return === "web" ? "web" : "desktop";
    const country = typeof body.country === "string" && /^[A-Z]{2}$/.test(body.country) ? body.country : "US";
    if (row.comped) throw new HttpError(409, "Your account has Cloud without a subscription.");

    if (row.subscription_id && RUNNING.has(row.status)) {
      if (row.period === period) throw new HttpError(409, `You already pay ${period === "year" ? "yearly" : "monthly"}.`);
      const sub = await stripe().subscriptions.retrieve(row.subscription_id);
      const item = sub.items.data[0];
      if (!item) throw new HttpError(409, "That subscription has no price to switch.");
      const price = await priceFor(row.market ?? country, period);
      // Billed at once: to yearly, the year less what's left of the month is charged now; to monthly, what's left of
      // the year becomes credit for the next payments. (Left pending, the difference would wait for the next renewal,
      // a year away.)
      await stripe().subscriptions.update(sub.id, {
        items: [{ id: item.id, price: price.id }],
        proration_behavior: "always_invoice",
      });
      return json({ switched: true });
    }

    // A first payment that never went through (a card that needed a check, say) ends here, so the new
    // Checkout can't leave two subscriptions.
    if (row.subscription_id && row.status === "incomplete") {
      await stripe().subscriptions.cancel(row.subscription_id).catch(() => {});
    }

    const price = await priceFor(country, period);
    const trialEnd = Math.floor(new Date(row.trial_ends_at).getTime() / 1000);
    // Subscribing during the trial keeps its remaining days (Stripe needs at least two of them).
    const keepTrial = trialEnd - Date.now() / 1000 > 48 * 3600;
    const urls = returnUrls(surface);
    const session = await stripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: price.id, quantity: 1 }],
      client_reference_id: row.user_id,
      ...(row.customer_id
        ? { customer: row.customer_id, customer_update: { address: "auto", name: "auto" } }
        : email
          ? { customer_email: email }
          : {}),
      subscription_data: {
        metadata: { user_id: row.user_id },
        ...(keepTrial ? { trial_end: trialEnd } : {}),
      },
      automatic_tax: { enabled: Deno.env.get("STRIPE_AUTOMATIC_TAX") !== "off" },
      // A business gives its VAT ID and, in the EU, pays no VAT here (reverse charge).
      tax_id_collection: { enabled: true },
      billing_address_collection: "required",
      allow_promotion_codes: true,
      success_url: urls.done,
      cancel_url: urls.back,
    });
    if (!session.url) throw new Error("Stripe made a Checkout session without a page.");
    return json({ url: session.url });
  } catch (e) {
    return failure(e);
  }
});
