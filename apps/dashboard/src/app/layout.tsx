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
import Image from "next/image";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Sidebar } from "@/components/Sidebar";
import { TopbarNav } from "@/components/TopbarNav";
import { buildAnomalies } from "@/lib/anomalies";
import { getSyncByUnit, getUnits } from "@/lib/queries";
import { ago } from "@/lib/format";

export const metadata: Metadata = {
  title: "SolaMax — Pengawasan SPBU SolaGroup",
  description:
    "Lapisan pengawasan, monitoring & analisa di atas data POS EasyMax — SPBU SolaGroup",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  let lastSync: string | null = null;
  let alertCount = 0;
  try {
    const [units, sync] = await Promise.all([getUnits(), getSyncByUnit()]);
    const newest = sync
      .map((s) => s.last_run)
      .filter((x): x is string => x !== null)
      .sort()
      .pop();
    lastSync = newest ?? null;
    const anomalies = await buildAnomalies(units);
    alertCount = anomalies.filter((a) => a.tone === "danger").length;
  } catch {
    // DB tak terjangkau (mis. proxy mati) — shell tetap render.
  }

  return (
    <html lang="id">
      <body>
        <header className="topbar no-print">
          <Image src="/solagroup-logo.png" alt="SolaGroup" width={120} height={20} className="topbar-logo" />
          <div className="topbar-div" />
          <span className="text-caption w600 t-secondary">SolaMax</span>
          <span className="role-chip">Direksi</span>
          <TopbarNav />
          <div className="topbar-right">
            <span className="fs15 t-tertiary sync-note">
              <span className={`dot ${lastSync ? "success pulse" : "muted"}`} />
              {lastSync ? `data terakhir masuk ${ago(lastSync)}` : "menunggu koneksi data"}
            </span>
          </div>
        </header>
        <div className="shell">
          <Sidebar alertCount={alertCount} />
          <main className="main">{children}</main>
        </div>
        <AutoRefresh seconds={60} />
      </body>
    </html>
  );
}
