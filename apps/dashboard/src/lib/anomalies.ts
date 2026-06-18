/**
 * Pembangun feed "Anomali & exception" (Board + badge sidebar Ketaatan) dari
 * data nyata. Lima jenis spec: losses abnormal, kas dorman (permanen),
 * shift belum input, stok kritis, koreksi totalisator. Urut: paling perlu
 * tindakan dulu (danger → warning → info).
 */
import {
  getAvgDailySales,
  getClosingOpname,
  getCorrections,
  getDeliveryByTankDate,
  getDeliveryShortfalls,
  getLastInputs,
  getShiftInfo,
  getTankStocks,
} from "./queries";
import type { ScopedUnit } from "./scope";
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
  /** "major" = anomali perlu tindakan; "minor" = variance kecil (de-emphasis). */
  tier: "major" | "minor";
  /** Skala keparahan untuk pengurutan dalam satu tone (besar = atas). */
  sev: number;
  /** Tanggal bisnis (ISO) — selalu ditampilkan agar bisa ditindaklanjuti. */
  dateIso: string | null;
  title: string;
  unit: string;
  desc: string;
  time: string;
  /** link "Buka laporan →" */
  href?: string;
}

const toneRank = { danger: 0, warning: 1, info: 2 } as const;

/** Ambang tier: variance kecil vs anomali besar (TIDAK mengubah ambang deteksi). */
const MAJOR_L = 1000; // |selisih| ≥ 1000 L
const MAJOR_PCT = 0.05; // atau ≥ 5% dari basis
const lossTier = (absL: number, ratio: number | null): "major" | "minor" =>
  absL >= MAJOR_L || (ratio !== null && ratio >= MAJOR_PCT) ? "major" : "minor";

export async function buildAnomalies(units: ScopedUnit[]): Promise<AnomalyItem[]> {
  const today = todayWib();
  const items: AnomalyItem[] = [];
  let kasOldest: { date: string } | null = null;

  for (const u of units) {
    const unitTag = `${u.name} · ${unitDotted(u.code)}`;
    const href = `/unit/${u.code}/laporan/${today}`;

    const [closing, deliv, doByTank, shift, corrections, last, tanks, avg] = await Promise.all([
      getClosingOpname(u.unit_id, addDays(today, -6), today),
      getDeliveryShortfalls(u.unit_id, addDays(today, -6), today, 10),
      getDeliveryByTankDate(u.unit_id, addDays(today, -6), today),
      getShiftInfo(u.unit_id, today),
      getCorrections(u.unit_id, today),
      getLastInputs(u.unit_id),
      getTankStocks(u.unit_id),
      getAvgDailySales(u.unit_id, addDays(today, -7), addDays(today, -1)),
    ]);

    const gl = aggregateClosingGl(closing);
    // Konteks DO hari-sama per (tanggal × tangki) — informatif, tak menghakimi.
    const doMap = new Map(doByTank.map((d) => [`${d.d}:${d.ckdtangki}`, d.vol]));

    // Losses opname abnormal (signed, lolos garbage guard).
    for (const r of gl.abnormal) {
      const ratio = r.bk && r.bk > 0 ? Math.abs(r.signed) / r.bk : null;
      const pctTxt = ratio !== null ? ` (${pct(ratio, 2)})` : "";
      const sameDayDo = doMap.get(`${r.d}:${r.ckdtangki}`) ?? 0;
      const doCtx = sameDayDo > 0 ? ` · terima DO ${fmtL(sameDayDo)} hari ini (konteks — nilai sendiri tak dihakimi)` : "";
      items.push({
        tone: "danger",
        tier: lossTier(Math.abs(r.signed), ratio),
        sev: Math.abs(r.signed),
        dateIso: r.d,
        title: `Losses ${signedFmt(r.signed)} L${pctTxt}`,
        unit: unitTag,
        desc: `Opname penutup tangki ${r.ckdtangki} ${r.nama ?? r.ckdbbm ?? ""} (fisik − buku) — di atas ambang 100 L / 0,5%${doCtx}.`,
        time: r.d,
        href,
      });
    }

    // Kualitas data: baris opname di luar batas fisik (tambahan A).
    for (const g of gl.garbage) {
      items.push({
        tone: "warning",
        tier: "major",
        sev: Math.abs(g.signed),
        dateIso: g.d,
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
          tier: "major",
          sev: Math.max(s.voldo ?? 0, s.volreal ?? 0),
          dateIso: s.d,
          title: `Kualitas data penerimaan — volume di luar batas wajar`,
          unit: unitTag,
          desc: `DO ${s.cnodo} ${s.nama ?? s.ckdbbm ?? ""}: DO ${fmtL(s.voldo ?? 0)} / real ${fmtL(s.volreal ?? 0)}. Melebihi kapasitas tanker wajar — perlu koreksi entri.`,
          time: s.d,
          href,
        });
        continue;
      }
      const ratio = (s.voldo ?? 0) > 0 ? Math.abs(s.selisih) / (s.voldo ?? 1) : null;
      if (Math.abs(s.selisih) > 100 || (ratio !== null && ratio > 0.005)) {
        const pctTxt = ratio !== null ? ` (${pct(ratio, 2)})` : "";
        items.push({
          tone: "danger",
          tier: lossTier(Math.abs(s.selisih), ratio),
          sev: Math.abs(s.selisih),
          dateIso: s.d,
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
        tier: "major",
        sev: 600,
        dateIso: today,
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
          tier: lvl === "danger" ? "major" : "minor",
          // makin sedikit hari, makin tinggi sev (kritis di atas).
          sev: 5000 / (days + 0.1),
          dateIso: today,
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
        tier: "minor",
        sev: corrections,
        dateIso: today,
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

  // Kas dorman — flag permanen, tidak bisa di-dismiss (spec): selalu puncak danger.
  if (kasOldest) {
    const age = ago(kasOldest.date);
    if (age.includes("TAHUN") || age.includes("hari")) {
      items.push({
        tone: "danger",
        tier: "major",
        sev: Number.MAX_SAFE_INTEGER, // selalu di atas — sinyal pengawasan paling penting
        dateIso: kasOldest.date,
        title: `Modul Kas/Pengeluaran dorman — terakhir input ${kasOldest.date} (${age})`,
        unit: "Semua unit",
        desc: "Flag permanen, tidak bisa di-dismiss. Pengeluaran & setoran tidak terkontrol lewat sistem sejak input terakhir.",
        time: "tetap",
      });
    }
  }

  // Urut: tone (danger→warning→info) → major sebelum minor → sev terbesar dulu.
  const tierRank = { major: 0, minor: 1 } as const;
  return items.sort(
    (a, b) =>
      toneRank[a.tone] - toneRank[b.tone] ||
      tierRank[a.tier] - tierRank[b.tier] ||
      b.sev - a.sev,
  );
}
