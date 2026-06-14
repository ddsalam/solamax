import { redirect } from "next/navigation";
import Image from "next/image";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Sidebar } from "@/components/Sidebar";
import { TopbarNav } from "@/components/TopbarNav";
import { SignOutButton } from "@/components/SignOutButton";
import { buildAnomalies } from "@/lib/anomalies";
import { getSyncByUnit, getUnits } from "@/lib/queries";
import { getAuthContext, type Role } from "@/lib/auth-context";
import { ago } from "@/lib/format";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  admin_perusahaan: "Admin Perusahaan",
  direksi: "Direksi",
  pengawas: "Pengawas",
};

/** Shell ter-auth: gerbang otoritatif (sesi DB + membership) lalu render. */
export default async function AppShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const state = await getAuthContext();
  if (state.status === "unauthenticated") redirect("/login");
  if (state.status === "no-access") redirect("/no-access");
  const { ctx } = state;

  // CATATAN FASE 2: shell & query data BELUM di-scope per tenant/unit — itu Fase 3
  // (per-query scope + uji akses-negatif). Auth belum "deployable" sampai Fase 3.
  let lastSync: string | null = null;
  let alertCount = 0;
  try {
    const [units, sync] = await Promise.all([getUnits(), getSyncByUnit()]);
    lastSync =
      sync
        .map((s) => s.last_run)
        .filter((x): x is string => x !== null)
        .sort()
        .pop() ?? null;
    alertCount = (await buildAnomalies(units)).filter((a) => a.tone === "danger").length;
  } catch {
    // DB tak terjangkau — shell tetap render.
  }

  return (
    <>
      <header className="topbar no-print">
        <Image src="/solagroup-logo.png" alt="SolaGroup" width={120} height={20} className="topbar-logo" />
        <div className="topbar-div" />
        <span className="text-caption w600 t-secondary">SolaMax</span>
        <span className="role-chip">{ROLE_LABEL[ctx.role]}</span>
        <TopbarNav />
        <div className="topbar-right">
          <span className="fs15 t-tertiary sync-note">
            <span className={`dot ${lastSync ? "success pulse" : "muted"}`} />
            {lastSync ? `data terakhir masuk ${ago(lastSync)}` : "menunggu koneksi data"}
          </span>
          <span className="fs15 t-tertiary auth-email">{ctx.email}</span>
          <SignOutButton />
        </div>
      </header>
      <div className="shell">
        <Sidebar alertCount={alertCount} />
        <main className="main">{children}</main>
      </div>
      <AutoRefresh seconds={60} />
    </>
  );
}
