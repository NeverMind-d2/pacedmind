import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // The desktop app runs .next/standalone/server.js. scripts/build-desktop.mjs takes only what that
  // needs, leaving out the project files that file tracing copies in, such as the local data/ folder.
  // (Don't use outputFileTracingExcludes for that: its patterns match anywhere in a path, so
  // "dist/**" also drops node_modules/next/dist files.)
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
