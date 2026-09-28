// Makes Stripe's prices for PacedMind Cloud match site/prices.json: one product, and for every country a monthly price
// and a yearly one (prices.json's yearlyMonths times the monthly), found by their lookup keys (cloud_monthly_PL,
// cloud_yearly_PL), which the billing-checkout function asks for. Prices include tax, like Spotify's.
//
//   npm run stripe:prices -- --keys ~/.config/pacedmind/stripe-sandbox.env            shows what it would change
//   npm run stripe:prices -- --keys ~/.config/pacedmind/stripe-sandbox.env --write    changes it
//
// The key is STRIPE_SECRET_KEY in the env file (the one scripts/stripe-setup.mjs uses), or in the environment.
// A live key (sk_live_, rk_live_) also needs --live. A price in Stripe can't change its amount: a new one takes over
// the lookup key (transfer_lookup_key) and the old one is archived. Subscriptions keep the price they were bought at.
// The product is taxed as software as a service for personal use (TAX_CODE), as Cloud is sold to people, like a music
// subscription; business customers give their VAT ID at checkout.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "site", "prices.json"), "utf8"));
const args = process.argv.slice(2);
const write = args.includes("--write");
const envAt = args.indexOf("--keys");
const envFile = envAt >= 0 ? args[envAt + 1]?.replace(/^~(?=\/)/, os.homedir()) : undefined;
const fromFile = envFile && fs.existsSync(envFile)
  ? /^STRIPE_SECRET_KEY=(.*)$/m.exec(fs.readFileSync(envFile, "utf8"))?.[1]?.trim()
  : undefined;
const key = fromFile ?? process.env.STRIPE_SECRET_KEY ?? "";
const PRODUCT = "pacedmind_cloud";
// Stripe Tax: "Software as a service (SaaS) - personal use".
const TAX_CODE = "txcd_10103000";
// Currencies Stripe counts in whole units; every other one here is in hundredths.
const ZERO_DECIMAL = new Set(["JPY"]);

if (!/^(sk|rk)_(test|live)_\w+$/.test(key)) {
  console.error("Name the env file with the Stripe account's secret key (--keys <file>, STRIPE_SECRET_KEY=sk_test_… for the sandbox).");
  process.exit(1);
}
if (/_live_/.test(key) && !args.includes("--live")) {
  console.error("That's a live key: add --live to change the prices people pay.");
  process.exit(1);
}
if (!Number.isInteger(data.yearlyMonths) || data.yearlyMonths < 1) throw new Error("prices.json needs yearlyMonths.");

async function stripe(method, url, params) {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const res = await fetch(`https://api.stripe.com/v1/${url}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body,
  });
  const json = await res.json();
  if (!res.ok) {
    const error = new Error(`${method} ${url}: ${json.error?.message ?? res.status}`);
    error.status = res.status;
    throw error;
  }
  return json;
}

/** What each lookup key should be: currency (lowercase), amount in the currency's smallest unit, interval. */
function wanted() {
  const out = new Map();
  for (const [code, market] of Object.entries(data.markets)) {
    if (!(market.amount > 0)) continue;
    const monthly = ZERO_DECIMAL.has(market.currency) ? Math.round(market.amount) : Math.round(market.amount * 100);
    const currency = market.currency.toLowerCase();
    out.set(`cloud_monthly_${code}`, { currency, amount: monthly, interval: "month", name: `${market.name}, monthly` });
    out.set(`cloud_yearly_${code}`, { currency, amount: monthly * data.yearlyMonths, interval: "year", name: `${market.name}, yearly` });
  }
  return out;
}

const want = wanted();
let product = null;
try {
  product = await stripe("GET", `products/${PRODUCT}`);
} catch (error) {
  if (error.status !== 404) throw error;
}
if (!product) {
  console.log(`+ product ${PRODUCT} (PacedMind Cloud, tax code ${TAX_CODE})`);
  if (write) product = await stripe("POST", "products", { id: PRODUCT, name: "PacedMind Cloud", tax_code: TAX_CODE });
} else if ((typeof product.tax_code === "string" ? product.tax_code : product.tax_code?.id) !== TAX_CODE) {
  console.log(`~ product ${PRODUCT}: tax code ${TAX_CODE}`);
  if (write) await stripe("POST", `products/${PRODUCT}`, { tax_code: TAX_CODE });
}

// Stripe takes at most 10 lookup keys per request.
const have = new Map();
const keys = [...want.keys()];
for (let i = 0; i < keys.length; i += 10) {
  const query = new URLSearchParams({ active: "true", limit: "100" });
  for (const k of keys.slice(i, i + 10)) query.append("lookup_keys[]", k);
  const { data: prices } = await stripe("GET", `prices?${query}`);
  for (const p of prices) have.set(p.lookup_key, p);
}

let changes = 0;
for (const [lookup, w] of want) {
  const p = have.get(lookup);
  const same =
    p && p.currency === w.currency && p.unit_amount === w.amount && p.recurring?.interval === w.interval && p.tax_behavior === "inclusive";
  if (same) continue;
  changes++;
  const shown = `${w.currency.toUpperCase()} ${ZERO_DECIMAL.has(w.currency.toUpperCase()) ? w.amount : (w.amount / 100).toFixed(2)} / ${w.interval}`;
  console.log(`${p ? "~" : "+"} ${lookup}  ${shown}${p ? `  (was ${p.currency.toUpperCase()} ${p.unit_amount} / ${p.recurring?.interval})` : ""}`);
  if (!write) continue;
  await stripe("POST", "prices", {
    product: PRODUCT,
    currency: w.currency,
    unit_amount: String(w.amount),
    "recurring[interval]": w.interval,
    tax_behavior: "inclusive",
    lookup_key: lookup,
    transfer_lookup_key: "true",
    nickname: w.name,
  });
  if (p) await stripe("POST", `prices/${p.id}`, { active: "false" });
}

if (!changes) console.log("Stripe's prices match prices.json.");
else if (!write) console.log(`\n${changes} price(s) to change. Run "npm run stripe:prices -- --write" to change them.`);
else console.log(`\nChanged ${changes} price(s).`);
