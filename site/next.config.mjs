/** @type {import("next").NextConfig} */
const nextConfig = {
  // A static site: `npm run build` writes plain files to out/ for any static host.
  output: "export",
  devIndicators: false,
  // URLs have no trailing slash: a page at /privacy would be written as out/privacy.html, so the
  // server looks for {path}.html and redirects /privacy/ to /privacy (deploy/).
  trailingSlash: false,
  experimental: {
    // The styles arrive inside the HTML instead of as a render-blocking file, one round trip fewer: in
    // Lighthouse's throttled mobile run the first paint came 0.8 s sooner. Most visits are first visits,
    // and the CSS is small (6 KB compressed).
    inlineCss: true,
  },
  // The site sits inside the app's repository, which has its own lockfile higher up. Without this,
  // Turbopack would treat the whole repository as the project. (.mjs, so import.meta works on every
  // Node version; next.config.ts is compiled to CommonJS on older ones.)
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
