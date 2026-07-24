import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { GlBars, ShareBars, TrendSection } from "@/components/harian/HarianCharts";
import {
  HarianNotes,
  MatrixTable,
  MonthlyMatrix,
  RatioBbkTable,
  RecordCard,
  StaleBanner,
} from "@/components/harian/HarianSections";
import { FLEET_RECORD_FLOOR } from "./config";
import { dateLong, idn } from "./format";
import { buildHarianModel, harianSpanFrom, type HarianModel } from "./harian-model";
import { addDays, monthStart } from "./periods";
import type { DailyGlRow } from "./queries";

/**
 * HARNESS VERIFIKASI VISUAL — merender seksi Laporan Harian dari data LIVE ke
 * satu berkas HTML yang bisa dibuka & dilihat dengan mata.
 *
 * Kenapa begini dan bukan buka halamannya di browser: halaman terkunci Google
 * OAuth (sesi DB), dan saya tidak boleh menangani kredensial atau token sesi.
 * Harness ini memakai KOMPONEN dan MODEL yang sama persis dengan halaman, hanya
 * melewati lapisan auth/routing — jadi yang diperiksa mata memang yang dirender
 * produksi. Pelajaran proyek: grafik pernah lolos DUA guard hijau dalam keadaan
 * rusak secara visual; assertion struktural saja tidak cukup.
 *
 *   SCOPE_LIVE_DB=1 HARIAN_RENDER=1 vitest run src/lib/harian.render.test.tsx
 */
const LIVE = process.env.SCOPE_LIVE_DB === "1" && process.env.HARIAN_RENDER === "1";
const d = LIVE ? describe : describe.skip;

const OUT = process.env.HARIAN_RENDER_OUT ?? "/tmp/harian-render.html";
const DATE = process.env.HARIAN_RENDER_DATE ?? "2026-07-22";
const CSS = [
  "styles/ds/tokens/colors.css",
  "styles/ds/tokens/typography.css",
  "styles/ds/tokens/spacing.css",
  "styles/ds/tokens/elevation.css",
  "styles/ds/tokens/motion.css",
  "styles/ds/tokens/layout.css",
  "styles/ds/base.css",
  "styles/app.css",
];

d("render Laporan Harian dari data live", () => {
  afterAll(async () => {
    const { pool } = await import("./db");
    await pool.end();
  });

  it(
    "menulis HTML yang bisa diperiksa mata",
    async () => {
      const Q = await import("./queries");
      const { q } = await import("./db");
      type SUID = Parameters<typeof Q.getDailyGlByProduct>[0];

      const rows = await q<{ unit_id: number; code: string; name: string }>(
        `SELECT unit_id, code, name FROM public.unit WHERE active ORDER BY unit_id`,
      );
      const units = rows.map((u) => ({ unit_id: u.unit_id as SUID, code: u.code, name: u.name }));
      const ids = units.map((u) => u.unit_id);
      const mFrom = monthStart(DATE);

      const [dailySales, coverage, sync, zeros] = await Promise.all([
        Q.getDailySalesByProduct(ids, harianSpanFrom(DATE, FLEET_RECORD_FLOOR), DATE),
        Q.getUnitCoverage(ids),
        Q.getSyncByUnit(ids),
        Q.getZeroClosingEvents(ids, mFrom, addDays(DATE, 1)),
      ]);
      const gl = new Map<number, DailyGlRow[]>();
      // getDailyGlWindow memakai unstable_cache yang hanya hidup di runtime Next;
      // di harness pakai query dasarnya — jendela & hasilnya identik (invarian
      // union-span yang juga diuji terpisah di harian.integration.test.ts).
      for (const u of units) gl.set(u.unit_id as number, await Q.getDailyGlByProduct(u.unit_id, mFrom, DATE));

      /**
       * SIMULASI DATA BASI (HARIAN_RENDER_STALE=<kode,kode>): membuang baris
       * tanggal-D untuk unit tertentu, meniru persis insiden agent Bakau mati.
       * Dipakai untuk MELIHAT banner + tanda kolom + freshness MIN benar-benar
       * muncul — bukan sekadar percaya test unit. Data produksi tidak disentuh.
       */
      const staleCodes = (process.env.HARIAN_RENDER_STALE ?? "").split(",").filter(Boolean);
      const staleIds = new Set(
        units.filter((u) => staleCodes.includes(u.code)).map((u) => u.unit_id as number),
      );
      const salesForModel = staleIds.size
        ? dailySales.filter((r) => !(staleIds.has(r.unit_id) && r.d >= addDays(DATE, -1)))
        : dailySales;

      const model = buildHarianModel({
        units,
        date: DATE,
        dailySales: salesForModel,
        gl,
        coverage,
        sync,
        glSuspect: new Set(zeros.map((z) => z.unit_id)),
        recordFloor: FLEET_RECORD_FLOOR,
      });

      // Angka kunci dicetak agar bisa dibandingkan dengan laporan Excel.
      console.log(
        JSON.stringify({
          date: DATE,
          divisor: model.avgDivisor,
          harianPerUnit: Object.fromEntries(
            model.units.map((u) => [u.name, Math.round(model.daily.totalsByUnit[u.unitId] ?? 0)]),
          ),
          harianTotal: Math.round(model.daily.grandTotal),
          mtdPerUnit: Object.fromEntries(
            model.units.map((u) => [u.name, Math.round(model.monthly.totalsByUnit[u.unitId]?.kum ?? 0)]),
          ),
          mtdTotal: Math.round(model.monthly.grand.kum),
          glHarian: Object.fromEntries(
            model.units.map((u) => [u.name, Math.round(model.glDaily.totalsByUnit[u.unitId] ?? 0)]),
          ),
          record: { date: model.record.date, total: Math.round(model.record.total) },
          stale: model.freshness.staleUnits.map((s) => `${s.name}:-${s.daysBehind}`),
          zeros: zeros.map((z) => `${z.unit_id}/${z.d}/${z.ckdtangki}`),
          notes: model.notes.length,
        }),
      );

      const body = renderToStaticMarkup(<Page model={model} />);
      const css = CSS.map((f) => readFileSync(join(__dirname, "..", f), "utf8")).join("\n");
      writeFileSync(
        OUT,
        `<!doctype html><meta charset="utf-8"><title>Laporan Harian ${DATE}</title>
<style>${css}</style><body><div class="shell"><nav class="sidebar" style="height:100vh"></nav><main class="main page">${body}</main></div></body>`,
      );
      expect(body.length).toBeGreaterThan(5000);
      console.log(`HTML → ${OUT} (${body.length} byte markup)`);
    },
    { timeout: 900_000 },
  );
});

function Page({ model }: { model: HarianModel }) {
  return (
    <div>
      <div className="board-head mt4">
        <div>
          <div className="text-eyebrow t-tertiary">SolaGroup · {model.units.length} SPBU</div>
          <h1 className="text-h3 t-brand mt2">Laporan Harian Total — {dateLong(model.date)}</h1>
        </div>
      </div>
      <StaleBanner model={model} />
      <div className="kpi-grid harian-kpi mt8">
        {[
          ["Total hari ini (liter)", idn(Math.round(model.daily.grandTotal))],
          ["Total bulan berjalan (liter)", idn(Math.round(model.monthly.grand.kum))],
          ["Gain / Losses hari ini", idn(Math.round(model.glDaily.grandTotal))],
          ["Gain / Losses bulan berjalan", idn(Math.round(model.glMonthly.grand.kum))],
        ].map(([t, v]) => (
          <div key={t} className="kpi-card">
            <div className="text-caption t-tertiary">{t}</div>
            <div className="text-h2 t-primary num mt2">{v}</div>
          </div>
        ))}
      </div>
      <MatrixTable
        title="Omzet penjualan — harian"
        hint={`${dateLong(model.date)} · liter`}
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
        hint="liter · metode RESUME operasional"
        units={model.units}
        rows={model.glDaily.rows}
        totalsByUnit={model.glDaily.totalsByUnit}
        grandTotal={model.glDaily.grandTotal}
        incomplete={model.freshness.incomplete}
        signTone
        provisional={model.glProvisional}
      />
      <MonthlyMatrix
        title="Omzet penjualan — bulanan (MTD)"
        hint="liter"
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
        hint="liter"
        units={model.units}
        rows={model.glMonthly.rows}
        totalsByUnit={model.glMonthly.totalsByUnit}
        grand={model.glMonthly.grand}
        divisor={model.avgDivisor}
        incomplete={model.freshness.incomplete}
        signTone
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
    </div>
  );
}
