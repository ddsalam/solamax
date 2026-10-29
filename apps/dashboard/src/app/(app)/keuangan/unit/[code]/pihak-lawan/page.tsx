import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { AntarUnitForm, type PasanganTampil, type UnitLawanPilihan } from "@/components/keuangan/AntarUnitForm";
import { PihakLawanPanel, type PihakLawanTampil } from "@/components/keuangan/PihakLawanPanel";
import { ringkasPasangan, satuPt } from "@/lib/antar-unit-model";
import { getBahanParitas, getKakiAntarUnit, getKodeAlasanBalik, getRekeningAktif } from "@/lib/antar-unit-queries";
import { bukuPembantu, statusPasangan } from "@/lib/buku-pembantu-model";
import { getKasDicocokkan } from "@/lib/cocok-bank-queries";
import { getBahanBukuPembantu } from "@/lib/keuangan-laporan-queries";
import { paritasAntarUnit } from "@/lib/keuangan-pantau-model";
import { UNIT_DISPLAY, unitDotted, unitLabel } from "@/lib/config";
import {
  canBalikPasanganAntarUnit,
  canCatatAntarUnit,
  canNonaktifkanPihakLawan,
  canTambahPihakLawan,
  canTetapkanPihakLawanBaris,
  canTetapkanSaldoAwalPihakLawan,
  canViewLaporanKeuangan,
} from "@/lib/keuangan-wewenang";
import { getBarisTanpaPihakLawan } from "@/lib/pihak-lawan-queries";
import { getDataScope } from "@/lib/scope";
import { todayWib } from "@/lib/periods";
import { DATE_RE } from "@/lib/selection-keys";

export const dynamic = "force-dynamic";

/**
 * Pihak lawan per unit (rencana 2026-10-29 U3; R1, R2, R7, KTD3).
 *
 * U6 — BUKU PEMBANTU: pemilih tanggal (bawaan hari ini) di atas tabel pihak
 * lawan per jenis — saldo (nilai mutlak + Piutang/Hutang), status pasangan
 * unit ("Dalam perjalanan"/"Lunas di bank", "Satu PT", "Tidak seimbang" →
 * Pemantauan), baris bersaldo nol diciutkan, rincian mutasi bersaldo berjalan.
 * Saldonya lahir dari jalur baca NERACA (`getBahanBukuPembantu`), bukan
 * hitungan kedua. Tanpa ekspor CSV (Scope Boundaries rencana).
 * Juga tindakan U3/U4: tambah/nonaktifkan (Keuangan), saldo pembuka (HoF),
 * daftar kerja baris Hutang Piutang lama tanpa pihak lawan, antar unit.
 *
 * Wewenang dihitung DI SERVER, satu predikat per tindakan:
 *   · baca              → `canViewLaporanKeuangan`
 *   · tambah            → `canTambahPihakLawan`
 *   · nonaktifkan       → `canNonaktifkanPihakLawan`
 *   · saldo pembuka     → `canTetapkanSaldoAwalPihakLawan` (HoF)
 *   · tetapkan baris lama → `canTetapkanPihakLawanBaris`
 *   · catat antar unit  → `canCatatAntarUnit` (+ gerbang dua unit di server, U4)
 *   · balik pasangan    → `canBalikPasanganAntarUnit` (HoF, R31)
 */
export default async function PihakLawanPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ tanggal?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canViewLaporanKeuangan(ctx)) notFound();

  // Bawaan HARI INI (rencana U6), bukan tanggal pilihan layar lain: buku
  // pembantu menjawab "berapa saldonya sekarang" kecuali tanggal diminta.
  const hariIni = todayWib();
  const per = sp.tanggal && DATE_RE.test(sp.tanggal) ? sp.tanggal : hariIni;

  const bolehCatat = canCatatAntarUnit(ctx);
  const bolehBalik = canBalikPasanganAntarUnit(ctx);
  // R4 hanya bisa dinilai untuk pasangan yang KEDUA unitnya dipegang pembaca:
  // `qScoped([unit ini, unit lawan yang dipegang])` — buku unit lain tak dibaca.
  const unitParitas = scope.units.map((u) => u.unit_id);
  const [bahanBuku, lama, kakiAntarUnit, rekeningSaya, kodeAlasan, bahanParitas] = await Promise.all([
    getBahanBukuPembantu(unit.unit_id, per),
    getBarisTanpaPihakLawan(unit.unit_id),
    getKakiAntarUnit(unit.unit_id),
    bolehCatat ? getRekeningAktif(unit.unit_id) : Promise.resolve([]),
    bolehBalik ? getKodeAlasanBalik() : Promise.resolve([]),
    getBahanParitas(unitParitas),
  ]);

  // Unit lawan untuk formulir (U4): nama dari peta tampilan config.ts + unit
  // dalam jangkauan — tanpa membaca data tenant lain. Hanya yang dipegang yang
  // bisa dipilih; sisanya nonaktif dengan sebabnya (R30 tetap ditegakkan server).
  const dipegang = new Set(scope.units.map((u) => u.code));
  const kodeLawan = [...new Set([...Object.keys(UNIT_DISPLAY), ...scope.units.map((u) => u.code)])].filter(
    (c) => c !== unit.code,
  );
  const unitLawan: UnitLawanPilihan[] = kodeLawan.map((c) => ({
    code: c,
    name: scope.units.find((u) => u.code === c)?.name ?? UNIT_DISPLAY[c]?.name ?? c,
    dipegang: dipegang.has(c),
    satuPt: satuPt(unit.code, c, scope.tenantPerUnit),
  }));
  // R3 — "Lunas di bank" = kaki unit ini berada di kelompok cocok AKTIF (U10).
  const dicocokkan = await getKasDicocokkan(unit.unit_id, kakiAntarUnit.map((k) => k.id));
  const lawanPasangan = new Map(kakiAntarUnit.map((k) => [k.pasanganUuid, k]));
  // Diringkas SEKALI — dipakai daftar pasangan dan kolom Status buku pembantu.
  const ringkas = ringkasPasangan(kakiAntarUnit, dicocokkan);
  const pasangan: PasanganTampil[] = ringkas.map((p) => {
    const k = lawanPasangan.get(p.pasanganUuid)!;
    return {
      ...p,
      lawanCode: k.lawanCode,
      lawanNama: k.lawanNama,
      satuPt: satuPt(unit.code, k.lawanCode, scope.tenantPerUnit),
      lawanDipegang: dipegang.has(k.lawanCode),
    };
  });

  const paritas = paritasAntarUnit(unitParitas.map(Number), bahanParitas, per).filter(
    (p) => p.unitId === Number(unit.unit_id),
  );
  const kodeUnit = new Map(
    [...scope.units.map((u) => [Number(u.unit_id), u.code] as const), ...kakiAntarUnit.map((k) => [k.lawanUnitId, k.lawanCode] as const)],
  );
  const buku = bukuPembantu({
    per,
    pihak: bahanBuku.pihakLawan,
    mutasi: bahanBuku.mutasi,
    titipanDiterima: bahanBuku.titipanDiterima,
  });
  const tampil: PihakLawanTampil[] = buku.map((b) => {
    const lawanCode = b.lawanUnitId === null ? undefined : kodeUnit.get(b.lawanUnitId);
    return {
      id: b.id,
      jenis: b.jenis,
      nama: b.nama,
      aktif: b.aktif,
      saldoAwal: b.saldoAwal,
      saldoSen: b.saldoSen,
      arah: b.arah,
      sementara: b.sementara,
      nMutasi: b.rincian.filter((r) => !r.keterangan.startsWith("Saldo pembuka")).length,
      nPraSaldoAwal: b.nPraSaldoAwal,
      rincian: b.rincian,
      status:
        b.lawanUnitId === null
          ? null
          : statusPasangan(ringkas, b.lawanUnitId, {
              satuPt: lawanCode !== undefined && satuPt(unit.code, lawanCode, scope.tenantPerUnit),
              tidakSeimbang: paritas.some((p) => p.lawanUnitId === b.lawanUnitId && p.status === "tidak_seimbang"),
            }),
      // Saldo pembuka pasangan menulis buku unit lawan juga — formulirnya hanya
      // berguna bila pengguna memegang unit itu (gerbangnya tetap di server).
      lawanDipegang: b.lawanUnitId === null || scope.units.some((u) => u.unit_id === b.lawanUnitId),
    };
  });

  return (
    <>
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={unit.code}
        segment="keuangan-pihak-lawan"
      />
      <h1 className="text-h3 t-brand">Pihak lawan</h1>
      <div className="fs16 t-secondary mt2">
        {unit.name} · {unitLabel(unit.code)}
      </div>
      <p className="fs16 t-tertiary mt2">
        Buku pembantu: setiap mutasi Hutang Piutang dan Penyerahan titipan menyebut satu pihak lawan.
        Piutang = pihak lawan berhutang ke unit ini; Hutang = unit ini berhutang ke pihak lawan. Angkanya
        sama dengan neraca harian pada tanggal yang sama.
      </p>

      {/* Tanggal saldo di QUERY: daftar pihak lawan bukan keadaan harian, tetapi saldonya ya. */}
      <form method="get" className="keu-2col mt4">
        <label className="keu-fld">
          <span className="keu-label">Saldo per tanggal</span>
          <input className="manual-input" type="date" name="tanggal" defaultValue={per} />
        </label>
        <div className="manual-form-actions">
          <button type="submit" className="btn-outline sm">
            Tampilkan
          </button>
        </div>
      </form>

      <div className="mt6">
        <PihakLawanPanel
          code={unit.code}
          per={per}
          pihak={tampil}
          barisLama={lama}
          tautanPemantauan={`/keuangan/pemantauan?tanggal=${per}`}
          bolehTambah={canTambahPihakLawan(ctx)}
          bolehNonaktif={canNonaktifkanPihakLawan(ctx)}
          bolehSaldoAwal={canTetapkanSaldoAwalPihakLawan(ctx)}
          bolehTetapkanBaris={canTetapkanPihakLawanBaris(ctx)}
        />
        <AntarUnitForm
          code={unit.code}
          namaUnit={unit.name}
          unitLawan={unitLawan}
          rekeningSaya={rekeningSaya}
          pasangan={pasangan}
          kodeAlasan={kodeAlasan}
          bolehCatat={bolehCatat}
          bolehBalik={bolehBalik}
        />
      </div>
    </>
  );
}
