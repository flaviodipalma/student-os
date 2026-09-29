import type { MetadataRoute } from "next"

// Lets students install Student OS on their phone's home screen (or as a desktop
// app). On iPhone, installing is what allows push notifications (iOS 16.4+).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Student OS",
    short_name: "Student OS",
    description: "Know what to do today: deadlines, classes and commitments in one plan.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#4f46e5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
