import type { MetadataRoute } from "next";

/** Lets Fundur be added to a phone's home screen, where it can receive notifications. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fundur",
    short_name: "Fundur",
    description: "Run your design studio: projects, plans, clients and conversations.",
    start_url: "/",
    display: "standalone",
    background_color: "#ecebe6",
    theme_color: "#141412",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
