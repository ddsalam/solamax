import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { PenebusanForm, type IsianAwalPenebusan } from "@/components/keuangan/PenebusanForm";
import { PenebusanTabel } from "@/components/keuangan/PenebusanTabel";
import { ptLabelForUnits, unitDotted, unitLabel } from "@/lib/config";
import { canBatalkanPenebusan, canCatatPenebusan, canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { bulanSah, rekapPajak, unitSatuPt, type TotalRekap } from "@/lib/penebusan-model";
import { getPenebusanBulan, getRekeningBank, getSoBelumTertaut } from "@/lib/penebusan-queries";
import { rpSen } from "@/lib/pihak-lawan-model";
import { getDataScope } from "@/lib/scope";
import { todayWib } from "@/lib/periods";
import { DATE_RE } from "@/lib/selection-keys";

export const dynamic = "force-dynamic";

/**
 * Penebusan per SO per unit (rencana 2026-10-29 U7; R10–R16, R29; KTD9).
 *
 *   · formulir: komponen pajak diketik dari bukti (tanpa unggah), kaki
 *     Σ / Gross / Selisih, Simpan aktif hanya bila selisih Rp 0. Menyimpan
 *     membukukan baris kas Pembelian BBM sebesar Gross hari itu juga — atau
 *     mengikat baris yang sudah diketik manual (R29);
 *   · `?so=&tanggal=&rekening=&gross=` (dibuka U11 dari debit rekening koran):
 *     keempatnya tampil terkunci berlabel "dari rekening koran" (R11);
 *   · daftar penebusan bulan ini, daftar "SO belum tertaut" (R12), rekap pajak
 *     bulanan per unit & per PT + ekspor CSV (R13).
 *
 * R15 — debit Pertamina non-SO (KURANG BAYAR, biaya audit) TIDAK lewat halaman
 * ini: catat sebagai mutasi kas biasa (Pembelian BBM atau beban) dengan
 * referensi dari keterangan bank, di Input keuangan.
 *
 * Wewenang dihitung DI SERVER, satu predikat per tindakan:
 *   · baca     → `canViewLaporanKeuangan`
 *   · catat    → `canCatatPenebusan`
 *   · batalkan → `canBatalkanPenebusan`
 */
export default async function PenebusanPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ bulan?: string; so?: string; tanggal?: string; rekening?: string; gross?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canViewLaporanKeuangan(ctx)) notFound();

  const bulan = sp.bulan && bulanSah(sp.bulan) ? sp.bulan : todayWib().slice(0, 7);
  const bolehCatat = canCatatPenebusan(ctx);
  const bolehBatal = canBatalkanPenebusan(ctx);
  // Rekap per PT hanya bila SEMUA unit tenant ini dipegang (dan lebih dari satu).
  const unitPt = unitSatuPt(unit.code, scope.tenantPerUnit, scope.units);
  const adaRekapPt = unitPt !== null && unitPt.length > 1;

  const [rekening, rows, belumTertaut, rowsPt] = await Promise.all([
    bolehCatat ? getRekeningBank(unit.unit_id) : Promise.resolve([]),
    getPenebusanBulan([unit.unit_id], bulan),
    getSoBelumTertaut(unit.unit_id),
    adaRekapPt ? getPenebusanBulan(unitPt.map((u) => u.unit_id), bulan) : Promise.resolve(null),
  ]);

  // Isian awal dari rekening koran: hanya bila KEEMPATNYA ada & sah, dan
  // rekeningnya milik unit ini. Server tetap memeriksa ulang saat simpan.
  const grossAwal = sp.gross !== undefined && /^\d+$/.test(sp.gross) ? Number(sp.gross) : null;
  const isianAwal: IsianAwalPenebusan | null =
    sp.so && sp.so.trim() !== "" && sp.tanggal && DATE_RE.test(sp.tanggal) && grossAwal !== null && grossAwal > 0 &&
    sp.rekening && rekening.some((r) => r.id === sp.rekening)
      ? { noSo: sp.so.trim(), tanggalBayar: sp.tanggal, accountId: sp.rekening, gross: grossAwal }
      : null;

  const rekapUnit = rekapPajak(rows);
  const rekapPt = rowsPt === null ? null : rekapPajak(rowsPt);
  const ekspor = (cakupan: "unit" | "pt") =>
    `/api/keuangan/unit/${unit.code}/penebusan/${bulan}/csv${cakupan === "pt" ? "?cakupan=pt" : ""}`;

  return (
    <>
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={unit.code}
        segment="keuangan-penebusan"
      />
      <h1 className="text-h3 t-brand">Penebusan SO</h1>
      <div className="fs16 t-secondary mt2">
        {unit.name} · {unitLabel(unit.code)}
      </div>
      <p className="fs16 t-tertiary mt2">
        Satu pembayaran penebusan per nomor SO: Harga Net, PPN, PPh, PBBKB, dan Nota Debet/Kredit diketik dari bukti
        dan harus berjumlah tepat Harga Gross. Menyimpan langsung membukukan pembayaran bank-nya (kategori Pembelian
        BBM); bila baris itu sudah diketik di buku bank, penebusan mengikatnya — tidak dicatat dua kali. HPP tetap Harga
        Gross ÷ liter; komponen pajak dicatat terpisah untuk konsultan pajak. Debit Pertamina tanpa SO (mis. kurang bayar,
        biaya audit) dicatat sebagai mutasi kas biasa di Input keuangan, dengan keterangan bank sebagai referensinya.
      </p>

      <form method="get" className="keu-2col mt4">
        <label className="keu-fld">
          <span className="keu-label">Bulan</span>
          <input className="manual-input" type="month" name="bulan" defaultValue={bulan} />
        </label>
        <div className="manual-form-actions">
          <button type="submit" className="btn-outline sm">
            Tampilkan
          </button>
        </div>
      </form>

      {bolehCatat && (
        <section className="card card-pad-lg mt6" aria-labelledby="catat-penebusan">
          <h3 id="catat-penebusan" className="text-h3">
            Catat penebusan
          </h3>
          {rekening.length === 0 ? (
            <div className="empty-inline mt4">
              Unit ini belum punya rekening bank aktif — tambahkan di{" "}
              <a href={`/keuangan/unit/${unit.code}/akun-kas`}>Kelola akun kas</a>.
            </div>
          ) : (
            <PenebusanForm code={unit.code} rekening={rekening} isianAwal={isianAwal} />
          )}
        </section>
      )}

      <section className="card card-pad-lg mt6" aria-labelledby="daftar-penebusan">
        <div className="section-h">
          <h3 id="daftar-penebusan" className="text-h3">
            Penebusan {bulan}
          </h3>
          <span className="fs16 t-tertiary">{rows.length} SO</span>
        </div>
        <PenebusanTabel code={unit.code} rows={rows} bolehBatal={bolehBatal} />
      </section>

      <section className="card card-pad-lg mt6" aria-labelledby="so-belum-tertaut">
        <div className="section-h">
          <h3 id="so-belum-tertaut" className="text-h3">
            SO belum tertaut
          </h3>
          <span className="fs16 t-tertiary">{belumTertaut.length} SO</span>
        </div>
        <p className="fs16 t-tertiary mt2">
          Penebusan yang nomor SO-nya belum ditemukan di penebusan EasyMax — produk & volumenya belum bisa dibaca. Biasanya
          salah ketik nomor SO, atau EasyMax belum mencatat penebusannya.
        </p>
        {belumTertaut.length === 0 ? (
          <div className="empty-inline mt4">Semua penebusan sudah tertaut ke SO EasyMax.</div>
        ) : (
          <div className="tbl-scroll mt4">
            <table className="fs16">
              <thead>
                <tr>
                  <th className="left">SO</th>
                  <th className="left">Tanggal bayar</th>
                  <th className="left">Rekening</th>
                  <th className="right">Gross</th>
                </tr>
              </thead>
              <tbody>
                {belumTertaut.map((b) => (
                  <tr key={b.id}>
                    <td className="w600">{b.noSo}</td>
                    <td>{b.tanggalBayar}</td>
                    <td>{b.rekening}</td>
                    <td className="right num">{rpSen(b.grossSen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card card-pad-lg mt6" aria-labelledby="rekap-pajak">
        <h3 id="rekap-pajak" className="text-h3">
          Rekap pajak {bulan}
        </h3>
        <div className="tbl-scroll mt4">
          <table className="fs16">
            <thead>
              <tr>
                <th className="left">Cakupan</th>
                <th className="right">SO</th>
                <th className="right">Net</th>
                <th className="right">PPN</th>
                <th className="right">PPh</th>
                <th className="right">PBBKB</th>
                <th className="right">Gross</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <BarisRekap label={unit.name} t={rekapUnit} href={ekspor("unit")} />
              {rekapPt !== null && (
                <BarisRekap label={`${ptLabelForUnits(unitPt!.map((u) => u.code))} (semua unit)`} t={rekapPt} href={ekspor("pt")} />
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function BarisRekap({ label, t, href }: { label: string; t: TotalRekap; href: string }) {
  return (
    <tr>
      <td className="w600">{label}</td>
      <td className="right num">{t.n}</td>
      <td className="right num">{rpSen(t.netSen)}</td>
      <td className="right num">{rpSen(t.ppnSen)}</td>
      <td className="right num">{rpSen(t.pphSen)}</td>
      <td className="right num">{rpSen(t.pbbkbSen)}</td>
      <td className="right num w600">{rpSen(t.grossSen)}</td>
      <td>
        <a className="btn-outline sm" href={href}>
          Ekspor CSV
        </a>
      </td>
    </tr>
  );
}
