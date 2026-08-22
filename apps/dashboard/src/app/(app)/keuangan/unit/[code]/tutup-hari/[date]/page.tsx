import { notFound } from "next/navigation";
import { todayWib } from "@/lib/periods";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { TutupHariPanel } from "@/components/keuangan/TutupHariPanel";
import { ptLabelForUnits, unitDotted, unitLabel } from "@/lib/config";
import { TutupHariExportMount } from "@/components/keuangan/TutupHariExportMount";
import { buildReportFilename } from "@/lib/export/filename";
import { dateShort, timeWib } from "@/lib/format";
import {
  getBackdateOverride,
  getDayClose,
  getKelengkapanInput,
} from "@/lib/keuangan-input-queries";
import { getBahanLaporan } from "@/lib/keuangan-laporan-queries";
import { panelBalance, panelCashFlow, panelIncome } from "@/lib/keuangan-laporan-model";
import { bolehMenutup, tierFor } from "@/lib/keuangan-tutup-hari";
import { pastikanBarisDayClose } from "@/lib/tutup-hari-actions";
import { canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { qScoped } from "@/lib/db";
import { getDataScope } from "@/lib/scope";
import { DATE_RE } from "@/lib/selection-keys";

export const dynamic = "force-dynamic";

/**
 * LAYAR 4 — gerbang tutup hari (mockup layar 4).
 *
 * Satu-satunya layar yang benar-benar baru: spreadsheet bisa menghitung angka
 * pemeriksa, ia tidak bisa **menolak hari berikutnya**.
 *
 * Gerbang BACA sama dengan Layar 2 (§10.13). Gerbang TUTUP bertingkat (§3.2),
 * dan dihitung DI SERVER lewat `bolehMenutup` — layar hanya menerima hasilnya.
 */
export default async function TutupHariPage({
  params,
}: {
  params: Promise<{ code: string; date: string }>;
}) {
  const { code, date } = await params;
  if (!DATE_RE.test(date)) notFound();

  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  if (!canViewLaporanKeuangan({ role: scope.role, email: scope.email })) notFound();

  const kemarin = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);

  const bahanAwal = await getBahanLaporan(unit.unit_id, date, kemarin);
  const bsAwal = panelBalance({
    cashOnHand: bahanAwal.kasAkhir,
    inventoryValue: bahanAwal.totals.inventoryValue,
    soValue: bahanAwal.totals.soValue,
    piutangEasymax: bahanAwal.piutangEasymax,
    hutangPiutangNonEasymax: bahanAwal.hutangPiutangNonEasymax,
    openedRetainedEarnings: null,
    netIncome:
      panelIncome({
        totals: bahanAwal.totals,
        beban: bahanAwal.beban,
        pendapatanLain: bahanAwal.pendapatanLain,
        incomeAdjustment: null,
      }).baris.find((x) => x.label === "Net profit")!.nilai ?? 0,
    incomeAdjustment: null,
    totalAssetKemarin: bahanAwal.totalAssetKemarin,
    deltaKontribusi: null,
  });
  // §10.15 — barisnya lahir SAAT HALAMAN DIBUKA, bukan dari job harian. Baris
  // yang sudah TERTUTUP tidak pernah disentuh (dijaga `WHERE status='open'`).
  await pastikanBarisDayClose(unit.unit_id, date, bsAwal.langkahHarian);

  const [bahan, dayClose, overrides, kelengkapan, reasonCodes] = await Promise.all([
    Promise.resolve(bahanAwal),
    getDayClose(unit.unit_id, date),
    getBackdateOverride(unit.unit_id, date),
    getKelengkapanInput(unit.unit_id, date),
    qScoped<{ code: string; label: string; requiresTarget: boolean }>(
      unit.unit_id,
      `SELECT code, label, requires_target_date AS "requiresTarget"
         FROM app.reason_code
        WHERE applies_to = 'closing' AND active
        ORDER BY code`,
    ),
  ]);

  const cf = panelCashFlow({
    kasAwalPerAkun: bahan.kasAwalPerAkun,
    kasAkhir: bahan.kasAkhir,
    omzet: bahan.totals.revenue,
    teraValue: bahan.totals.teraValue,
    transaksiPiutangEasymax: bahan.deltaPiutangEasymax,
    hutangPiutangNonEasymax: bahan.arusHutangPiutangNonEasymax,
    penebusanSo: bahan.penebusanSo,
    pendapatanLain: bahan.pendapatanLain,
    biayaOperasional: -bahan.beban.reduce((s, x) => s + x.amountRp, 0),
  });
  const is = panelIncome({
    totals: bahan.totals,
    beban: bahan.beban,
    pendapatanLain: bahan.pendapatanLain,
    incomeAdjustment: null,
  });
  const bs = panelBalance({
    cashOnHand: bahan.kasAkhir,
    inventoryValue: bahan.totals.inventoryValue,
    soValue: bahan.totals.soValue,
    piutangEasymax: bahan.piutangEasymax,
    hutangPiutangNonEasymax: bahan.hutangPiutangNonEasymax,
    openedRetainedEarnings: null,
    netIncome: is.baris.find((x) => x.label === "Net profit")!.nilai ?? 0,
    incomeAdjustment: null,
    totalAssetKemarin: bahan.totalAssetKemarin,
    deltaKontribusi: null,
  });

  // Wewenang dihitung DI SERVER. Layar tidak boleh menyimpulkannya sendiri —
  // kesimpulan klien bisa dibuat benar dengan mengubah state di peramban.
  const bolehMenutupTier =
    bs.langkahHarian === null
      ? false
      : bolehMenutup(tierFor(bs.langkahHarian), { role: scope.role, email: scope.email });

  return (
    <>
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={unit.code}
        segment="keuangan-tutup-hari"
        date={date}
        today={todayWib()}
        maxDate={todayWib()}
      />
      <div className="section-h">
        <h1 className="text-h3 t-brand">Tutup hari</h1>
        {/* §10.20 — mockup tak memintanya; ini keputusan owner 21 Agu 2026.
            Hari yang BELUM ditutup pun boleh dicetak, dan kertasnya berkata begitu. */}
        <TutupHariExportMount
          kop={{
            ptLabel: ptLabelForUnits([unit.code]),
            judul: "Lembar penutupan hari",
            subjudul: `${unit.name} · ${unitLabel(unit.code)} — ${date}`,
            generatedLabel: `${dateShort(date)} · ${timeWib(new Date().toISOString())}`,
            dicetakOleh: scope.email ?? "",
          }}
          filename={buildReportFilename({
            reportName: "Lembar-Penutupan-Hari",
            unitCode: unit.code,
            period: date,
            generated: date,
          })}
          dayClose={dayClose}
          langkahHarian={bs.langkahHarian}
          tier={bs.langkahHarian === null ? null : tierFor(bs.langkahHarian)}
          overrides={overrides}
          labelReason={Object.fromEntries(reasonCodes.map((r) => [r.code, r.label]))}
        />
      </div>
      <div className="fs16 t-secondary mt2">
        {unit.name} · {unitLabel(unit.code)} — {date}
      </div>

      <div className="mt6">
        <TutupHariPanel
          code={unit.code}
          date={date}
          langkahHarian={bs.langkahHarian}
          cashFlowCheck={cf.pemeriksa.nilai}
          kelengkapan={kelengkapan}
          reasonCodes={reasonCodes}
          overrides={overrides}
          sudahDitutup={dayClose?.status === "closed"}
          bolehMenutupTier={bolehMenutupTier}
        />
      </div>
    </>
  );
}
