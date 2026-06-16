import Link from "next/link";
import { TankGauge } from "@/components/mon/TankGauge";
import { tankCapacity, tankFillVar, tankStrapMaxCm, unitDotted } from "@/lib/config";
import { enduranceDays, enduranceLevel, stockNow } from "@/lib/derive";
import { fmtL, idn, timeWib } from "@/lib/format";
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

/** "T-01" → 1 (cocokkan ke real_tank.tank_no = EasyMax tb_realtank.id). */
function tankNoOf(ckdtangki: string): number | null {
  const n = Number.parseInt(ckdtangki.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

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
  const rtBy = new Map(realtank.map((r) => [r.tank_no, r]));
  const fillBy = new Map(lastFills.map((f) => [f.ckdtangki, f]));
  const oldestOpname = tanks
    .map((t) => t.opname_at)
    .filter((x): x is string => x !== null)
    .sort()[0];

  const cards = tanks.map((t) => {
    const stock = stockNow(t.stock_op, t.sold_since, t.received_since);
    // Ketahanan tetap dari stok opname+mutasi (tervalidasi); avg harian.
    const days = enduranceDays(stock, avgBy.get(t.ckdbbm ?? "") ?? 0);
    const level = enduranceLevel(days);
    const cap = tankCapacity(unit.code, t.ckdtangki);

    // Volume "kini": utamakan ATG live (real_tank.nvolume); fallback estimasi opname.
    const rt = rtBy.get(tankNoOf(t.ckdtangki) ?? -1);
    const liveVol = rt?.nvolume ?? stock;
    const fillPct =
      cap !== null && liveVol !== null ? Math.max(0, Math.min(100, (liveVol / cap) * 100)) : null;
    const ullageL = cap !== null && liveVol !== null ? cap - liveVol : null;
    // Anomali sensor ATG: pembacaan mustahil secara fisik. Dasarkan pada angka ATG
    // MENTAH (rt.nvolume / rt.ntinggi), bukan liveVol yg bisa fallback ke estimasi
    // opname — supaya hanya menandai sensor faulting, bukan kekosongan data.
    const strapMaxCm = tankStrapMaxCm(unit.code, t.ckdtangki);
    const atgAnomaly =
      (cap !== null && rt?.nvolume != null && rt.nvolume > cap) ||
      (strapMaxCm !== null && rt?.ntinggi != null && rt.ntinggi / 10 > strapMaxCm);
    // Suhu ≤0 = sensor tak terbaca (tangki nyaris kosong) → n/a anggun.
    const tempC = rt?.nsuhu != null && rt.nsuhu > 0 ? rt.nsuhu : null;
    const lf = fillBy.get(t.ckdtangki);

    const nz = nozzles.filter((n) => n.ckdtangki === t.ckdtangki);
    return {
      t,
      stock,
      liveVol,
      days,
      level,
      fillPct,
      ullageL,
      cap,
      atgAnomaly,
      tempC,
      rt,
      lf,
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
            ? `level dihitung dari opname ${timeWib(oldestOpname)} + penjualan tersinkron sejak itu`
            : "belum ada opname"}
        </span>
      </div>

      <div className="tank-grid mt5">
        {cards.map(({ t, liveVol, days, level, fillPct, ullageL, cap, atgAnomaly, tempC, rt, lf, fillVar, nz }) => (
          <div key={t.ckdtangki} className={`tank-card${level === "danger" ? " danger" : ""}`}>
            <div className="hub-card-top">
              <span className="fs15 w700 t-tertiary">{t.ckdtangki}</span>
              <span
                className={`fs15 w600 ${level === "danger" ? "t-danger" : level === "warning" ? "t-warning" : "t-secondary"}`}
              >
                {days !== null ? `${idn(days, 1)} hari` : "—"}
              </span>
            </div>
            <div className="tank-card-name">
              <span className="text-caption w700 t-brand">{t.nama ?? t.ckdbbm ?? "—"}</span>
              <span className="fs15 t-secondary num">
                {liveVol !== null ? `±${fmtL(liveVol)}` : "belum ada opname"}
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
              capacityL={cap ?? null}
              anomaly={atgAnomaly}
              lastFill={lf ? { vol: lf.nvolreal, selisih: lf.nvolselisih } : null}
              live={rt != null}
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
        Volume · tinggi · suhu · air ditarik live dari ATG EasyMax (tabel
        `tb_realtank`); fill% = volume ÷ kapasitas (kapasitas dari tabel kalibrasi,
        di `src/lib/config.ts` TANK_CAPACITY). Kartu tanpa pembacaan ATG menampilkan
        estimasi stok opname & "n/a" untuk ukuran fisik. Ketahanan hari dari data nyata.
      </div>
    </div>
  );
}
