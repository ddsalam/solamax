import { notFound } from "next/navigation";
import { PanelLaporanKeuangan } from "@/components/keuangan/PanelLaporanKeuangan";
import { ptLabelForUnits, unitLabel } from "@/lib/config";
import { LaporanKeuanganExportMount } from "@/components/keuangan/LaporanKeuanganExportMount";
import { buildReportFilename } from "@/lib/export/filename";
import { dateShort, timeWib } from "@/lib/format";
import { getBahanLaporan } from "@/lib/keuangan-laporan-queries";
import {
  CATATAN_NILAI_DO,
  panelBalance,
  panelCashFlow,
  panelIncome,
  nadaPemeriksa,
} from "@/lib/keuangan-laporan-model";
import { canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { getDataScope } from "@/lib/scope";
import { DATE_RE } from "@/lib/selection-keys";

export const dynamic = "force-dynamic";

/**
 * LAYAR 2 — Laporan keuangan harian (mockup layar 2). **READ-ONLY.**
 *
 * Susunan dan penamaan mengikuti sheet `LaporanHarian` yang sudah dipakai tim
 * keuangan; satu-satunya tambahan adalah **margin bersih dalam persen**, dan
 * satu-satunya perubahan susunan adalah **ketiga angka pemeriksa naik pangkat
 * jadi bagian laporan** alih-alih sel tersembunyi.
 *
 * Gerbang BACA: `canViewLaporanKeuangan` (§10.13) — **pengawas tidak termasuk**.
 * Tak ada satu pun aksi tulis di layar ini; penutupan hari milik Layar 4.
 */
export default async function LaporanKeuanganPage({
  params,
}: {
  params: Promise<{ code: string; date: string }>;
}) {
  const { code, date } = await params;
  if (!DATE_RE.test(date)) notFound();

  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  // 404 identik dengan unit di luar scope: halaman yang menjawab "ada, tapi
  // Anda tak boleh" tetap memberi tahu bahwa ia ada.
  if (!canViewLaporanKeuangan({ role: scope.role, email: scope.email })) notFound();

  const kemarin = hariSebelum(date);
  const b = await getBahanLaporan(unit.unit_id, date, kemarin);

  const cf = panelCashFlow({
    kasAwalPerAkun: b.kasAwalPerAkun,
    kasAkhir: b.kasAkhir,
    omzet: b.totals.revenue,
    teraValue: b.totals.teraValue,
    transaksiPiutangEasymax: b.deltaPiutangEasymax,
    hutangPiutangNonEasymax: b.arusHutangPiutangNonEasymax,
    penebusanSo: b.penebusanSo,
    pendapatanLain: b.pendapatanLain,
    biayaOperasional: -b.beban.reduce((s, x) => s + x.amountRp, 0),
  });

  const is = panelIncome({
    totals: b.totals,
    beban: b.beban,
    pendapatanLain: b.pendapatanLain,
    incomeAdjustment: null,
  });

  const netProfit = is.baris.find((x) => x.label === "Net profit")!.nilai ?? 0;
  const bs = panelBalance({
    cashOnHand: b.kasAkhir,
    inventoryValue: b.totals.inventoryValue,
    soValue: b.totals.soValue,
    piutangEasymax: b.piutangEasymax,
    hutangPiutangNonEasymax: b.hutangPiutangNonEasymax,
    openedRetainedEarnings: null,
    netIncome: netProfit,
    incomeAdjustment: null,
    totalAssetKemarin: b.totalAssetKemarin,
    deltaKontribusi: null,
  });

  return (
    <>
      <div className="section-h">
        <h1 className="text-h3 t-brand">Laporan keuangan harian</h1>
        {/* "Cetak PDF" (mockup Layar 2). Panelnya diserahkan apa adanya —
            PDF tidak menghitung ulang apa pun. */}
        <LaporanKeuanganExportMount
          kop={{
            // PT unit INI, bukan payung — cakupannya satu unit.
            ptLabel: ptLabelForUnits([unit.code]),
            judul: "Laporan keuangan harian",
            subjudul: `${unit.name} · ${unitLabel(unit.code)} — ${date}`,
            generatedLabel: `${dateShort(date)} · ${timeWib(new Date().toISOString())}`,
            dicetakOleh: scope.email ?? "",
          }}
          filename={buildReportFilename({
            reportName: "Laporan-Keuangan-Harian",
            unitCode: unit.code,
            period: date,
            generated: date,
          })}
          cashFlow={cf}
          income={is}
          balance={bs}
          incomplete={b.incomplete}
          catatanNilaiDo={CATATAN_NILAI_DO}
        />
      </div>
      <div className="fs16 t-secondary mt2">
        {unit.name} · {unitLabel(unit.code)} — {date}
      </div>
      <p className="fs16 t-tertiary mt2">
        Susunan dan penamaannya mengikuti sheet <em>LaporanHarian</em> yang sudah dipakai tim
        keuangan — supaya tidak ada yang perlu belajar membaca laporan baru.
      </p>

      {b.incomplete.length > 0 && (
        <div className="banner warning keu-banner" role="status">
          <b>{b.incomplete.length} produk belum lengkap datanya</b>
          <p className="keu-p">
            {b.incomplete.join(", ")} — pos yang bergantung padanya <strong>dilewati</strong>
            dalam penjumlahan, tidak diperlakukan sebagai nol. Itulah sebabnya sebagian angka di
            bawah bisa berbunyi &quot;belum bisa dihitung&quot;.
          </p>
        </div>
      )}

      <div className="lap3 mt6">
        <PanelLaporanKeuangan judul="Cash Flow" panel={cf} />
        <PanelLaporanKeuangan judul="Income Statement" panel={is} />
        <PanelLaporanKeuangan
          judul="Balance Sheet"
          panel={bs}
          catatan={
            <>
              {/* ⚠️ Batas yang HARUS ikut ke layar, bukan hanya ke dokumen. */}
              <p className="keu-p">
                {/* SATU sumber dengan PDF — lihat CATATAN_NILAI_DO. */}
                ⚠️ {CATATAN_NILAI_DO}
              </p>
              <p className="keu-p">
                <strong>Langkah harian:</strong>{" "}
                {bs.langkahHarian === null ? (
                  "belum bisa dihitung — butuh total asset kemarin."
                ) : (
                  <span className={nadaPemeriksa(bs.langkahHarian) === "baik" ? "" : "t-danger"}>
                    {bs.langkahHarian.toLocaleString("id-ID")}
                  </span>
                )}{" "}
                — inilah yang berarti. Nilai kumulatif di atas adalah residu yang tak pernah
                dinolkan; ia <strong>bukan</strong> kesalahan hari ini.
              </p>
            </>
          }
        />
      </div>
    </>
  );
}

/** Tanggal bisnis satu hari sebelum `date` — UTC murni, bebas zona waktu. */
function hariSebelum(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}
