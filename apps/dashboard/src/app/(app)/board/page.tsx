import Link from "next/link";
import { Suspense } from "react";
import { AnomalyFeed } from "@/components/AnomalyFeed";
import { BoardExport } from "@/components/board/BoardExport";
import { BoardFilters } from "@/components/board/BoardFilters";
import { RankingTable } from "@/components/board/RankingTable";
import { TrendChart } from "@/components/board/TrendChart";
import { buildAnomalies } from "@/lib/anomalies";
import {
  buildBoardCore,
  buildBoardEval,
  type BoardCore,
  type BoardEval,
  type DeltaCell,
} from "@/lib/board-model";
import { parseBoardParams, type BoardParams, type BoardSearchParams } from "@/lib/board-params";
import { ptLabelForUnits, unitDotted } from "@/lib/config";
import { dateLong, dateShort, pct as pctS, signed as signedS, timeWib } from "@/lib/format";
import { getDailyGlWindow } from "@/lib/gl-window";
import { addDays, todayWib, type DateRange } from "@/lib/periods";
import { getDailySalesByProduct, getShiftInfo, getUnitCoverage } from "@/lib/queries";
import { getDataScope } from "@/lib/scope";
import type { BoardDocMeta } from "@/lib/export/board-doc";

export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: BoardSearchParams;
}) {
  const scope = await getDataScope();
  const today = todayWib();
  // KEAMANAN: unit dari URL di-intersect dgn scope DI SINI (server) — lihat
  // parseBoardParams. Semua query di bawah hanya menerima unit hasil intersect.
  const params = parseBoardParams(searchParams, scope.units);

  if (scope.units.length === 0) return <BoardNoUnits />;

  const filterProps = {
    units: scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) })),
    selected: params.units.map((u) => u.code),
    allUnits: params.allUnits,
    pkey: params.period.key,
    from: params.period.range.from,
    to: params.period.range.to,
    mode: params.mode,
    today,
  };

  // key memaksa Suspense fallback muncul lagi saat filter berubah (soft nav).
  const bodyKey = JSON.stringify([filterProps.selected, params.period.range, params.mode]);

  return (
    <div>
      <BoardFilters {...filterProps} />
      <Suspense key={bodyKey} fallback={<BoardSkeleton />}>
        <BoardBody params={params} today={today} />
      </Suspense>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Body — data jendela AKTIF (cepat); pembanding MoM/YoY/YTD distream menyusul
// ---------------------------------------------------------------------------

const isoMin = (...ds: string[]): string => ds.reduce((a, b) => (b < a ? b : a));

async function BoardBody({ params, today }: { params: BoardParams; today: string }) {
  const { units, period, mode } = params;
  const range = period.range;

  // Union span grain sales: mencakup SEMUA jendela + 14 hari mini-spark ranking.
  const spanFrom = isoMin(
    period.ytd.prev.from,
    period.yoy.prev.from,
    period.mom.prev.from,
    range.from,
    addDays(range.to, -13),
  );

  const glWindow = async (r: DateRange) =>
    new Map(
      await Promise.all(
        units.map(async (u) => [u.unit_id as number, await getDailyGlWindow(u.unit_id, r.from, r.to)] as const),
      ),
    );

  const [dailySales, coverageRows, shiftPairs, anomalies, glRange] = await Promise.all([
    getDailySalesByProduct(units.map((u) => u.unit_id), spanFrom, range.to),
    getUnitCoverage(units.map((u) => u.unit_id)),
    Promise.all(units.map(async (u) => [u.unit_id as number, await getShiftInfo(u.unit_id, today)] as const)),
    buildAnomalies(units),
    glWindow(range),
  ]);

  const core = buildBoardCore({
    units,
    period,
    mode,
    today,
    dailySales,
    glRange,
    shift: new Map(shiftPairs),
    anomalies,
  });

  const hasData = dailySales.some((r) => r.d >= range.from && r.d <= range.to && r.vol > 0);
  if (!hasData) return <BoardNoData isToday={period.key === "today"} />;

  // Pembanding (berat: G/L jendela panjang) — TIDAK di-await di sini; anak-anak
  // Suspense yang menunggu (KPI eval lines, tabel evaluasi, tombol ekspor).
  const evalPromise = (async (): Promise<BoardEval> => {
    const [momPrev, yoyPrev, ytdCur, ytdPrev] = await Promise.all([
      glWindow(period.mom.prev),
      glWindow(period.yoy.prev),
      glWindow(period.ytd.cur),
      glWindow(period.ytd.prev),
    ]);
    const coverage = new Map(units.map((u) => [u.unit_id as number, null as string | null]));
    for (const c of coverageRows) coverage.set(c.unit_id, c.sales_min);
    return buildBoardEval({
      units,
      period,
      today,
      dailySales,
      gl: { range: glRange, momPrev, yoyPrev, ytdCur, ytdPrev },
      coverage,
      incompleteToday: core.incompleteToday,
    });
  })();

  const periodLabel =
    range.from === range.to ? dateShort(range.to) : `${dateShort(range.from)} – ${dateShort(range.to)}`;

  return (
    <div>
      {/* Verdict + toolbar ekspor (ekspor menunggu model lengkap) */}
      <div className="board-head mt4">
        <div>
          <div className="text-eyebrow t-tertiary">
            Periode · {periodLabel}
            {core.lastShift ? ` · input terakhir ${timeWib(core.lastShift)} WIB` : ""}
          </div>
          <h1 className="text-h3 t-brand mt2 verdict-h">{core.verdict.headline}</h1>
          <div className="chip-row mt3">
            {core.verdict.chips.slice(0, 4).map((c, i) => (
              <span key={i} className={`chip-issue ${c.tone}`}>
                <span className={`dot ${c.tone}`} />
                {c.text}
              </span>
            ))}
          </div>
        </div>
        <Suspense fallback={<div className="fs15 t-tertiary">Menyiapkan ekspor…</div>}>
          <ExportSection core={core} evalPromise={evalPromise} params={params} today={today} />
        </Suspense>
      </div>

      {/* 4 kartu KPI (keluarga TETAP) + evaluasi streaming */}
      <div className="kpi-grid mt8">
        {core.kpi.map((c) => (
          <div key={c.key} className="kpi-card">
            <div className="text-caption t-tertiary">
              {c.title}
              {c.provisional && <ProvBadge />}
            </div>
            <div className="text-h2 t-primary num mt2">{c.value}</div>
            {c.sub && (
              <div className="kpi-note">
                <span className={`dot ${c.subTone === "muted" ? "info" : c.subTone}`} />
                <span className={c.subTone === "muted" ? "" : `t-${c.subTone}`}>{c.sub}</span>
              </div>
            )}
            {c.perUnit && (
              <div className="kpi-perunit mt2">
                {c.perUnit.map((p) => (
                  <div key={p.name} className="kpi-perunit-row">
                    <span className="fs15 t-tertiary">{p.name}</span>
                    <span className="fs16 w600 num">{p.value}</span>
                    {p.sub && <span className="fs15 t-tertiary num">{p.sub}</span>}
                  </div>
                ))}
              </div>
            )}
            <Suspense fallback={<div className="kpi-eval mt3 fs15 t-tertiary">menghitung evaluasi…</div>}>
              <KpiEvalLines evalPromise={evalPromise} k={c.key} />
            </Suspense>
          </div>
        ))}
      </div>

      {/* Tren mengikuti filter */}
      <TrendChart trend={core.trend} banding={mode === "banding"} />

      {/* Evaluasi per cabang (streaming — butuh G/L jendela panjang) */}
      <div className="mt10">
        <div className="section-h">
          <div className="text-h5 t-brand">Evaluasi per cabang</div>
          <span className="fs16 t-tertiary">nilai periode aktif · MoM · YoY · YTD</span>
        </div>
        <Suspense fallback={<EvalSkeleton />}>
          <EvalTable evalPromise={evalPromise} />
        </Suspense>
      </div>

      {/* Bauran NPSO/PSO */}
      <div className="mt10">
        <div className="section-h">
          <div className="text-h5 t-brand">Bauran NPSO / PSO</div>
          <span className="fs16 t-tertiary">
            rasio volume non-subsidi terhadap subsidi · target rata-rata periode
          </span>
        </div>
        <div className="ratio-grid mt5">
          {[
            { title: "Gasoline — (Pertamax + Turbo) / Pertalite", list: core.ratios.rg, group: core.ratios.gasGroup },
            { title: "Gasoil — (Dexlite + Dex) / Solar", list: core.ratios.rd, group: core.ratios.oilGroup },
          ].map((panel) => (
            <div key={panel.title} className="card card-pad-lg">
              <div className="ratio-head">
                <div className="text-caption w600 t-secondary">{panel.title}</div>
                <div className="ratio-val">
                  <span className="text-h5 num">
                    {panel.group.actual !== null ? pctS(panel.group.actual) : "—"}
                  </span>
                  {panel.group.target !== null && (
                    <span className={`fs15 w600 ${panel.group.below ? "t-warning" : "t-success"}`}>
                      target {pctS(panel.group.target)}
                    </span>
                  )}
                </div>
              </div>
              <div className="ratio-rows mt4">
                {panel.list.length === 0 && (
                  <div className="empty-inline">Belum ada penjualan jenis ini pada periode.</div>
                )}
                {panel.list.map((r) => (
                  <div key={r.name} className="ratio-row">
                    <div className={`ratio-name ${r.nameCls}`}>{r.name}</div>
                    <div className="ratio-bar">
                      <div className={`ratio-fill ${r.cls}`} style={{ width: `${r.barW}%` }} />
                      {r.tickW !== null && <div className="ratio-tick" style={{ left: `${r.tickW}%` }} />}
                    </div>
                    <div className="ratio-val">
                      <span className="fs16 w600 num">{pctS(r.actual)}</span>
                      {r.deltaPt !== null && (
                        <span
                          className={`fs15 w600 num ${
                            r.below ? (r.deltaPt < -4 ? "t-danger" : "t-warning") : "t-success"
                          }`}
                        >
                          {signedS(r.deltaPt, 1)} pt
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ranking */}
      <div className="mt10">
        <div className="section-h">
          <div className="text-h5 t-brand">Ranking {core.unitsCount} unit</div>
          <span className="fs16 t-tertiary">klik baris untuk drilldown produk &amp; tren unit</span>
        </div>
        <RankingTable rows={core.ranking} />
        {core.unitsCount < 7 && (
          <div className="fs15 t-tertiary mt2">
            Baris bertambah otomatis saat SPBU lain tersambung (siap 7 unit).
          </div>
        )}
      </div>

      {/* Anomali & exception (identitas halaman — dipertahankan) */}
      <div className="mt10">
        <div className="section-h">
          <div className="text-h5 t-brand">Anomali &amp; exception</div>
          <span className="fs16 t-tertiary">diurutkan dari yang paling perlu tindakan</span>
        </div>
        <div className="mt5">
          <AnomalyFeed items={core.anomalies} withLinks={false} />
        </div>
      </div>

      <div className="page-foot mt8">
        <span>
          Sumber: EasyMax POS · sinkron tiap 1–5 menit · ⏳ = angka sementara (opname/input belum
          final)
        </span>
        <span>Zona waktu WIB (Asia/Pontianak)</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-komponen streaming
// ---------------------------------------------------------------------------

function ProvBadge() {
  return (
    <span className="prov-badge" title="Angka sementara — opname/input belum final">
      ⏳
    </span>
  );
}

function DeltaSpan({ cell }: { cell: DeltaCell }) {
  const cls =
    cell.tone === "up" ? "kpi-delta-up" : cell.tone === "down" ? "kpi-delta-down" : "t-tertiary";
  return (
    <span className={`num ${cls}`} title={cell.note}>
      {cell.text}
      {cell.provisional && <ProvBadge />}
      {cell.note && cell.text === "—" && <span className="fs14 t-tertiary"> {cell.note}</span>}
    </span>
  );
}

async function KpiEvalLines({
  evalPromise,
  k,
}: {
  evalPromise: Promise<BoardEval>;
  k: "omzet" | "gl" | "gas" | "oil";
}) {
  const ev = await evalPromise;
  const c = ev.cards[k];
  return (
    <div className="kpi-eval mt3">
      <div className="kpi-eval-row">
        <span className="fs15 t-tertiary" title={ev.labels.mom}>
          MoM
        </span>
        <DeltaSpan cell={c.mom} />
      </div>
      <div className="kpi-eval-row">
        <span className="fs15 t-tertiary" title={ev.labels.yoy}>
          YoY
        </span>
        <DeltaSpan cell={c.yoy} />
      </div>
      <div className="kpi-eval-row">
        <span className="fs15 t-tertiary" title={ev.labels.ytd}>
          YTD
        </span>
        <span className="fs16 w600 num">
          {c.ytdValue}
          {c.ytdProvisional && <ProvBadge />}
        </span>
        <DeltaSpan cell={c.ytdDelta} />
      </div>
    </div>
  );
}

async function EvalTable({ evalPromise }: { evalPromise: Promise<BoardEval> }) {
  const ev = await evalPromise;
  return (
    <div className="card tbl-card mt5 eval-scroll">
      <div className="fs15 t-tertiary eval-labels">
        {ev.labels.mom} · {ev.labels.yoy} · {ev.labels.ytd}
      </div>
      <div className="grid-head cols-eval">
        <span>Metrik</span>
        <span className="right">Periode aktif</span>
        <span className="right">MoM</span>
        <span className="right">YoY</span>
        <span className="right">YTD</span>
        <span className="right">Δ YTD</span>
      </div>
      {ev.units.map((u) => (
        <div key={u.code}>
          <div className="eval-unit-head">
            <span className="text-caption w600 t-primary">{u.name}</span>
            <span className="fs15 t-tertiary mono">{u.dotted}</span>
          </div>
          {u.rows.map((r) => (
            <div key={r.metric} className="grid-row cols-eval">
              <span className="fs16 t-secondary">{r.metric}</span>
              <span className="right fs16 w600 num">
                {r.cur}
                {r.curProvisional && <ProvBadge />}
              </span>
              <span className="right fs16">
                <DeltaSpan cell={r.mom} />
              </span>
              <span className="right fs16">
                <DeltaSpan cell={r.yoy} />
              </span>
              <span className="right fs16 num">{r.ytd}</span>
              <span className="right fs16">
                <DeltaSpan cell={r.ytdDelta} />
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

async function ExportSection({
  core,
  evalPromise,
  params,
  today,
}: {
  core: BoardCore;
  evalPromise: Promise<BoardEval>;
  params: BoardParams;
  today: string;
}) {
  const ev = await evalPromise;
  const range = params.period.range;
  const meta: BoardDocMeta = {
    dateLong: dateLong(range.to),
    periodLabel:
      range.from === range.to ? dateShort(range.to) : `${dateShort(range.from)} – ${dateShort(range.to)}`,
    unitsLabel: params.allUnits
      ? `Semua unit (${params.units.length})`
      : params.units.map((u) => u.name).join(", "),
    modeLabel: params.mode === "banding" ? "Perbandingan antar unit" : "Kumulatif",
    unitsCount: params.units.length,
    generatedLabel: `${dateShort(today)} · ${timeWib(new Date().toISOString())}`,
    // Multi-tenant: label PT mengikuti unit yang benar-benar diekspor.
    ptLabel: ptLabelForUnits(params.units.map((u) => u.code)),
  };
  return (
    <BoardExport
      generatedDate={range.to}
      model={{ mode: params.mode, core, eval: ev }}
      meta={meta}
    />
  );
}

// ---------------------------------------------------------------------------
// Skeleton & empty states
// ---------------------------------------------------------------------------

function BoardSkeleton() {
  return (
    <div className="mt8">
      <div className="skeleton-line w40" />
      <div className="kpi-grid mt6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="kpi-card">
            <div className="skeleton-line w60" />
            <div className="skeleton-line w40 mt3" />
            <div className="skeleton-line w80 mt3" />
          </div>
        ))}
      </div>
      <div className="fs15 t-tertiary mt4">Memuat data periode…</div>
    </div>
  );
}

function EvalSkeleton() {
  return (
    <div className="card card-pad mt5">
      <div className="fs16 t-tertiary">
        Menghitung evaluasi MoM · YoY · YTD… (G/L rentang panjang — pemuatan pertama hari ini bisa
        ±1 menit; berikutnya cepat dari cache)
      </div>
    </div>
  );
}

function BoardNoUnits() {
  return (
    <div className="empty-hero">
      <div className="empty-hero-icon">—</div>
      <div className="text-h5 t-primary mt5">Tidak ada unit dalam scope Anda</div>
      <p className="text-body t-secondary empty-hero-p">Hubungi admin untuk akses unit.</p>
    </div>
  );
}

function BoardNoData({ isToday }: { isToday: boolean }) {
  return (
    <div className="empty-hero">
      <div className="empty-hero-icon">—</div>
      <div className="text-h5 t-primary mt5">Belum ada data untuk periode ini</div>
      <p className="text-body t-secondary empty-hero-p">
        {isToday
          ? "Shift 1 baru dibuka dan sinkronisasi pertama belum masuk. Data muncul otomatis 1–5 menit setelah pengawas menginput di EasyMax."
          : "Tidak ada penjualan terekam pada rentang tanggal terpilih."}
      </p>
      <div className="empty-hero-cta">
        <Link href="/board?p=7d" className="btn-navy">
          Lihat 7 hari
        </Link>
        <Link href="/board" className="btn-outline">
          Hari ini
        </Link>
      </div>
    </div>
  );
}
