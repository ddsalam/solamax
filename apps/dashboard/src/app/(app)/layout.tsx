import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SignOutButton } from "@/components/SignOutButton";
import { getAnomalies } from "@/lib/anomalies";
import { ptLabelForUnits, unitLabel } from "@/lib/config";
import { worstSyncAt } from "@/lib/freshness";
import { getSyncByUnit } from "@/lib/queries";
import { getDataScope } from "@/lib/scope";
import { getSelection } from "@/lib/selection";
import { type Role } from "@/lib/auth-context";

export const dynamic = "force-dynamic";

/** Judul ber-PT per tenant viewer (multi-tenant sejak unit AS). Untuk viewer
 *  PT Sola Petra Abadi string-nya identik dengan judul lama (tanpa regresi). */
export async function generateMetadata(): Promise<Metadata> {
  const scope = await getDataScope();
  return {
    title: `SolaMax — Pengawasan SPBU ${ptLabelForUnits(scope.units.map((u) => u.code))}`,
  };
}

const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  admin_perusahaan: "Admin Perusahaan",
  direksi: "Direksi",
  pengawas: "Pengawas",
};

/** Shell ter-auth + ter-scope: getDataScope = gerbang otoritatif & sumber unit.
 *  Chrome (topbar + drawer) dirender oleh AppShell (client); semua bit server
 *  diteruskan sebagai props → router.refresh me-render ulang dengan nilai segar. */
export default async function AppShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // getDataScope: default-deny (redirect /login | /no-access) + unit ter-scope.
  const scope = await getDataScope();
  const { unitCode, date } = getSelection(scope.units);

  // Sync & anomali HANYA untuk unit dalam scope caller (lewat scope.unitIds / scope.units).
  let lastSync: string | null = null;
  let alertCount = 0;
  try {
    // MIN (unit TERBURUK), bukan MAX — lihat lib/freshness.ts untuk akar masalah
    // (agent Bakau mati 34 jam sementara badge hijau "1 menit lalu") dan untuk
    // pertukaran yang disengaja pada rute per-unit.
    const sync = await getSyncByUnit(scope.unitIds);
    lastSync = worstSyncAt(scope.unitIds, sync);
    // Badge = danger MAYOR & non-standing (kas-dorman permanen tak dihitung).
    alertCount = (await getAnomalies(scope.units)).filter(
      (a) => a.tone === "danger" && a.tier === "major" && !a.standing,
    ).length;
  } catch {
    // DB tak terjangkau — shell tetap render.
  }

  return (
    <>
      <AppShell
        roleLabel={ROLE_LABEL[scope.role]}
        email={scope.email}
        isSuperAdmin={scope.isSuperAdmin}
        lastSync={lastSync}
        alertCount={alertCount}
        units={scope.units.map((u) => ({ code: u.code, label: unitLabel(u.code, u.name) }))}
        unitCode={unitCode}
        date={date}
        signOutSlot={<SignOutButton />}
      >
        {children}
      </AppShell>
      <AutoRefresh seconds={60} />
    </>
  );
}
