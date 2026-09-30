import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Desktop app build output (npm run desktop).
    "dist/**",
    // Local database, session scripts and backups.
    "data/**",
    // The website's build output (site/, its own Next.js project).
    "site/.next/**",
    "site/out/**",
    "site/next-env.d.ts",
    // The docs (docs/, its own Next.js project with its own ESLint config).
    "docs/**",
    // The billing Edge Functions run on Deno in Supabase (deno check in CI).
    "supabase/functions/**",
    // The native companion has its own dependency graph and generated native projects.
    "mobile/node_modules/**", "mobile/.expo/**", "mobile/dist/**", "mobile/android/**", "mobile/ios/**",
  ]),
]);

export default eslintConfig;
