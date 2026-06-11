import type { SelisihRow } from "@/lib/queries";
import { fmtL, isSelisihAbnormal } from "@/lib/compliance";

/** Daftar selisih (losses opname / kekurangan kiriman) — abnormal disorot merah. */
export function SelisihTable({ rows }: { rows: SelisihRow[] }) {
  if (rows.length === 0) {
    return <div className="empty">Tidak ada selisih tercatat pada rentang ini.</div>;
  }
  return (
    <table className="list">
      <thead>
        <tr>
          <th>Tanggal</th>
          <th>Sumber</th>
          <th>Tangki / No. DO</th>
          <th>Produk</th>
          <th className="num">Selisih</th>
          <th className="num">Basis (buku / DO)</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const abnormal = isSelisihAbnormal(r.selisih, r.basis);
          return (
            <tr
              key={`${r.src}-${r.d}-${r.ref}-${i}`}
              className={r.sbatal ? "batal" : abnormal ? "abnormal" : undefined}
            >
              <td>{r.d}</td>
              <td>{r.src === "opname" ? "Opname" : "Terima BBM"}</td>
              <td>{r.ref}</td>
              <td>{r.ckdbbm ?? "-"}</td>
              <td className="num">{fmtL(r.selisih)}</td>
              <td className="num">{r.basis !== null ? fmtL(r.basis) : "-"}</td>
              <td>
                {r.sbatal ? "dibatalkan" : abnormal ? "⚠️ abnormal" : ""}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
