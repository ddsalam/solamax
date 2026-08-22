import { notFound } from "next/navigation";
import { todayWib } from "@/lib/periods";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { AkunKasPanel } from "@/components/keuangan/AkunKasPanel";
import { unitDotted, unitLabel } from "@/lib/config";
import { getAkunKasKelola } from "@/lib/keuangan-input-queries";
import {
  canInputKeuangan,
  canNonaktifkanAkunKas,
  canViewLaporanKeuangan,
} from "@/lib/keuangan-wewenang";
import { getDataScope } from "@/lib/scope";
import { getSelection } from "@/lib/selection";

export const dynamic = "force-dynamic";

/**
 * Kelola Akun Kas per unit (§10.18).
 *
 * Daftar rekening berhenti hidup di migrasi: tujuh SPBU × 5–7 rekening, plus
 * yang dibuka dan ditutup sepanjang tahun. Seed migrasi menjadikan setiap
 * perubahan rekening bank sebagai rilis kode — dan enam unit tertahan menunggu
 * satu PR yang tak pernah layak ditulis.
 *
 * Wewenang ASIMETRIS dan dihitung DI SERVER (§10.18):
 *   · baca      → `canViewLaporanKeuangan`
 *   · tambah/ubah nama → `canInputKeuangan`
 *   · nonaktifkan      → `canNonaktifkanAkunKas` (Head of Finance)
 */
export default async function AkunKasPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canViewLaporanKeuangan(ctx)) notFound();

  const akun = await getAkunKasKelola(unit.unit_id);
  const hariIni = getSelection(scope.units).date;

  return (
    <>
      {/* Tanpa kontrol TANGGAL dengan sengaja: daftar rekening bukan keadaan
          harian, dan pemilih tanggal di sini akan menjanjikan sesuatu yang tak
          pernah dijawab halamannya. */}
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={unit.code}
        segment="keuangan-akun-kas"
      />
      <h1 className="text-h3 t-brand">Kelola akun kas</h1>
      <div className="fs16 t-secondary mt2">
        {unit.name} · {unitLabel(unit.code)}
      </div>
      <p className="fs16 t-tertiary mt2">
        Rekening yang terdaftar di sini adalah yang bisa dipilih saat menginput mutasi, dan
        yang dijumlahkan jadi Cash on Hand.
      </p>

      <div className="mt6">
        <AkunKasPanel
          code={unit.code}
          namaUnit={unit.name}
          hariIni={hariIni}
          akun={akun}
          bolehTulis={canInputKeuangan(ctx)}
          bolehNonaktif={canNonaktifkanAkunKas(ctx)}
        />
      </div>
    </>
  );
}
