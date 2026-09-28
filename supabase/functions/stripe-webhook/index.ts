// Stripe tells PacedMind about subscriptions here, and this keeps each account's billing row as Stripe has it.
//
// Only requests signed with STRIPE_WEBHOOK_SECRET count. Each event only says which subscription changed: the
// subscription itself is read back from Stripe, so events that come twice or out of order still leave the row as
// the subscription is now. This is the only code with the service role, and it writes only billing.
import { parseLookupKey, RUNNING, serviceDb, Stripe, stripe } from "../_shared/billing.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const crypto = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET isn't set");
    return new Response("Not set up", { status: 500 });
  }
  let event: Stripe.Event;
  try {
    const body = await req.text();
    event = await stripe().webhooks.constructEventAsync(body, req.headers.get("Stripe-Signature") ?? "", secret, undefined, crypto);
  } catch {
    return new Response("Bad signature", { status: 400 });
  }

  let subscriptionId: string | null = null;
  let userHint: string | null = null;
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription") break;
      subscriptionId = typeof session.subscription === "string" ? session.subscription : (session.subscription?.id ?? null);
      userHint = session.client_reference_id;
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      subscriptionId = event.data.object.id;
      break;
  }
  if (!subscriptionId) return new Response("Ignored");

  try {
    await save(await stripe().subscriptions.retrieve(subscriptionId), userHint);
    return new Response("Saved");
  } catch (e) {
    // Stripe tries again later.
    console.error(e);
    return new Response("Couldn't save", { status: 500 });
  }
});

async function save(sub: Stripe.Subscription, userHint: string | null): Promise<void> {
  const db = serviceDb();
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  let userId = [sub.metadata?.user_id, userHint].find((id): id is string => typeof id === "string" && UUID.test(id)) ?? null;
  if (!userId) {
    const { data } = await db.from("billing").select("user_id").eq("customer_id", customerId).maybeSingle();
    userId = data?.user_id ?? null;
  }
  if (!userId) {
    console.warn(`Subscription ${sub.id} belongs to no account`);
    return;
  }

  const { data: current, error: readError } = await db
    .from("billing")
    .select("subscription_id, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) throw readError;
  // An old subscription ending doesn't touch the one the account has now.
  if (current?.subscription_id && current.subscription_id !== sub.id && RUNNING.has(current.status) && !RUNNING.has(sub.status)) {
    return;
  }

  const item = sub.items.data[0];
  const price = item?.price;
  const bought = parseLookupKey(price?.lookup_key);
  // Newer API versions keep the period on the item; older ones on the subscription.
  const periodEnd = item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  const row = {
    customer_id: customerId,
    subscription_id: sub.id,
    status: sub.status,
    market: bought?.market ?? null,
    period: bought?.period ?? (price?.recurring?.interval === "year" ? "year" : "month"),
    currency: price?.currency ?? null,
    amount: price?.unit_amount ?? null,
    period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    // Cancelled in the portal: it runs until the end of the period, and then ends.
    cancel_at_period_end: sub.cancel_at_period_end || sub.cancel_at !== null,
    updated_at: new Date().toISOString(),
  };

  if (current) {
    const { error } = await db.from("billing").update(row).eq("user_id", userId);
    if (error) throw error;
  } else {
    // Every account gets its row when it's made; this only covers one that somehow has none.
    const { error } = await db.from("billing").insert({ user_id: userId, trial_ends_at: new Date().toISOString(), ...row });
    if (error) throw error;
  }
}
