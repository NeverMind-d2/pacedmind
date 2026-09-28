// Sets up a Stripe account for PacedMind Cloud's billing functions (supabase/functions), through Stripe's API:
//
// - the webhook endpoint that tells the stripe-webhook function about subscriptions, and its signing secret;
// - the Customer Portal's settings: the card, invoices and cancelling at the end of the period, but no switching plans
//   (the app switches between monthly and yearly at the subscription's own country's price);
// - whether Stripe Tax can work out the tax at checkout.
//
//   node scripts/stripe-setup.mjs --keys ~/.config/pacedmind/stripe-sandbox.env            shows what it would do
//   node scripts/stripe-setup.mjs --keys ~/.config/pacedmind/stripe-sandbox.env --write    does it
//
// The env file holds STRIPE_SECRET_KEY, and this adds what the functions need next to it (STRIPE_WEBHOOK_SECRET,
// STRIPE_PORTAL_CONFIGURATION, and STRIPE_AUTOMATIC_TAX=off for a sandbox without tax settings), so the file can go to
// Supabase as it is: npx supabase secrets set --env-file <file>. Secrets are written to the file, never printed. A
// live key (sk_live_, rk_live_) also needs --live, and then tax must be set up first. --url changes the webhook's
// address (by default PacedMind Cloud's project), and --no-webhook leaves it out: a sandbox used against a local stack,
// whose functions Stripe can't reach, and whose production function checks the live account's signing secret.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const write = args.includes("--write");
const envFile = option("--keys")?.replace(/^~(?=\/)/, os.homedir());
const WEBHOOK_URL = option("--url") ?? "https://pyoynjoyhpolijlvoalu.supabase.co/functions/v1/stripe-webhook";
const EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
  "customer.subscription.paused", "customer.subscription.resumed",
];

if (!envFile || !fs.existsSync(envFile)) {
  console.error("Name the env file that holds STRIPE_SECRET_KEY: --keys <file>.");
  process.exit(1);
}

/** The file's variables, in order. */
function readEnv() {
  const out = new Map();
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

function setEnv(name, value) {
  const env = readEnv();
  env.set(name, value);
  fs.writeFileSync(envFile, [...env].map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  fs.chmodSync(envFile, 0o600);
}

const env = readEnv();
const key = env.get("STRIPE_SECRET_KEY") ?? "";
if (!/^(sk|rk)_(test|live)_\w+$/.test(key)) {
  console.error(`${path.basename(envFile)} has no STRIPE_SECRET_KEY (sk_test_… for the sandbox).`);
  process.exit(1);
}
const live = /_live_/.test(key);
if (live && !args.includes("--live")) {
  console.error("That's a live key: add --live to set up the account people pay through.");
  process.exit(1);
}

async function stripe(method, url, params) {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const res = await fetch(`https://api.stripe.com/v1/${url}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${url}: ${json.error?.message ?? res.status}`);
  return json;
}

console.log(`Stripe ${live ? "LIVE" : "sandbox"} account, env file ${envFile}\n`);

// 1. The webhook endpoint. Stripe shows its signing secret only when it makes it.
const endpoints = args.includes("--no-webhook") ? null : (await stripe("GET", "webhook_endpoints?limit=100")).data;
const endpoint = endpoints?.find((e) => e.url === WEBHOOK_URL);
if (!endpoints) {
  console.log("  (no webhook endpoint: --no-webhook)");
} else if (!endpoint) {
  console.log(`+ webhook endpoint ${WEBHOOK_URL}`);
  if (write) {
    const params = new URLSearchParams({ url: WEBHOOK_URL, description: "PacedMind Cloud billing (supabase/functions/stripe-webhook)" });
    for (const e of EVENTS) params.append("enabled_events[]", e);
    const made = await stripe("POST", "webhook_endpoints", params);
    setEnv("STRIPE_WEBHOOK_SECRET", made.secret);
    console.log("  its signing secret is in the env file as STRIPE_WEBHOOK_SECRET");
  }
} else {
  const missing = EVENTS.filter((e) => !endpoint.enabled_events.includes(e) && !endpoint.enabled_events.includes("*"));
  if (missing.length) {
    console.log(`~ webhook endpoint: add ${missing.join(", ")}`);
    if (write) {
      const params = new URLSearchParams();
      for (const e of [...new Set([...endpoint.enabled_events, ...missing])]) params.append("enabled_events[]", e);
      await stripe("POST", `webhook_endpoints/${endpoint.id}`, params);
    }
  } else console.log(`= webhook endpoint ${endpoint.id}`);
  if (!env.get("STRIPE_WEBHOOK_SECRET")) {
    console.log("  Its signing secret isn't in the env file, and Stripe won't show it again: roll it in the dashboard"
      + " (Developers → Webhooks) and add it as STRIPE_WEBHOOK_SECRET, or delete the endpoint and run this again.");
  }
}

// 2. The Customer Portal's settings, marked as PacedMind's.
const configs = (await stripe("GET", "billing_portal/configurations?limit=100")).data;
const config = configs.find((c) => c.metadata?.pacedmind === "cloud" && c.active);
if (!config) {
  console.log("+ customer portal settings: card, invoices, cancelling at the end of the period, no switching plans");
  if (write) {
    const made = await stripe("POST", "billing_portal/configurations", {
      "business_profile[headline]": "PacedMind Cloud",
      "features[customer_update][enabled]": "true",
      "features[customer_update][allowed_updates][0]": "email",
      "features[customer_update][allowed_updates][1]": "address",
      "features[customer_update][allowed_updates][2]": "tax_id",
      "features[invoice_history][enabled]": "true",
      "features[payment_method_update][enabled]": "true",
      "features[subscription_cancel][enabled]": "true",
      "features[subscription_cancel][mode]": "at_period_end",
      "features[subscription_cancel][cancellation_reason][enabled]": "true",
      "features[subscription_cancel][cancellation_reason][options][0]": "too_expensive",
      "features[subscription_cancel][cancellation_reason][options][1]": "missing_features",
      "features[subscription_cancel][cancellation_reason][options][2]": "switched_service",
      "features[subscription_cancel][cancellation_reason][options][3]": "unused",
      "features[subscription_cancel][cancellation_reason][options][4]": "other",
      "features[subscription_update][enabled]": "false",
      "metadata[pacedmind]": "cloud",
    });
    setEnv("STRIPE_PORTAL_CONFIGURATION", made.id);
    console.log(`  ${made.id}, in the env file as STRIPE_PORTAL_CONFIGURATION`);
  }
} else {
  console.log(`= customer portal settings ${config.id}`);
  if (write && env.get("STRIPE_PORTAL_CONFIGURATION") !== config.id) setEnv("STRIPE_PORTAL_CONFIGURATION", config.id);
}

// 3. Tax: automatic tax at checkout needs the account's tax settings (its address, and registrations to collect any).
const tax = await stripe("GET", "tax/settings");
if (tax.status === "active") {
  console.log("= Stripe Tax is set up: checkout works out the tax");
  if (write && env.get("STRIPE_AUTOMATIC_TAX") === "off") setEnv("STRIPE_AUTOMATIC_TAX", "on");
} else if (live) {
  console.error("\nStripe Tax isn't set up (Settings → Tax: the business address and where you're registered). Set it up before taking payments.");
  process.exitCode = 1;
} else {
  console.log("~ Stripe Tax isn't set up in this sandbox: checkout goes without tax (STRIPE_AUTOMATIC_TAX=off)");
  if (write) setEnv("STRIPE_AUTOMATIC_TAX", "off");
}

if (!write) console.log('\nRun with --write to do it.');
else console.log(`\nNext: npx supabase secrets set --env-file ${envFile} --project-ref pyoynjoyhpolijlvoalu`);
