import type { ComplianceDay } from "@/lib/queries";
import {
  cashStatus,
  opnameStatus,
  salesStatus,
  STATUS_ICON,
} from "@/lib/compliance";

const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/** Nama hari dari komponen tanggal (tanpa jebakan timezone). */
function weekday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return HARI[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!;
}

/**
 * 🎯 FITUR HERO: matriks kepatuhan input per hari × per modul.
 * Menyorot YANG KOSONG — 🔴 menonjol di latar gelap.
 */
export function ComplianceMatrix({
  days,
  tankCount,
}: {
  days: ComplianceDay[];
  tankCount: number;
}) {
  return (
    <table className="matrix">
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>Tanggal</th>
          <th>Penjualan (shift terisi /3)</th>
          <th>Opname (tangki /{tankCount || "?"})</th>
          <th>Kas (nota)</th>
        </tr>
      </thead>
      <tbody>
        {days.map((r) => (
          <tr key={r.d}>
            <td className="day">
              {weekday(r.d)}, {r.d}
            </td>
            <td>
              <span className="cell">{STATUS_ICON[salesStatus(r.shifts)]}</span>
              <span className="note">{r.shifts}/3</span>
            </td>
            <td>
              <span className="cell">
                {STATUS_ICON[opnameStatus(r.tanks, tankCount)]}
              </span>
              <span className="note">
                {r.tanks}/{tankCount || "?"}
              </span>
            </td>
            <td>
              <span className="cell">{STATUS_ICON[cashStatus(r.cash_rows)]}</span>
              <span className="note">{r.cash_rows}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
