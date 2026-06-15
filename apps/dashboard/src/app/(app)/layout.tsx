import Image from "next/image";
import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Sidebar } from "@/components/Sidebar";
import { TopbarNav } from "@/components/TopbarNav";
import { SignOutButton } from "@/components/SignOutButton";
import { buildAnomalies } from "@/lib/anomalies";
import { getSyncByUnit } from "@/lib/queries";
import { getDataScope } from "@/lib/scope";
import { type Role } from "@/lib/auth-context";
import { ago } from "@/lib/format";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  admin_perusahaan: "Admin Perusahaan",
  direksi: "Direksi",
  pengawas: "Pengawas",
};

/** Shell ter-auth + ter-scope: getDataScope = gerbang otoritatif & sumber unit. */
export default async function AppShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // getDataScope: default-deny (redirect /login | /no-access) + unit ter-scope.
  const scope = await getDataScope();

  // Sync & anomali HANYA untuk unit dalam scope caller (lewat scope.unitIds / scope.units).
  let lastSync: string | null = null;
  let alertCount = 0;
  try {
    const sync = await getSyncByUnit(scope.unitIds);
    lastSync =
      sync
        .map((s) => s.last_run)
        .filter((x): x is string => x !== null)
        .sort()
        .pop() ?? null;
    alertCount = (await buildAnomalies(scope.units)).filter((a) => a.tone === "danger").length;
  } catch {
    // DB tak terjangkau — shell tetap render.
  }

  return (
    <>
      <header className="topbar no-print">
        <Image src="/solagroup-logo.png" alt="SolaGroup" width={120} height={20} className="topbar-logo" />
        <div className="topbar-div" />
        <span className="text-caption w600 t-secondary">SolaMax</span>
        <span className="role-chip">{ROLE_LABEL[scope.role]}</span>
        <TopbarNav />
        <div className="topbar-right">
          <span className="fs15 t-tertiary sync-note">
            <span className={`dot ${lastSync ? "success pulse" : "muted"}`} />
            {lastSync ? `data terakhir masuk ${ago(lastSync)}` : "menunggu koneksi data"}
          </span>
          {scope.isSuperAdmin && (
            <Link href="/admin" className="fs15 w600 t-accent">
              Akses
            </Link>
          )}
          <span className="fs15 t-tertiary auth-email">{scope.email}</span>
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
