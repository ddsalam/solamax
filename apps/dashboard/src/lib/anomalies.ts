/**
 * Pembangun feed "Anomali & exception" (Board + /monitoring/anomali) dari
 * data nyata. Lima jenis spec: losses abnormal, kas dorman (permanen),
 * shift belum input, stok kritis, koreksi totalisator. Urut: paling perlu
 * tindakan dulu (danger → warning → info).
 */
import {
  getAvgDailySales,
  getClosingOpname,
  getCorrections,
  getDeliveryShortfalls,
  getLastInputs,
  getShiftInfo,
  getTankStocks,
  type UnitRow,
} from "./queries";
import { addDays, todayWib } from "./periods";
import { ago, fmtL, idn, pct, signed as signedFmt, timeWib } from "./format";
import {
  aggregateClosingGl,
  enduranceDays,
  enduranceLevel,
  GARBAGE_STOCK_L,
  stockNow,
} from "./derive";
import { unitDotted } from "./config";

export interface AnomalyItem {
  tone: "danger" | "warning" | "info";
  title: string;
  unit: string;
  desc: string;
  time: string;
  /** link "Buka laporan →" */
  href?: string;
}

const toneRank = { danger: 0, warning: 1, info: 2 } as const;

export async function buildAnomalies(units: UnitRow[]): Promise<AnomalyItem[]> {
  const today = todayWib();
  const items: AnomalyItem[] = [];
  let kasOldest: { date: string } | null = null;

  for (const u of units) {
    const unitTag = `${u.name} · ${unitDotted(u.code)}`;
    const href = `/unit/${u.code}/laporan/${today}`;

    const [closing, deliv, shift, corrections, last, tanks, avg] = await Promise.all([
      getClosingOpname(u.unit_id, addDays(today, -6), today),
      getDeliveryShortfalls(u.unit_id, addDays(today, -6), today, 10),
      getShiftInfo(u.unit_id, today),
      getCorrections(u.unit_id, today),
      getLastInputs(u.unit_id),
      getTankStocks(u.unit_id),
      getAvgDailySales(u.unit_id, addDays(today, -7), addDays(today, -1)),
    ]);

    const gl = aggregateClosingGl(closing);

    // Losses opname abnormal (signed, lolos garbage guard).
    for (const r of gl.abnormal) {
      const pctTxt = r.bk && r.bk > 0 ? ` (${pct(Math.abs(r.signed) / r.bk, 2)})` : "";
      items.push({
        tone: "danger",
        title: `Losses abnormal ${signedFmt(r.signed)} L${pctTxt}`,
        unit: unitTag,
        desc: `Opname penutup tangki ${r.ckdtangki} ${r.nama ?? r.ckdbbm ?? ""} (fisik − buku) — di atas ambang 100 L / 0,5%.`,
        time: r.d,
        href,
      });
    }

    // Kualitas data: baris opname di luar batas fisik (tambahan A).
    for (const g of gl.garbage) {
      items.push({
        tone: "warning",
        title: `Kualitas data opname — angka di luar batas wajar`,
        unit: unitTag,
        desc: `Tangki ${g.ckdtangki} ${g.nama ?? g.ckdbbm ?? ""}: buku ${fmtL(g.bk ?? 0)} / fisik ${fmtL(g.op ?? 0)} (selisih ${signedFmt(g.signed)} L). Di luar batas tangki — dikecualikan dari KPI losses, perlu koreksi entri EasyMax.`,
        time: g.d,
        href,
      });
    }

    // Kekurangan kiriman (delivery) — garbage volume dipisah jadi kualitas data.
    for (const s of deliv) {
      if (s.sbatal) continue;
      const garbage = (s.voldo ?? 0) > GARBAGE_STOCK_L || (s.volreal ?? 0) > GARBAGE_STOCK_L;
      if (garbage) {
        items.push({
          tone: "warning",
          title: `Kualitas data penerimaan — volume di luar batas wajar`,
          unit: unitTag,
          desc: `DO ${s.cnodo} ${s.nama ?? s.ckdbbm ?? ""}: DO ${fmtL(s.voldo ?? 0)} / real ${fmtL(s.volreal ?? 0)}. Melebihi kapasitas tanker wajar — perlu koreksi entri.`,
          time: s.d,
          href,
        });
        continue;
      }
      if (Math.abs(s.selisih) > 100 || ((s.voldo ?? 0) > 0 && Math.abs(s.selisih) / (s.voldo ?? 1) > 0.005)) {
        const pctTxt = s.voldo && s.voldo > 0 ? ` (${pct(Math.abs(s.selisih) / s.voldo, 2)})` : "";
        items.push({
          tone: "danger",
          title: `Kekurangan kiriman ${fmtL(s.selisih)}${pctTxt}`,
          unit: unitTag,
          desc: `Penerimaan DO ${s.cnodo} ${s.nama ?? ""} vs volume DO — di atas ambang.`,
          time: s.d,
          href,
        });
      }
    }

    if (shift.shifts < 3) {
      items.push({
        tone: "warning",
        title:
          shift.shifts === 0
            ? "Penjualan hari ini belum diinput"
            : `Penjualan shift ${shift.shifts + 1} belum diinput`,
        unit: unitTag,
        desc: shift.last_dtgljam
          ? `Terakhir input ${timeWib(shift.last_dtgljam)} WIB. Status unit kuning sampai 3/3 shift tanggal bisnis ini lengkap.`
          : "Belum ada input penjualan pada tanggal bisnis berjalan.",
        time: shift.last_dtgljam ? ago(shift.last_dtgljam) : "—",
        href,
      });
    }

    // Stok kritis (<1,5 hari) / rendah (<3 hari) — dari estimasi nyata.
    const avgBy = new Map(avg.map((a) => [a.ckdbbm, a.avg_vol]));
    for (const t of tanks) {
      const stock = stockNow(t.stock_op, t.sold_since, t.received_since);
      const days = enduranceDays(stock, avgBy.get(t.ckdbbm ?? "") ?? 0);
      const lvl = enduranceLevel(days);
      if ((lvl === "danger" || lvl === "warning") && days !== null) {
        items.push({
          tone: lvl,
          title: `Stok ${t.nama ?? t.ckdbbm ?? "?"} sisa estimasi ${idn(days, 1)} hari`,
          unit: unitTag,
          desc: `Tangki ${t.ckdtangki} — dihitung dari opname ${t.opname_at ? timeWib(t.opname_at) : "—"} + penjualan tersinkron sejak itu. Ambang kritis 1,5 hari.`,
          time: t.opname_at ? ago(t.opname_at) : "—",
          href,
        });
      }
    }

    if (corrections > 0) {
      items.push({
        tone: "info",
        title: `⟳ Koreksi totalisator (${corrections} revisi)`,
        unit: unitTag,
        desc: "Baris penjualan direvisi pengawas (SUBAH/SEDIT). Angka di dashboard sudah keadaan terbaru.",
        time: "hari ini",
        href,
      });
    }

    if (last.cash && (!kasOldest || last.cash < kasOldest.date)) {
      kasOldest = { date: last.cash };
    }
  }

  // Kas dorman — flag permanen, tidak bisa di-dismiss (spec).
  if (kasOldest) {
    const age = ago(kasOldest.date);
    if (age.includes("TAHUN") || age.includes("hari")) {
      items.push({
        tone: "danger",
        title: `Modul Kas/Pengeluaran dorman — terakhir input ${kasOldest.date} (${age})`,
        unit: "Semua unit",
        desc: "Flag permanen, tidak bisa di-dismiss. Pengeluaran & setoran tidak terkontrol lewat sistem sejak input terakhir.",
        time: "tetap",
      });
    }
  }

  return items.sort((a, b) => toneRank[a.tone] - toneRank[b.tone]);
}
