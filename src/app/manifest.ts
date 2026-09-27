import type { MetadataRoute } from "next";

/**
 * The web app as an installable app, so a phone can add it to its Home Screen: on an iPhone or iPad, that's what lets it
 * show notifications (Settings → Notifications, public/sw.js).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PacedMind",
    short_name: "PacedMind",
    start_url: "/today",
    display: "standalone",
    background_color: "#111111",
    theme_color: "#111111",
    icons: [{ src: "/brand/pacedmind-emblem.png", sizes: "512x512", type: "image/png", purpose: "any" }],
  };
}
