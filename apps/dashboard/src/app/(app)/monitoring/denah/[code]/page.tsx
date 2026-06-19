import Link from "next/link";
import { TankGauge } from "@/components/mon/TankGauge";
import { tankFillVar, unitDotted } from "@/lib/config";
import { enduranceDays, enduranceLevel, GARBAGE_STOCK_L, isStockImplausible, stockNow } from "@/lib/derive";
import { ago, fmtL, idn, timeWib } from "@/lib/format";
import { addDays, todayWib } from "@/lib/periods";
import {
  getAvgDailySales,
  getCorrectedNozzles,
  getLastFills,
  getNozzles,
  getRealTank,
  getTankStocks,
} from "@/lib/queries";
import { getDataScope } from "@/lib/scope";

/** Pembacaan ATG dianggap basi (warna peringatan) bila > ambang ini. */
const ATG_STALE_MS = 15 * 60 * 1000;

export const dynamic = "force-dynamic";

/** 4b · Denah tangki + nozzle. Fill% hanya bila kapasitas diisi di config (№5). */
export default async function DenahPage({ params }: { params: { code: string } }) {
  const scope = await getDataScope();
  const unit = scope.requireUnit(params.code); // notFound bila di luar scope/tak ada
  const today = todayWib();

  const [tanks, nozzles, avg, corrected, realtank, lastFills] = await Promise.all([
    getTankStocks(unit.unit_id),
    getNozzles(unit.unit_id),
    getAvgDailySales(unit.unit_id, addDays(today, -7), addDays(today, -1)),
    getCorrectedNozzles(unit.unit_id, today),
    getRealTank(unit.unit_id),
    getLastFills(unit.unit_id),
  ]);
  const avgBy = new Map(avg.map((a) => [a.ckdbbm, a.avg_vol]));
  const correctedSet = new Set(corrected);
  const rtBy = new Map(realtank.map((r) => [r.ckdtangki, r]));
  const fillBy = new Map(lastFills.map((f) => [f.ckdtangki, f]));
  const oldestOpname = tanks
    .map((t) => t.opname_at)
    .filter((x): x is string => x !== null)
    .sort()[0];
  const now = Date.now();

  const cards = tanks.map((t) => {
    const stock = stockNow(t.stock_op, t.sold_since, t.received_since);
    // Backstop: stok mustahil (negatif) dari data korup → jangan tampilkan angka
    // ketahanan/volume; tandai "data tak wajar" & jangan picu status kritis palsu.
    const stockBad = isStockImplausible(stock);
    const days = stockBad ? null : enduranceDays(stock, avgBy.get(t.ckdbbm ?? "") ?? 0);
    const level = stockBad ? "unknown" : enduranceLevel(days);

    // ATG live: kapasitas OTORITATIF (nkapasitas) + volume kini.
    const rt = rtBy.get(t.ckdtangki);
    const cap = rt?.nkapasitas ?? null;
    // ATG nyata = otoritatif; tanpa ATG, pakai estimasi opname KECUALI stok mustahil.
    const liveVol = rt?.nvolume ?? (stockBad ? null : stock);
    const fillPct =
      cap !== null && liveVol !== null ? Math.max(0, Math.min(100, (liveVol / cap) * 100)) : null;
    const ullageL = cap !== null && liveVol !== null ? cap - liveVol : null;
    // Anomali sensor ATG: volume melebihi kapasitas otoritatif = pembacaan mustahil
    // (mis. probe DEX yang macet). Dasarkan pada nvolume MENTAH, bukan fallback opname.
    const atgAnomaly = cap !== null && rt?.nvolume != null && rt.nvolume > cap;
    // Suhu ≤0 = sensor tak terbaca (tangki nyaris kosong) → n/a anggun.
    const tempC = rt?.nsuhu != null && rt.nsuhu > 0 ? rt.nsuhu : null;
    // Umur pembacaan ATG (kejujuran kesegaran data realtime).
    const reading =
      rt?.reading_at != null
        ? { ageText: ago(rt.reading_at, new Date(now)), stale: now - Date.parse(rt.reading_at) > ATG_STALE_MS }
        : null;
    const lf = fillBy.get(t.ckdtangki);
    // Pengisian terakhir di luar batas fisik (mis. −14 juta L) = entri korup.
    const lfBad = lf?.nvolreal != null && Math.abs(lf.nvolreal) > GARBAGE_STOCK_L;

    const nz = nozzles.filter((n) => n.ckdtangki === t.ckdtangki);
    return {
      t,
      stock,
      stockBad,
      liveVol,
      days,
      level,
      fillPct,
      ullageL,
      cap,
      atgAnomaly,
      tempC,
      reading,
      rt,
      lf,
      lfBad,
      fillVar: tankFillVar(t.nama),
      nz,
    };
  });
  const critical = cards.filter((c) => c.level === "danger");

  return (
    <div>
      <div className="picker-row mt6">
        <Link href="/monitoring" className="btn-tint sm">
          ← Jaringan
        </Link>
        <span className="text-h6 t-brand">
          {unit.name} · {unitDotted(unit.code)}
        </span>
        <span className="denah-note fs15 t-tertiary">
          {oldestOpname
            ? `volume & ukuran fisik dari ATG live; ketahanan hari dari opname ${timeWib(oldestOpname)}`
            : "belum ada opname"}
        </span>
      </div>

      <div className="tank-grid mt5">
        {cards.map(({ t, stockBad, liveVol, days, level, fillPct, ullageL, cap, atgAnomaly, tempC, reading, rt, lf, lfBad, fillVar, nz }) => (
          <div key={t.ckdtangki} className={`tank-card${level === "danger" ? " danger" : ""}`}>
            <div className="hub-card-top">
              <span className="fs15 w700 t-tertiary">{t.ckdtangki}</span>
              <span
                className={`fs15 w600 ${stockBad ? "t-warning" : level === "danger" ? "t-danger" : level === "warning" ? "t-warning" : "t-secondary"}`}
              >
                {stockBad ? "data tak wajar" : days !== null ? `${idn(days, 1)} hari` : "—"}
              </span>
            </div>
            <div className="tank-card-name">
              <span className="text-caption w700 t-brand">{t.nama ?? t.ckdbbm ?? "—"}</span>
              <span className={`fs15 num ${stockBad ? "t-warning" : "t-secondary"}`}>
                {liveVol !== null ? `±${fmtL(liveVol)}` : stockBad ? "data tak wajar" : "belum ada opname"}
              </span>
            </div>
            <TankGauge
              fillPct={fillPct}
              fillVar={fillVar}
              level={level}
              fuelMm={rt?.ntinggi ?? null}
              waterMm={rt?.ntinggiair ?? null}
              waterL={rt?.nvolumeair ?? null}
              tempC={tempC}
              ullageL={ullageL}
              capacityL={cap}
              anomaly={atgAnomaly}
              lastFill={lf ? { vol: lf.nvolreal, selisih: lf.nvolselisih, bad: lfBad } : null}
              reading={reading}
            />
            <div className="nz-row mt2">
              {nz.length === 0 && <span className="fs15 t-tertiary">tanpa nozzle terpetakan</span>}
              {nz.map((n) => (
                <span
                  key={n.ckdnozzle}
                  className={`nz-chip${correctedSet.has(n.ckdnozzle) ? " corr" : ""}`}
                  title={correctedSet.has(n.ckdnozzle) ? "ada koreksi totalisator hari ini" : undefined}
                >
                  {correctedSet.has(n.ckdnozzle) ? "⟳ " : ""}
                  {n.ckdnozzle}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {critical.length > 0 && (
        <div className="banner danger mt5">
          <span className="dot lg danger" />
          <div className="anom-body">
            <div className="text-caption w600 t-danger">
              Stok kritis:{" "}
              {critical
                .map((c) => `${c.t.nama ?? c.t.ckdtangki} (${idn(c.days ?? 0, 1)} hari)`)
                .join(" · ")}
            </div>
            <div className="fs16 t-secondary mt1">
              Di bawah ambang 1,5 hari. Data sisa DO menunggu Domain DO — koordinasikan
              penebusan ke Manajemen Ops.
            </div>
          </div>
          <Link href={`/unit/${unit.code}/laporan/${today}`} className="fs15 w600 t-accent nowrap">
            Buka laporan unit →
          </Link>
        </div>
      )}
      <div className="fs15 t-tertiary mt3">
        Volume · tinggi · suhu · air · kapasitas ditarik live dari ATG EasyMax;
        fill% = volume ÷ kapasitas otoritatif. Umur tiap pembacaan
        ditampilkan di kartu; pembacaan basi (&gt;15 mnt) ditandai. Kartu tanpa
        pembacaan ATG menampilkan estimasi stok opname &amp; &quot;n/a&quot; untuk ukuran fisik.
        Ketahanan hari dari opname.
      </div>
    </div>
  );
}
