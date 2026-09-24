import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // The desktop app runs .next/standalone/server.js. scripts/build-desktop.mjs leaves out the
  // local data/ folder that file tracing copies in. (Don't use outputFileTracingExcludes for that:
  // its patterns match anywhere in a path, so "dist/**" also drops node_modules/next/dist files.)
  output: "standalone",
};

export default nextConfig;
