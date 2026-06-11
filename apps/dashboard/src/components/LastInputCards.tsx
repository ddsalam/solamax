import type { LastInputs } from "@/lib/queries";
import { STALE_HOURS, staleness } from "@/lib/compliance";

const MODUL: Array<{
  key: keyof LastInputs;
  label: string;
  threshold: number;
}> = [
  { key: "sales", label: "Penjualan", threshold: STALE_HOURS.sales },
  { key: "opname", label: "Opname stok", threshold: STALE_HOURS.opname },
  { key: "cash", label: "Kas / pengeluaran", threshold: STALE_HOURS.cash },
  { key: "delivery", label: "Terima BBM", threshold: STALE_HOURS.delivery },
];

function fmtWib(iso: string | null): string {
  if (!iso) return "—";
  if (iso.length === 10) return iso; // date-only (kas)
  const d = new Date(iso);
  return d
    .toLocaleString("id-ID", {
      timeZone: "Asia/Pontianak",
      dateStyle: "medium",
      timeStyle: "short",
    })
    .replace(/\./g, ":");
}

/** "Last input" per modul — FLAG MERAH menonjol bila stale. */
export function LastInputCards({ last }: { last: LastInputs }) {
  return (
    <div className="cards">
      {MODUL.map((m) => {
        const s = staleness(last[m.key], m.threshold);
        return (
          <div key={m.key} className={`card${s.stale ? " stale" : ""}`}>
            <div className="label">
              {m.label}
              {s.stale ? (
                <span className="badge red">STALE</span>
              ) : (
                <span className="badge ok">OK</span>
              )}
            </div>
            <div className="value">{fmtWib(last[m.key])}</div>
            <div className="age">
              {s.ageText}
              {s.stale && s.ageHours !== null ? " — ⚠️ tidak ada input baru" : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
