import Link from "next/link";
import { unitDotted } from "@/lib/config";
import { enduranceDays, enduranceLevel, isStockImplausible, stockNow } from "@/lib/derive";
import { ago, idn, rpShort } from "@/lib/format";
import { addDays, todayWib } from "@/lib/periods";
import {
  getAvgDailySales,
  getSalesTotals,
  getShiftInfo,
  getSyncByUnit,
  getTankStocks,
} from "@/lib/queries";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

/** 4a · Jaringan — tabel SPBU live. Klik unit → denah tangki. */
export default async function JaringanPage() {
  const today = todayWib();
  const scope = await getDataScope();
  const units = scope.units;
  const sync = await getSyncByUnit(scope.unitIds);
  const syncBy = new Map(sync.map((s) => [s.unit_id, s.last_run]));

  const rows = await Promise.all(
    units.map(async (u) => {
      const [totals, shift, tanks, avg] = await Promise.all([
        getSalesTotals(u.unit_id, today, today),
        getShiftInfo(u.unit_id, today),
        getTankStocks(u.unit_id),
        getAvgDailySales(u.unit_id, addDays(today, -7), addDays(today, -1)),
      ]);
      const avgBy = new Map(avg.map((a) => [a.ckdbbm, a.avg_vol]));
      let minDays: { nama: string; days: number } | null = null;
      for (const t of tanks) {
        const stock = stockNow(t.stock_op, t.sold_since, t.received_since);
        if (isStockImplausible(stock)) continue; // jangan jadikan stok mustahil "terkritis"
        const days = enduranceDays(stock, avgBy.get(t.ckdbbm ?? "") ?? 0);
        if (days !== null && (minDays === null || days < minDays.days)) {
          minDays = { nama: t.nama ?? t.ckdbbm ?? "?", days };
        }
      }
      const lastRun = syncBy.get(u.unit_id) ?? null;
      const syncFresh = lastRun !== null && Date.now() - new Date(lastRun).getTime() < 15 * 60_000;
      return { u, totals, shift, minDays, lastRun, syncFresh };
    }),
  );

  return (
    <div>
      <div className="card tbl-card mt6">
        <div className="grid-head cols-net">
          <span>SPBU</span>
          <span>Sinkron</span>
          <span className="right">Omset hari ini</span>
          <span>Stok</span>
          <span>Input</span>
          <span />
        </div>
        {rows.map((r) => {
          const stokLevel = enduranceLevel(r.minDays?.days ?? null);
          return (
            <Link
              key={r.u.code}
              href={`/monitoring/denah/${r.u.code}`}
              className="grid-row cols-net clickable net-link"
            >
              <span className="rank-name">
                <span className="text-caption w600">{r.u.name}</span>
                <span className="fs15 t-tertiary mono">{unitDotted(r.u.code)}</span>
              </span>
              <span className="rank-input">
                <span className={`dot ${r.syncFresh ? "success" : r.lastRun ? "warning" : "danger"}`} />
                <span className="fs15 t-secondary">{r.lastRun ? ago(r.lastRun) : "belum pernah"}</span>
              </span>
              <span className="right fs16 w600 num nowrap">{rpShort(r.totals.omzet)}</span>
              <span className="rank-input">
                <span
                  className={`dot ${stokLevel === "danger" ? "danger" : stokLevel === "warning" ? "warning" : stokLevel === "ok" ? "success" : "muted"}`}
                />
                <span
                  className={`fs15 ${stokLevel === "danger" ? "t-danger w700" : stokLevel === "warning" ? "t-warning w700" : "t-secondary"}`}
                >
                  {r.minDays ? `${r.minDays.nama} ${idn(r.minDays.days, 1)} hr` : "—"}
                </span>
              </span>
              <span className="rank-input">
                <span className={`dot ${r.shift.shifts >= 3 ? "success" : r.shift.shifts > 0 ? "warning" : "danger"}`} />
                <span className="fs15 t-secondary">{Math.min(r.shift.shifts, 3)}/3 shift</span>
              </span>
              <span className="t-tertiary fs15">›</span>
            </Link>
          );
        })}
      </div>
      <div className="fs15 t-tertiary mt3">
        Klik unit untuk membuka denah tangki &amp; nozzle. Pilot 1 unit — baris bertambah
        otomatis saat SPBU lain tersambung.
      </div>
    </div>
  );
}
