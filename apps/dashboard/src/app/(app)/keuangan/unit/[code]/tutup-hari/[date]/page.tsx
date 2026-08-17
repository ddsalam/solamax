import { notFound } from "next/navigation";
import { TutupHariPanel } from "@/components/keuangan/TutupHariPanel";
import { unitLabel } from "@/lib/config";
import {
  getBackdateOverride,
  getDayClose,
  getKelengkapanInput,
} from "@/lib/keuangan-input-queries";
import { getBahanLaporan } from "@/lib/keuangan-laporan-queries";
import { panelBalance, panelCashFlow, panelIncome } from "@/lib/keuangan-laporan-model";
import { bolehMenutup, tierFor } from "@/lib/keuangan-tutup-hari";
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

  const [bahan, dayClose, overrides, kelengkapan, reasonCodes] = await Promise.all([
    getBahanLaporan(unit.unit_id, date, kemarin),
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
      <h1 className="text-h3 t-brand">Tutup hari</h1>
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
