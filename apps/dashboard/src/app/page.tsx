import Link from "next/link";
import {
  getComplianceMatrix,
  getLastInputs,
  getTankCount,
  getUnits,
} from "@/lib/queries";
import {
  cashStatus,
  opnameStatus,
  salesStatus,
  STALE_HOURS,
  staleness,
  type Status,
} from "@/lib/compliance";

export const dynamic = "force-dynamic";

const MINI_DAYS = 14;

function Dots({ statuses }: { statuses: Status[] }) {
  return (
    <>
      {statuses.map((s, i) => (
        <span key={i} className={`dot ${s}`} />
      ))}
    </>
  );
}

/** Ringkasan grup: kartu per SPBU dengan mini-matriks 14 hari. Siap 7 unit. */
export default async function Overview() {
  const units = await getUnits();

  const cards = await Promise.all(
    units.map(async (u) => {
      const [matrix, tanks, last] = await Promise.all([
        getComplianceMatrix(u.unit_id, MINI_DAYS),
        getTankCount(u.unit_id),
        getLastInputs(u.unit_id),
      ]);
      const asc = [...matrix].reverse(); // kiri = terlama, kanan = hari ini
      return { u, asc, tanks, last };
    }),
  );

  return (
    <>
      <div className="panel">
        <h2>Ringkasan Grup — kepatuhan input {MINI_DAYS} hari terakhir</h2>
        <p className="desc">
          Tiap kotak satu hari (kanan = hari ini): 🟩 lengkap · 🟨 sebagian · 🟥
          kosong. Klik SPBU untuk detail. Pilot: 1 unit — layout siap 7 SPBU.
        </p>
        <div className="unit-grid">
          {cards.map(({ u, asc, tanks, last }) => {
            const cashStale = staleness(last.cash, STALE_HOURS.cash);
            return (
              <Link key={u.code} href={`/unit/${u.code}`} className="unit-card">
                <h3>
                  {u.name}{" "}
                  {cashStale.stale && (
                    <span className="badge red">KAS {cashStale.ageText}</span>
                  )}
                </h3>
                <div className="code">SPBU {u.code}</div>
                <div className="minirow">
                  <span className="lbl">Penjualan</span>
                  <Dots statuses={asc.map((d) => salesStatus(d.shifts))} />
                </div>
                <div className="minirow">
                  <span className="lbl">Opname</span>
                  <Dots statuses={asc.map((d) => opnameStatus(d.tanks, tanks))} />
                </div>
                <div className="minirow">
                  <span className="lbl">Kas</span>
                  <Dots statuses={asc.map((d) => cashStatus(d.cash_rows))} />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
