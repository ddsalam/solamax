import type { MetadataRoute } from "next";

/**
 * PWA manifest (Next file convention → emits <link rel="manifest">). Icons live
 * in public/brand/. theme/background reflect brand tokens (navy #1A3252, white
 * surface). Maskable variants carry a full-bleed #0D284A safe zone so Android
 * adaptive-icon masks never clip the mark.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // Netral lintas-PT: manifest PWA global (di-cache per origin, tanpa konteks
    // auth) tidak boleh menyebut satu PT — multi-tenant sejak unit AS.
    name: "SolaMax — Pengawasan SPBU SolaGroup",
    short_name: "SolaMax",
    description:
      "Lapisan pengawasan, monitoring & analisa di atas data POS EasyMax — SPBU SolaGroup",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#1A3252",
    background_color: "#FFFFFF",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/brand/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
