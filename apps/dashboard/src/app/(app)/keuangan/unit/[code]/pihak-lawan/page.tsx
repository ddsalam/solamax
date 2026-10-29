import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { PihakLawanPanel, type PihakLawanTampil } from "@/components/keuangan/PihakLawanPanel";
import { unitDotted, unitLabel } from "@/lib/config";
import {
  canNonaktifkanPihakLawan,
  canTambahPihakLawan,
  canTetapkanPihakLawanBaris,
  canTetapkanSaldoAwalPihakLawan,
  canViewLaporanKeuangan,
} from "@/lib/keuangan-wewenang";
import { saldoPihakLawan } from "@/lib/pihak-lawan-model";
import { getBarisTanpaPihakLawan, getMutasiPihakLawan, getPihakLawan } from "@/lib/pihak-lawan-queries";
import { getDataScope } from "@/lib/scope";
import { getSelection } from "@/lib/selection";
import { DATE_RE } from "@/lib/selection-keys";

export const dynamic = "force-dynamic";

/**
 * Pihak lawan per unit (rencana 2026-10-29 U3; R1, R2, R7, KTD3).
 *
 * Hanya yang dibutuhkan untuk MENJALANKAN tindakannya: daftar per jenis berikut
 * saldo per tanggal, tambah/nonaktifkan (Keuangan), saldo pembuka (HoF), dan
 * daftar kerja baris Hutang Piutang lama tanpa pihak lawan. Penyajian buku
 * pembantu lengkap (rincian per mutasi, neraca) milik U6.
 *
 * Wewenang dihitung DI SERVER, satu predikat per tindakan:
 *   · baca              → `canViewLaporanKeuangan`
 *   · tambah            → `canTambahPihakLawan`
 *   · nonaktifkan       → `canNonaktifkanPihakLawan`
 *   · saldo pembuka     → `canTetapkanSaldoAwalPihakLawan` (HoF)
 *   · tetapkan baris lama → `canTetapkanPihakLawanBaris`
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

  const hariIni = getSelection(scope.units).date;
  const per = sp.tanggal && DATE_RE.test(sp.tanggal) ? sp.tanggal : hariIni;

  const [pihak, mutasi, lama] = await Promise.all([
    getPihakLawan(unit.unit_id),
    getMutasiPihakLawan(unit.unit_id, per),
    getBarisTanpaPihakLawan(unit.unit_id),
  ]);

  const tampil: PihakLawanTampil[] = pihak.map((p) => {
    const s = saldoPihakLawan({ pihakLawanId: p.id, saldoAwal: p.saldoAwal, mutasi, per });
    return {
      id: p.id,
      jenis: p.jenis,
      nama: p.nama,
      aktif: p.aktif,
      saldoAwal: p.saldoAwal,
      saldoSen: s.saldoSen,
      nMutasi: s.nMutasi,
      nPraSaldoAwal: s.nPraSaldoAwal,
      // Saldo pembuka pasangan menulis buku unit lawan juga — formulirnya hanya
      // berguna bila pengguna memegang unit itu (gerbangnya tetap di server).
      lawanDipegang: p.lawanUnitId === null || scope.units.some((u) => u.unit_id === p.lawanUnitId),
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
        Setiap mutasi Hutang Piutang dan Penyerahan titipan menyebut satu pihak lawan. Saldo
        positif = piutang (pihak lawan berhutang ke unit ini), negatif = hutang unit ini.
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
          bolehTambah={canTambahPihakLawan(ctx)}
          bolehNonaktif={canNonaktifkanPihakLawan(ctx)}
          bolehSaldoAwal={canTetapkanSaldoAwalPihakLawan(ctx)}
          bolehTetapkanBaris={canTetapkanPihakLawanBaris(ctx)}
        />
      </div>
    </>
  );
}
