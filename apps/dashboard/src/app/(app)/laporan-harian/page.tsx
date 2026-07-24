import { Suspense } from "react";
import { HarianFilters } from "@/components/harian/HarianFilters";
import { GlBars, ShareBars, TrendSection } from "@/components/harian/HarianCharts";
import {
  HarianNotes,
  MatrixTable,
  MonthlyMatrix,
  RatioBbkTable,
  RecordCard,
  StaleBanner,
} from "@/components/harian/HarianSections";
import { HarianSkeleton } from "@/components/harian/HarianSkeleton";
import { mapLimit } from "@/lib/concurrency";
import { FLEET_RECORD_FLOOR, ptLabelForUnits, unitDotted } from "@/lib/config";
import { ago, dateLong, idn } from "@/lib/format";
import { getDailyGlWindow } from "@/lib/gl-window";
import { buildHarianModel, harianSpanFrom, type HarianModel } from "@/lib/harian-model";
import {
  defaultHarianDate,
  parseHarianParams,
  type HarianParams,
  type HarianSearchParams,
} from "@/lib/harian-params";
import { addDays, monthStart, todayWib } from "@/lib/periods";
import {
  getDailySalesByProduct,
  getSyncByUnit,
  getUnitCoverage,
  getZeroClosingEvents,
  type DailyGlRow,
} from "@/lib/queries";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

/**
 * LAPORAN HARIAN TOTAL — performa seluruh SPBU dalam satu layar.
 *
 * Menggantikan produk Excel manual yang berjalan hari ini, dengan tiga cacatnya
 * diperbaiki secara struktural (bukan disalin): seri Gain/Losses yang memakai
 * Rata-Rata untuk satu unit, TOTAL rekor yang tidak sama dengan jumlah
 * rinciannya, dan satuan "Ton" yang sebenarnya KL.
 *
 * ANGGARAN KONEKSI per request (pool `max: 5`, db.ts):
 *   1 grain penjualan (multi-unit) + 1 coverage + 1 sync + 1 penutup-nol
 *   (multi-unit) = 4 query, SERIAL terhadap seksi G/L; lalu G/L 7 unit dengan
 *   fan-out DIBATASI 2 (≤4 koneksi karena tiap jendela pecah jadi prefiks
 *   ter-cache + sufiks segar). Puncak ≈ 4, menyisakan 1 slot.
 *
 * CACHE, dengan jujur: default tanggal = KEMARIN, dan aturan gl-window hanya
 * men-cache `to ≤ hari-ini−2`. Jadi hari terpilih SELALU jatuh di sisi segar —
 * setengah dingin selamanya, tiap request. Anggaran di atas memakai asumsi itu,
 * bukan asumsi cache. Memilih tanggal ≤ hari-ini−2 justru lebih cepat.
 */
export default async function LaporanHarianPage({
  searchParams,
}: {
  searchParams: HarianSearchParams;
}) {
  const scope = await getDataScope();
  const today = todayWib();
  // KEAMANAN: unit dari URL di-intersect dgn scope DI SINI (server).
  const params = parseHarianParams(searchParams, scope.units);

  if (scope.units.length === 0) {
    return (
      <div className="empty-hero">
        <div className="empty-hero-icon">📊</div>
        <h1 className="text-h4 t-brand mt5">Belum ada SPBU dalam akses Anda</h1>
        <p className="empty-hero-p fs16 t-secondary">
          Hubungi admin perusahaan untuk mendapatkan akses unit.
        </p>
      </div>
    );
  }

  const filterProps = {
    units: params.units.length
      ? scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))
      : [],
    selected: params.units.map((u) => u.code),
    allUnits: params.allUnits,
    date: params.date,
    maxDate: today,
    defaultDate: defaultHarianDate(),
  };

  const bodyKey = JSON.stringify([filterProps.selected, params.date]);

  return (
    <div>
      <HarianFilters {...filterProps} />
      <Suspense key={bodyKey} fallback={<HarianSkeleton />}>
        <HarianBody params={params} today={today} />
      </Suspense>
    </div>
  );
}

// ---------------------------------------------------------------------------

async function HarianBody({ params, today }: { params: HarianParams; today: string }) {
  const { units, date } = params;
  const unitIds = units.map((u) => u.unit_id);
  const spanFrom = harianSpanFrom(date, FLEET_RECORD_FLOOR);
  const mFrom = monthStart(date);

  const t0 = Date.now();
  // Empat query multi-unit — satu tembakan masing-masing.
  const [dailySales, coverage, sync, zeros] = await Promise.all([
    getDailySalesByProduct(unitIds, spanFrom, date),
    getUnitCoverage(unitIds),
    getSyncByUnit(unitIds),
    // Penutup opname bernilai 0 di bulan berjalan. Dipindai s/d D+1 (dibatasi
    // hari ini) karena aturannya butuh penutup hari BERIKUTNYA sebagai pembanding.
    getZeroClosingEvents(unitIds, mFrom, addDays(date, 1) > today ? today : addDays(date, 1)),
  ]);

  /**
   * SATU jendela G/L per unit — [awal bulan .. D]. Seksi HARIAN memfilter baris
   * `d === D` dari jendela yang sama, bukan query kedua: tiap baris harian
   * `getDailyGlByProduct` dihitung mandiri (lookback 365 hari menyediakan anchor
   * Fisik(D−1) & jendela celah), jadi baris hari-D identik apa pun titik awal
   * jendelanya. Invarian itu diuji sendiri di harian.integration.test.ts —
   * TIDAK menumpang test board.
   */
  const tSales = Date.now();
  const msSales = tSales - t0;
  const glPairs = await mapLimit(units, 2, async (u) => {
    const rows = await getDailyGlWindow(u.unit_id, mFrom, date);
    return [u.unit_id as number, rows] as const;
  });
  const gl = new Map<number, DailyGlRow[]>(glPairs);
  const msGl = Date.now() - tSales;

  const model = buildHarianModel({
    units,
    date,
    dailySales,
    gl,
    coverage,
    sync,
    glSuspect: new Set(zeros.map((z) => z.unit_id)),
    recordFloor: FLEET_RECORD_FLOOR,
  });

  const hasAny = model.daily.grandTotal > 0 || model.monthly.grand.kum > 0;

  /**
   * INSTRUMENTASI — satu baris JSON per render ke Cloud Run logs (pola
   * /api/warm-board). Dipasang SEJAK MENIT PERTAMA halaman ini hidup, bukan
   * menyusul: latensi produksi tak bisa diukur dari laptop maupun dari
   * `-rlsstg` (DB test tak berskala produksi), jadi log inilah satu-satunya
   * sumber angka yang sah. `cold` = hari terpilih ada di sisi tak-ter-cache
   * gl-window (to > hari-ini−2) — selalu true untuk default "kemarin".
   */
  console.log(
    JSON.stringify({
      msg: "laporan-harian",
      date,
      units: units.length,
      ms_total: Date.now() - t0,
      ms_sales: msSales,
      ms_gl: msGl,
      cold: date > addDays(today, -2),
      rows_sales: dailySales.length,
      stale: model.freshness.staleUnits.length,
      provisional: model.glProvisional,
    }),
  );

  return (
    <div>
      <HarianHead model={model} scopeLabel={ptLabelForUnits(units.map((u) => u.code))} />
      <StaleBanner model={model} />

      {!hasAny ? (
        <div className="card card-pad-lg mt5 empty-inline">
          Belum ada penjualan tersinkron untuk {dateLong(date)} pada unit yang dipilih.
        </div>
      ) : (
        <>
          <SummaryCards model={model} />

          <MatrixTable
            title="Omzet penjualan — harian"
            hint={`${dateLong(date)} · liter`}
            units={model.units}
            rows={model.daily.rows}
            totalsByUnit={model.daily.totalsByUnit}
            grandTotal={model.daily.grandTotal}
            incomplete={model.freshness.incomplete}
            delta={model.deltaByUnit}
            deltaTotal={model.deltaTotal}
          />

          <ShareBars share={model.share} incomplete={model.freshness.incomplete} />

          <MatrixTable
            title="Gain / Losses — harian"
            hint={`${dateLong(date)} · liter · metode RESUME operasional`}
            units={model.units}
            rows={model.glDaily.rows}
            totalsByUnit={model.glDaily.totalsByUnit}
            grandTotal={model.glDaily.grandTotal}
            incomplete={model.freshness.incomplete}
            signTone
            provisional={model.glProvisional}
            glIncomplete={model.glIncomplete}
          />

          <MonthlyMatrix
            title="Omzet penjualan — bulanan (MTD)"
            hint={`1 – ${date.slice(8)} ${dateLong(date).split(" ").slice(2).join(" ")} · liter`}
            units={model.units}
            rows={model.monthly.rows}
            totalsByUnit={model.monthly.totalsByUnit}
            grand={model.monthly.grand}
            divisor={model.avgDivisor}
            incomplete={model.freshness.incomplete}
          />

          <GlBars units={model.units} totals={model.glMonthly.totalsByUnit} />

          <MonthlyMatrix
            title="Gain / Losses — bulanan (MTD)"
            hint="liter · Kumulatif & Rata-Rata"
            units={model.units}
            rows={model.glMonthly.rows}
            totalsByUnit={model.glMonthly.totalsByUnit}
            grand={model.glMonthly.grand}
            divisor={model.avgDivisor}
            incomplete={model.freshness.incomplete}
            signTone
            glIncomplete={model.glIncomplete}
          />

          <TrendSection
            units={model.units}
            months={model.trend.months}
            barMaxKum={model.trend.barMaxKum}
            totalMaxKum={model.trend.totalMaxKum}
            barMaxAvg={model.trend.barMaxAvg}
            totalMaxAvg={model.trend.totalMaxAvg}
          />

          <RatioBbkTable units={model.units} model={model} />
          <RecordCard units={model.units} model={model} />
          <HarianNotes notes={model.notes} />
        </>
      )}

      <div className="page-foot mt8">
        <span>Sumber: EasyMax POS · volume dalam liter · grafik 13 bulan dalam KL</span>
        <span>Zona waktu WIB (Asia/Pontianak)</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function HarianHead({ model, scopeLabel }: { model: HarianModel; scopeLabel: string }) {
  const f = model.freshness;
  return (
    <div className="board-head mt4">
      <div>
        <div className="text-eyebrow t-tertiary">
          {scopeLabel} · {model.units.length} SPBU
        </div>
        <h1 className="text-h3 t-brand mt2">Laporan Harian Total — {dateLong(model.date)}</h1>
        <div className="fs15 t-tertiary mt2">
          {/* MIN lintas unit: menyebut unit TERBURUK, bukan yang paling segar. */}
          {f.worstSyncAt
            ? `Sinkron terlama: ${f.worstSyncUnit?.name ?? "—"}, ${ago(f.worstSyncAt)}`
            : "Ada unit yang belum pernah tersinkron"}
        </div>
      </div>
    </div>
  );
}

function SummaryCards({ model }: { model: HarianModel }) {
  const d = model.daily.grandTotal;
  const m = model.monthly.grand;
  const gd = model.glDaily.grandTotal;
  const gm = model.glMonthly.grand.kum;
  const sfx = model.freshness.incomplete ? " ≥" : "";
  const cards = [
    { k: "hari", t: "Total hari ini (liter)", v: `${idn(Math.round(d))}${sfx}`, sub: model.deltaTotal === null ? "Δ vs kemarin —" : `Δ vs kemarin ${idn(Math.round(model.deltaTotal))}` },
    { k: "mtd", t: "Total bulan berjalan (liter)", v: `${idn(Math.round(m.kum))}${sfx}`, sub: `rata-rata ${idn(Math.round(m.avg))} L/hari (÷${model.avgDivisor})` },
    { k: "gld", t: "Gain / Losses hari ini (liter)", v: idn(Math.round(gd)), sub: gd < 0 ? "losses" : "gain" },
    { k: "glm", t: "Gain / Losses bulan berjalan", v: idn(Math.round(gm)), sub: gm < 0 ? "losses" : "gain" },
  ];
  return (
    <div className="kpi-grid harian-kpi mt8">
      {cards.map((c) => (
        <div key={c.k} className="kpi-card">
          <div className="text-caption t-tertiary">{c.t}</div>
          <div className="text-h2 t-primary num mt2">{c.v}</div>
          <div className="kpi-note">
            <span className="fs15 t-tertiary">{c.sub}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
