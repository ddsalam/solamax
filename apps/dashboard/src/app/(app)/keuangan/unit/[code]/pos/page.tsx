import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { DaftarPosPanel, type PetaTampil } from "@/components/keuangan/DaftarPosPanel";
import { unitDotted, unitLabel } from "@/lib/config";
import { getPetaKategori } from "@/lib/keuangan-input-queries";
import { canKelolaPos, canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { todayWib } from "@/lib/periods";
import { kelengkapanPeta, KODE_INDUK_BANK, posUntukKode, susunDaftarPos } from "@/lib/pos-model";
import { getDaftarPos, getKodeLama, getRujukanSubPos } from "@/lib/pos-queries";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * Daftar Pos per unit (rencana 2026-11-02 K6 U1; R1–R5).
 *
 * Tabel Pos resmi (global, sama di tujuh unit) + sub-pos milik unit ini:
 * sub-pos bank 1111–1119 per rekening (R5, lahir dari Kelola akun kas) dan
 * sub-pos tambahan HoF. Di bawahnya peta 14 kategori operasional → pos beban.
 *
 * Wewenang dihitung DI SERVER:
 *   · baca                               → `canViewLaporanKeuangan`
 *   · tambah/hapus sub-pos, ubah peta    → `canKelolaPos` (HoF)
 */
export default async function DaftarPosPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canViewLaporanKeuangan(ctx)) notFound();

  const hariIni = todayWib();
  const [daftar, kodeLama, petaKini] = await Promise.all([
    getDaftarPos(unit.unit_id),
    getKodeLama(unit.unit_id),
    getPetaKategori(unit.unit_id, hariIni),
  ]);
  const subPosHof = daftar.filter((p) => p.unitId !== null && p.cashAccountId === null).map((p) => p.kode);
  const rujukan = await getRujukanSubPos(unit.unit_id, subPosHof);

  const peta: PetaTampil[] = petaKini.map((r) => {
    const pos = posUntukKode(r.account, daftar, kodeLama);
    return {
      kategori: r.category,
      kodeTersimpan: r.account,
      kodeLama: !/^\d{4}$/.test(r.account),
      pos: pos === null ? null : { kode: pos.kode, nama: pos.nama },
    };
  });
  const kelengkapan = kelengkapanPeta(
    peta.map((p) => p.kategori),
    peta.map((p) => ({ kategori: p.kategori, kodePos: p.kodeTersimpan })),
    daftar,
    kodeLama,
  );

  return (
    <>
      {/* Tanpa dimensi tanggal: daftar pos bukan keadaan harian. */}
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={unit.code}
        segment="keuangan-pos"
      />
      <h1 className="text-h3 t-brand">Daftar pos</h1>
      <div className="fs16 t-secondary mt2">
        {unit.name} · {unitLabel(unit.code)}
      </div>
      <p className="fs16 t-tertiary mt2">
        Daftar pos resmi berkode empat digit, sama untuk semua unit. Sub-pos bank lahir otomatis dari
        rekening di Kelola akun kas. Hanya Head of Finance yang bisa menambah sub-pos dan mengubah peta
        kategori.
      </p>

      <div className="mt6">
        <DaftarPosPanel
          code={unit.code}
          hariIni={hariIni}
          kelas={susunDaftarPos(daftar)}
          peta={peta}
          kelengkapan={kelengkapan}
          rujukan={Object.fromEntries(rujukan)}
          posBeban={daftar
            .filter((p) => p.unitId === null && p.jenis === "beban" && !p.induk && !p.sistem)
            .map((p) => ({ kode: p.kode, nama: p.nama }))}
          indukPilihan={daftar
            .filter((p) => p.unitId === null && p.induk && p.kode !== KODE_INDUK_BANK)
            .map((p) => ({ kode: p.kode, nama: p.nama }))}
          bolehKelola={canKelolaPos(ctx)}
        />
      </div>
    </>
  );
}
