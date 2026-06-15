import Link from "next/link";
import { tankCapacity, unitDotted } from "@/lib/config";
import { enduranceDays, enduranceLevel, stockNow } from "@/lib/derive";
import { fmtL, idn, timeWib } from "@/lib/format";
import { addDays, todayWib } from "@/lib/periods";
import {
  getAvgDailySales,
  getCorrectedNozzles,
  getNozzles,
  getTankStocks,
} from "@/lib/queries";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

/** 4b · Denah tangki + nozzle. Fill% hanya bila kapasitas diisi di config (№5). */
export default async function DenahPage({ params }: { params: { code: string } }) {
  const scope = await getDataScope();
  const unit = scope.requireUnit(params.code); // notFound bila di luar scope/tak ada
  const today = todayWib();

  const [tanks, nozzles, avg, corrected] = await Promise.all([
    getTankStocks(unit.unit_id),
    getNozzles(unit.unit_id),
    getAvgDailySales(unit.unit_id, addDays(today, -7), addDays(today, -1)),
    getCorrectedNozzles(unit.unit_id, today),
  ]);
  const avgBy = new Map(avg.map((a) => [a.ckdbbm, a.avg_vol]));
  const correctedSet = new Set(corrected);
  const oldestOpname = tanks
    .map((t) => t.opname_at)
    .filter((x): x is string => x !== null)
    .sort()[0];

  const cards = tanks.map((t) => {
    const stock = stockNow(t.stock_op, t.sold_since, t.received_since);
    const days = enduranceDays(stock, avgBy.get(t.ckdbbm ?? "") ?? 0);
    const level = enduranceLevel(days);
    const cap = tankCapacity(unit.code, t.ckdtangki);
    const fillPct = cap !== null && stock !== null ? Math.max(0, Math.min(100, (stock / cap) * 100)) : null;
    const nz = nozzles.filter((n) => n.ckdtangki === t.ckdtangki);
    return { t, stock, days, level, fillPct, nz };
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
        {cards.map(({ t, stock, days, level, fillPct, nz }) => (
          <div key={t.ckdtangki} className={`tank-card${level === "danger" ? " danger" : ""}`}>
            <div className="hub-card-top">
              <span className="fs15 w700 t-tertiary">{t.ckdtangki}</span>
              <span
                className={`fs15 w600 ${level === "danger" ? "t-danger" : level === "warning" ? "t-warning" : "t-secondary"}`}
              >
                {days !== null ? `${idn(days, 1)} hari` : "—"}
              </span>
            </div>
            <div className="text-caption w700 t-brand mt1">{t.nama ?? t.ckdbbm ?? "—"}</div>
            <div className="tank-cyl">
              {fillPct !== null && (
                <div
                  className={`tank-fill${level === "danger" ? " danger" : level === "warning" ? " warning" : ""}`}
                  style={{ height: `${Math.round(fillPct)}%` }}
                />
              )}
              <div className="tank-pct num">
                {fillPct !== null ? `${idn(fillPct)}%` : "kapasitas belum diisi"}
              </div>
            </div>
            <div className="fs15 t-secondary num mt2">
              {stock !== null ? `±${fmtL(stock)}` : "belum ada opname"}
            </div>
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
        Fill% tangki membutuhkan kapasitas (belum ada di EasyMax) — isi di
        `src/lib/config.ts` TANK_CAPACITY. Ketahanan hari tetap dihitung dari data nyata.
      </div>
    </div>
  );
}
