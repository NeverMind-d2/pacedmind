// Read-only: local scaffold validation and explicit release blockers. Never connects to a store.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const args = process.argv.slice(2);
const index = args.indexOf("--platform");
const requested = index === -1 ? "all" : args[index + 1];
const platforms = requested === "mobile" ? ["ios", "android"] : requested === "all" ? ["ios", "android", "windows", "macos", "mac-app-store"] : [requested];
if (!platforms.every((p) => ["ios", "android", "windows", "macos", "mac-app-store"].includes(p))) throw new Error("Unknown platform. Use ios, android, mobile, windows, macos, mac-app-store or all.");
const required = ["mobile/package-lock.json", "mobile/App.jsx", "mobile/assets/icon.png", "mobile/assets/adaptive-icon.png", "mobile/eas.json", "desktop/entitlements.mac.plist", "scripts/windows-store.mjs", "stores/README.md"];
let failed = 0;
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) { console.error(`MISSING ${file}`); failed++; }
}
const mobile = createRequire(import.meta.url)(path.join(root, "mobile/app.config.js")).expo;
if (mobile.version !== read("package.json").version) { console.error("Mobile and desktop versions differ."); failed++; }
if (mobile.android.allowBackup !== false || mobile.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads !== false) {
  console.error("Mobile transport/backup settings do not match the reviewed defaults."); failed++;
}
if (!failed) console.log("Local packaging scaffold checks passed. This does not verify a native build or store eligibility.");
const readiness = read("stores/readiness.json");
const selected = readiness.items.filter((item) => item.platforms.some((p) => platforms.includes(p)));
for (const item of selected) {
  if (!["pending", "complete"].includes(item.status) || (item.status === "complete" && !item.evidence?.trim())) throw new Error(`Invalid readiness evidence for ${item.id}.`);
  console.log(`${item.status.toUpperCase()} [${item.platforms.join(", ")}] ${item.id}: ${item.requirement}`);
}
const pending = selected.filter((item) => item.status !== "complete").length;
console.log(`\n${pending} release prerequisites remain (requirements reviewed ${readiness.reviewedOn}). Recheck vendor rules before submission.`);
process.exitCode = failed || (args.includes("--strict") && pending ? 1 : 0);
