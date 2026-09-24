// Cloud costs the same as Spotify Premium Individual in each country. This compares prices.json
// with the regular Premium Individual price on each country's spotify.com/premium page.
//
//   npm run prices              report differences (exits with 1 when a price changed)
//   npm run prices -- --write   also save the new prices and today's date to prices.json
//
// To add a country, add it to prices.json with "amount": 0 and run with --write. "plan" names the
// one-person plan where Spotify calls it something else (India sells Premium Standard).
import fs from "node:fs";
import path from "node:path";

const file = path.join(import.meta.dirname, "..", "prices.json");
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const write = process.argv.includes("--write");

const headers = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
  "accept-language": "en",
};

/** Reads a price such as "$12.99", "26,99 zł", "€ 13,99" or "¥1,080" as a number. */
function parseAmount(text) {
  const tokens = text.match(/\d{1,3}(?:[.,   ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g) ?? [];
  const values = tokens.map((token) => {
    const decimals = token.match(/[.,](\d{1,2})$/);
    const whole = (decimals ? token.slice(0, -decimals[0].length) : token).replace(/\D/g, "");
    return Number(`${whole}.${decimals ? decimals[1] : "0"}`);
  });
  // The regular price is the largest number: "then $12.99 per month after 3 months".
  return values.length ? Math.max(...values) : NaN;
}

/** The regular Premium Individual price from the page's embedded data, without intro offers. */
async function spotifyPrice({ spotify, plan = "PREMIUM_INDIVIDUAL" }) {
  const response = await fetch(`https://www.spotify.com/${spotify}/premium/`, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const json = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  if (!json) throw new Error("page data not found");
  const texts = [];
  (function walk(value) {
    if (!value || typeof value !== "object") return;
    if (value.planId === plan) {
      // With an intro offer, the first line is "$0 for 1 month" and the second the regular price.
      const text = value.secondaryPriceDescription ?? value.primaryPriceDescription;
      if (text) texts.push(text);
    }
    Object.values(value).forEach(walk);
  })(JSON.parse(json));
  const amounts = [...new Set(texts.map(parseAmount).filter((n) => n > 0))];
  if (amounts.length !== 1) throw new Error(amounts.length ? `several prices: ${amounts.join(", ")}` : `${plan} not found`);
  return { amount: amounts[0], text: texts[0] };
}

let changed = 0;
let failed = 0;
for (const [code, market] of Object.entries(data.markets)) {
  const label = `${code} ${market.name}`.padEnd(20);
  try {
    const { amount, text } = await spotifyPrice(market);
    // A large jump is more likely a misread page than a price change, so it is never saved.
    const suspicious = market.amount > 0 && Math.abs(amount / market.amount - 1) > 0.4;
    if (amount === market.amount) {
      console.log(`${label} ${market.currency} ${amount}  unchanged`);
    } else if (suspicious) {
      failed++;
      console.log(`${label} ${market.currency} ${market.amount} -> ${amount}  check by hand ("${text}")`);
    } else {
      changed++;
      console.log(`${label} ${market.currency} ${market.amount} -> ${amount}  changed ("${text}")`);
      market.amount = amount;
    }
  } catch (error) {
    failed++;
    console.log(`${label} could not read the price: ${error.message}`);
  }
}

if (write) {
  // The date records the last full check, so it only moves when every country was read.
  if (!failed) data.checkedOn = new Date().toLocaleDateString("sv-SE");
  // One country per line, so a price change is a one-line diff.
  const { markets, ...rest } = data;
  const lines = Object.entries(markets).map(([code, market]) => `    ${JSON.stringify(code)}: ${JSON.stringify(market)}`);
  const head = Object.entries(rest).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
  fs.writeFileSync(file, `{\n${head.join("\n")}\n  "markets": {\n${lines.join(",\n")}\n  }\n}\n`);
  console.log(changed ? `\nSaved ${changed} new price(s) to prices.json.` : "\nNo price changes.");
} else if (changed) {
  console.log(`\n${changed} price(s) changed. Run "npm run prices -- --write" to save them.`);
}
if (failed) console.log(`${failed} countr${failed === 1 ? "y needs" : "ies need"} a manual check.`);
process.exitCode = changed && !write ? 1 : failed ? 2 : 0;
