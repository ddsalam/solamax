import type { Metadata } from "next";
/* Token SolaGroup DS — dimuat lebih dulu (urutan = sumber kebenaran visual). */
import "@/styles/ds/tokens/colors.css";
import "@/styles/ds/tokens/typography.css";
import "@/styles/ds/tokens/spacing.css";
import "@/styles/ds/tokens/elevation.css";
import "@/styles/ds/tokens/motion.css";
import "@/styles/ds/tokens/layout.css";
import "@/styles/ds/base.css";
import "@/styles/app.css";

export const metadata: Metadata = {
  // Resolves relative icon/OG asset URLs (icon.svg, opengraph-image, manifest).
  // Reuse the deployment URL already configured for auth; localhost for dev.
  metadataBase: new URL(process.env.AUTH_URL ?? "http://localhost:3000"),
  // Netral lintas-PT (multi-tenant sejak unit AS) — judul ber-PT di (app)/layout
  // via generateMetadata (per tenant viewer). Root melayani /login (unauth).
  title: "SolaMax — Pengawasan SPBU SolaGroup",
  description:
    "Lapisan pengawasan, monitoring & analisa di atas data POS EasyMax — SPBU SolaGroup",
};

/** Root minimal — shell ter-auth ada di (app)/layout; /login & /no-access bare. */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
