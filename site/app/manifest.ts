import type { MetadataRoute } from "next";
import { DESCRIPTION, NAME } from "@/lib/content";

// Written to out/manifest.webmanifest at build time.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: NAME,
    short_name: NAME,
    description: DESCRIPTION,
    lang: "en",
    start_url: "/",
    // A website, not an app to install: the app is the desktop download.
    display: "browser",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
