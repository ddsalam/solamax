import { Heatmap, type HmRow } from "@/components/mon/Heatmap";
import { cashStatus, opnameStatus, salesStatus, type Status } from "@/lib/compliance";
import { ago } from "@/lib/format";
import { todayWib } from "@/lib/periods";
import { getComplianceMatrix, getLastInputs, getTankCount } from "@/lib/queries";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

const DAYS = 14;
const TONE: Record<Status, "success" | "warning" | "danger"> = {
  green: "success",
  yellow: "warning",
  red: "danger",
};

/** Agregat sel = modul terburuk hari itu (kas dipisah jadi strip dorman). */
function aggregate(sales: Status, opname: Status): "success" | "warning" | "danger" {
  if (sales === "red" && opname === "red") return "danger";
  if (sales === "green" && opname === "green") return "success";
  return "warning";
}

export default async function KetaatanPage() {
  const scope = await getDataScope();
  const units = scope.units;
  const today = todayWib();

  let kasStrip = "MODUL KAS — BELUM ADA DATA";
  const rows: HmRow[] = await Promise.all(
    units.map(async (u) => {
      const [matrix, tanks, last] = await Promise.all([
        getComplianceMatrix(u.unit_id, DAYS),
        getTankCount(u.unit_id),
        getLastInputs(u.unit_id),
      ]);
      if (last.cash) {
        kasStrip = `DORMAN — TERAKHIR INPUT ${last.cash} (${ago(last.cash).replace(" lalu", "").toUpperCase()}) · SEMUA UNIT`;
      }
      const asc = [...matrix].reverse();
      return {
        code: u.code,
        name: u.name,
        cells: asc.map((d) => {
          const s = salesStatus(d.shifts);
          const o = opnameStatus(d.tanks, tanks);
          return {
            d: d.d,
            tone: aggregate(s, o),
            isToday: d.d === today,
            modules: [
              { name: "Penjualan", tone: TONE[s], note: `${d.shifts}/3 shift` },
              { name: "Opname stok", tone: TONE[o], note: `${d.tanks}/${tanks} tangki` },
              {
                name: "Kas",
                tone: TONE[cashStatus(d.cash_rows)],
                note: d.cash_rows > 0 ? `${d.cash_rows} nota` : "kosong (dorman)",
              },
            ],
          };
        }),
      };
    }),
  );

  const dayLabels = rows[0]?.cells.map((c) => c.d.slice(8)) ?? [];

  return (
    <div>
      <div className="section-h mt6">
        <span className="fs16 t-secondary">
          {units.length} unit × {DAYS} hari · agregat modul input · klik sel untuk detail
        </span>
        <span className="hm-legendrow">
          <span className="hm-legenditem">
            <span className="hm-legend success" />
            <span className="fs15 t-tertiary">lengkap</span>
          </span>
          <span className="hm-legenditem">
            <span className="hm-legend warning" />
            <span className="fs15 t-tertiary">sebagian</span>
          </span>
          <span className="hm-legenditem">
            <span className="hm-legend danger" />
            <span className="fs15 t-tertiary">kosong</span>
          </span>
        </span>
      </div>
      <Heatmap rows={rows} dayLabels={dayLabels} kasStrip={kasStrip} />
      <div className="fs15 t-tertiary mt3">
        Sel hari berjalan diberi garis putus — belum final sampai shift 3 tutup. Modul dorman
        (Kas) dirender sebagai strip dengan umur, bukan deretan sel kosong.
      </div>
    </div>
  );
}
