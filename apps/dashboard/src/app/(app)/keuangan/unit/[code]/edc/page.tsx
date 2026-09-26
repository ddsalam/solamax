import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { EdcPengaturanPanel } from "@/components/edc/EdcPengaturanPanel";
import { unitDotted, unitLabel } from "@/lib/config";
import { susunPengaturanEdc } from "@/lib/edc-rekening-model";
import { getKartuEdcUnit, getVersiRekening } from "@/lib/edc-rekening-queries";
import { getAkunKas } from "@/lib/keuangan-input-queries";
import {
  canAturRekeningEdc,
  canPetakanKartuEdc,
  canViewLaporanKeuangan,
} from "@/lib/keuangan-wewenang";
import { addDays, todayWib } from "@/lib/periods";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

/** Jendela penjualan yang ditampilkan — cukup untuk melihat kode kartu yang jarang dipakai. */
const JENDELA_HARI = 30;

/**
 * Pengaturan EDC per unit (§10.28).
 *
 * Tiap EDC mencairkan penjualannya ke rekening yang disepakati dengan banknya,
 * dan kesepakatan itu berubah sewaktu-waktu. Layar ini tempat tim Finance
 * mencatat perubahan itu — bertanggal berlaku, tanpa menimpa riwayat — plus
 * peta kode kartu EasyMax → EDC yang dulu hanya bisa diisi dari Rincian.
 *
 * Wewenang dihitung DI SERVER:
 *   · baca                 → `canViewLaporanKeuangan`
 *   · atur rekening        → `canAturRekeningEdc` (tim Finance, Direksi, super admin)
 *   · petakan kode kartu   → `canPetakanKartuEdc` (§10.25, tak berubah)
 *
 * Tanpa kontrol TANGGAL dengan sengaja: pengaturan bukan keadaan harian.
 */
export default async function PengaturanEdcPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  const ctx = { role: scope.role, email: scope.email };
  // Pengawas memetakan kode kartu dari Rincian (§10.25); layar ini milik Keuangan.
  if (!canViewLaporanKeuangan(ctx)) notFound();

  const hariIni = todayWib();
  const dari = addDays(hariIni, -JENDELA_HARI);
  const [kartu, versi, akun] = await Promise.all([
    getKartuEdcUnit(unit.unit_id, dari, hariIni),
    getVersiRekening(unit.unit_id),
    getAkunKas(unit.unit_id),
  ]);
  const { edc, kartuTanpaPeta } = susunPengaturanEdc(kartu, versi, hariIni);
  // Yang perlu diurus dulu: kode tanpa EDC, lalu yang paling ramai.
  const kartuUrut = [...kartu].sort(
    (x, y) =>
      Number(x.acquirer !== null) - Number(y.acquirer !== null) ||
      y.rp - x.rp ||
      x.ckdkartu.localeCompare(y.ckdkartu),
  );
  const akunBank = akun.filter((a) => a.kind === "bank" && a.active).map((a) => ({ id: a.id, nama: a.nama }));

  return (
    <>
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={unit.code}
        segment="keuangan-edc"
      />
      <h1 className="text-h3 t-brand">Pengaturan EDC</h1>
      <div className="fs16 t-secondary mt2">
        {unit.name} · {unitLabel(unit.code)}
      </div>
      <p className="fs16 t-tertiary mt2">
        Tiap EDC mencairkan penjualannya ke rekening yang disepakati dengan banknya. Bila
        kesepakatannya berubah, catat rekening barunya di sini beserta tanggal berlakunya —
        pengaturan lama tetap tersimpan, dan batch yang sudah tercatat tidak ikut berubah.
      </p>

      <EdcPengaturanPanel
        code={unit.code}
        hariIni={hariIni}
        dari={dari}
        edc={edc}
        kartu={kartuUrut}
        kartuTanpaPeta={kartuTanpaPeta}
        akunBank={akunBank}
        bolehAtur={canAturRekeningEdc(ctx)}
        bolehPetakan={canPetakanKartuEdc(ctx)}
      />
    </>
  );
}
