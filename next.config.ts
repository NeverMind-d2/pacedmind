import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // The desktop app runs .next/standalone/server.js. scripts/build-desktop.mjs takes only what that
  // needs, leaving out the project files that file tracing copies in, such as the local data/ folder.
  // (Don't use outputFileTracingExcludes for that: its patterns match anywhere in a path, so
  // "dist/**" also drops node_modules/next/dist files.)
  output: "standalone",
  // The native companion is a separate project and never runs in the Next server. Keep its
  // dependencies, generated native projects and bundles out of standalone tracing.
  outputFileTracingExcludes: { "/*": ["./mobile/**/*"] },
  poweredByHeader: false,
};

export default nextConfig;
