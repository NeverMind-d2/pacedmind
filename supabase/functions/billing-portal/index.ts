// Managing the subscription on Stripe's own page: the card, invoices and cancelling (at the end of the period).
//
// POST { return: "web" | "desktop" } with the user's own token. Answers { url }.
import { caller, failure, HttpError, json, readBody, returnUrls, stripe } from "../_shared/billing.ts";

Deno.serve(async (req) => {
  try {
    const body = await readBody(req);
    const { row } = await caller(req);
    if (!row.customer_id) throw new HttpError(409, "There's no subscription to manage yet.");
    const session = await stripe().billingPortal.sessions.create({
      customer: row.customer_id,
      return_url: returnUrls(body.return === "web" ? "web" : "desktop").back,
    });
    return json({ url: session.url });
  } catch (e) {
    return failure(e);
  }
});
