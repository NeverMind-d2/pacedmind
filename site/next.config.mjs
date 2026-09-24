/** @type {import("next").NextConfig} */
const nextConfig = {
  // A static site: `npm run build` writes plain files to out/ for any static host.
  output: "export",
  devIndicators: false,
  // The site sits inside the app's repository, which has its own lockfile higher up. Without this,
  // Turbopack would treat the whole repository as the project. (.mjs, so import.meta works on every
  // Node version; next.config.ts is compiled to CommonJS on older ones.)
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
