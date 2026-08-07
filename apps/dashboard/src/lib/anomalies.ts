/**
 * Pembangun feed "Anomali & exception" (Board + badge sidebar Ketaatan) dari
 * data nyata: losses abnormal, ketaatan administrasi (setoran tak selaras /
 * hari belum diisi lewat tempo), shift belum input, stok kritis, koreksi
 * totalisator. Urut: paling perlu tindakan dulu (danger → warning → info).
 *
 * Anomali "kas dorman" DIHAPUS 2026-08-07: ketujuh unit nol nota dalam 30 hari,
 * jadi ia danger permanen (sev=MAX_SAFE_INTEGER, standing) yang tak pernah bisa
 * diselesaikan — alarm yang tak bisa dimatikan adalah alarm yang diabaikan.
 */
import { unstable_cache } from "next/cache";
import {
  getAdminDays,
  getAvgDailySales,
  getClosingOpname,
  getCorrections,
  getDailyGlByProduct,
  getDeliveryShortfalls,
  getShiftInfo,
  getTankStocks,
  getZeroClosingEvents,
} from "./queries";
import type { ScopedUnit } from "./scope";
import { addDays, todayWib } from "./periods";
import { ago, fmtL, idn, pct, signed as signedFmt, timeWib } from "./format";
import { adminStatus, fmtRp, SETORAN_TOLERANSI_RP } from "./compliance";
import { uangTunai } from "./rekon";
import {
  aggregateClosingGl,
  enduranceDays,
  enduranceLevel,
  GARBAGE_STOCK_L,
  isSelisihAbnormal,
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
  /**
   * Flag permanen/berdiri — tetap di feed, tak dihitung badge. Tak ada lagi
   * produsennya sejak anomali kas dorman dihapus (2026-08-07); dipertahankan
   * karena `layout.tsx` masih menyaringnya dan kontraknya tetap berlaku.
   */
  standing?: boolean;
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

  /**
   * Penutup opname bernilai NOL (keputusan owner D2, 2026-07-24). SATU query
   * multi-unit di luar loop — tidak menambah fan-out per unit.
   *
   * TIER: `warning`/`major`, SENGAJA BUKAN `danger` (= tak dihitung badge merah).
   * Alasannya berbasis angka: aturannya menyala 2× dalam 30 hari terakhir dan 1×
   * dalam jendela 7 hari yang dipakai feed ini — cukup senyap. Tapi ini cacat
   * ENTRI DATA, bukan bahaya operasional (tak ada BBM yang benar-benar hilang);
   * badge merah dikalibrasi untuk yang kedua. Menaikkannya ke danger akan
   * mengencerkan sinyal yang justru harus dipercaya.
   */
  const unitIds = units.map((u) => u.unit_id);

  /**
   * Ketaatan ADMINISTRASI (menggantikan anomali kas dorman). SATU query
   * multi-unit di luar loop — tak menambah fan-out per unit. Keputusan status
   * memakai `adminStatus()` yang sama dengan halaman Ketaatan: satu aturan,
   * satu tempat. Jendela 7 hari seperti item lain di feed ini.
   */
  const namaUnit = new Map(units.map((u) => [u.unit_id as number, unitDotted(u.code)]));
  for (const r of await getAdminDays(unitIds, addDays(today, -6), today)) {
    const h = uangTunai({
      A: r.compA, B: r.compB, C: r.compC, D: r.compD, F: r.compF, G: r.compG,
    });
    const v = adminStatus(
      {
        nPendapatanLain: r.nPendapatanLain,
        nPengeluaran: r.nPengeluaran,
        nSetoran: r.nSetoran,
        h,
        i: r.setoran,
        shifts: r.shifts,
      },
      { businessDate: r.d, today },
    );
    if (v.tone === "pending" || v.kode === "selaras") continue;
    const unitTag = namaUnit.get(r.unit_id) ?? String(r.unit_id);
    const href = `/unit/${units.find((u) => u.unit_id === r.unit_id)?.code}/rincian/${r.d}`;
    const selisih = r.setoran !== null ? Math.abs(r.setoran - h) : 0;
    if (v.kode === "belum_diisi" || v.kode === "setoran_kosong") {
      items.push({
        tone: "danger",
        tier: "major",
        sev: h,
        dateIso: r.d,
        title:
          v.kode === "belum_diisi"
            ? "Rincian Penjualan belum diisi — lewat jatuh tempo"
            : "Setoran bank belum diisi — lewat jatuh tempo",
        unit: unitTag,
        desc:
          v.kode === "belum_diisi"
            ? `Tidak ada satu pun baris Pendapatan Lain / Pengeluaran / Setoran untuk hari ini. Uang tunai seharusnya ${fmtRp(h)}. Jatuh tempo akhir H+1 sudah lewat.`
            : `Pendapatan Lain (${r.nPendapatanLain}) & Pengeluaran (${r.nPengeluaran}) terisi, tapi SETORAN BANK nihil. Uang tunai ${fmtRp(h)} tak terpertanggungjawabkan.`,
        time: r.d,
        href,
      });
    } else {
      items.push({
        tone: v.kode === "kurang_setor" ? "danger" : "warning",
        tier: "major",
        sev: selisih,
        dateIso: r.d,
        title:
          v.kode === "kurang_setor"
            ? `Setoran bank KURANG ${fmtRp(selisih)} dari uang tunai`
            : `Setoran bank MELEBIHI uang tunai ${fmtRp(selisih)}`,
        unit: unitTag,
        desc: `Uang tunai H = ${fmtRp(h)}, setoran I = ${fmtRp(r.setoran ?? 0)}. Selisih di luar toleransi ${fmtRp(SETORAN_TOLERANSI_RP)} (pembulatan slip setoran), jadi ini bukan artefak pembulatan.`,
        time: r.d,
        href,
      });
    }
  }
  const byUnitZero = new Map<number, Awaited<ReturnType<typeof getZeroClosingEvents>>>();
  for (const z of await getZeroClosingEvents(unitIds, addDays(today, -6), today)) {
    const list = byUnitZero.get(z.unit_id) ?? [];
    list.push(z);
    byUnitZero.set(z.unit_id, list);
  }

  for (const u of units) {
    const unitTag = `${u.name} · ${unitDotted(u.code)}`;
    const href = `/unit/${u.code}/laporan/${today}`;

    /**
     * DUA GELOMBANG 4, bukan satu gelombang 8. Pool `pg` `max: 5` (db.ts):
     * delapan query serentak per unit sudah melampaui pool SENDIRIAN, dan
     * karena feed ini dipanggil bersamaan dengan jendela G/L board, ia yang
     * membuat pemanggil lain (`getShiftInfo`) mengantre >10 dtk lalu dilempar
     * "timeout exceeded when trying to connect" → board jatuh ke error
     * boundary. Terbukti empiris: membatasi fan-out di board/page.tsx saja
     * TIDAK cukup — gerbang repro tetap merah sampai gelombang ini dipecah.
     *
     * Query, parameter, dan hasilnya identik; hanya kapan ia ditembakkan yang
     * berubah. Cache (`unstable_cache`, 120 dtk) tak tersentuh — jebakan D17
     * (cache menyimpan G/L kosong) tak dibangkitkan.
     */
    const [closing, glRows, deliv, shift] = await Promise.all([
      getClosingOpname(u.unit_id, addDays(today, -6), today),
      // G/L metode RESUME per produk × hari (reuse laporan harian) — sumber item Losses.
      getDailyGlByProduct(u.unit_id, addDays(today, -6), today),
      getDeliveryShortfalls(u.unit_id, addDays(today, -6), today, 10),
      getShiftInfo(u.unit_id, today),
    ]);
    // getLastInputs DILEPAS 2026-08-07 bersama anomali kas dorman: `last` hanya
    // pernah dipakai untuk `last.cash` (terverifikasi grep). Satu query per unit
    // lebih sedikit di feed.
    const [corrections, tanks, avg] = await Promise.all([
      getCorrections(u.unit_id, today),
      getTankStocks(u.unit_id),
      getAvgDailySales(u.unit_id, addDays(today, -7), addDays(today, -1)),
    ]);

    // aggregateClosingGl HANYA untuk backstop kualitas-data (garbage per-tangki);
    // losses operasional kini dari metode RESUME (glRows), bukan op−bk.
    const gl = aggregateClosingGl(closing);

    // Losses operasional metode RESUME, per produk × hari (selaras Laporan Harian).
    // Ambang sama (isSelisihAbnormal: |L|>100 atau >0,5% vs jual kotor hari itu).
    // Shortfall kiriman DO TERGABUNG di sini (keputusan owner — satu angka; item
    // "Kekurangan kiriman" di bawah tetap ada sebagai diagnostik terpisah). Baris
    // provisional / gl tak terhitung dilewati — hanya losses FINAL yang menyala.
    for (const r of glRows) {
      if (r.gl === null || r.provisional) continue;
      if (!isSelisihAbnormal(r.gl, r.sales_gross)) continue;
      const ratio = r.sales_gross > 0 ? Math.abs(r.gl) / r.sales_gross : null;
      const pctTxt = ratio !== null ? ` (${pct(ratio, 2)})` : "";
      const doCtx = r.pen_do > 0 ? ` · terima DO ${fmtL(r.pen_do)} (konteks)` : "";
      items.push({
        tone: "danger",
        tier: lossTier(Math.abs(r.gl), ratio),
        sev: Math.abs(r.gl),
        dateIso: r.d,
        title: `Losses ${signedFmt(r.gl)} L${pctTxt}`,
        unit: unitTag,
        desc: `Gain/Losses operasional ${r.nama ?? r.ckdbbm} (metode RESUME: fisik − [fisik D−1 + ΣDO − jual bersih]) — di atas ambang 100 L / 0,5%. Kekurangan kiriman DO tergabung di sini${doCtx}.`,
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
      // abs() agar baris korup BERNILAI NEGATIF (mis. real −14 juta L) ikut
      // tertangkap sebagai kualitas-data, bukan lolos jadi "kekurangan kiriman".
      const garbage =
        Math.abs(s.voldo ?? 0) > GARBAGE_STOCK_L || Math.abs(s.volreal ?? 0) > GARBAGE_STOCK_L;
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

    // Kualitas data: penutup opname 0 padahal tangki tak pernah kosong.
    for (const z of byUnitZero.get(u.unit_id as number) ?? []) {
      items.push({
        tone: "warning",
        tier: "major",
        sev: Math.abs(z.prev),
        dateIso: z.d,
        title: `Penutup opname tercatat 0 — tangki ${z.ckdtangki}`,
        unit: unitTag,
        desc: `${z.nama ?? z.ckdbbm}: fisik penutup 0 padahal buku ${fmtL(z.bk)}, kemarin ${fmtL(z.prev)} dan besoknya ${fmtL(z.next)} tanpa penerimaan yang menjelaskan (DO H+1 ${fmtL(z.recv_next)}). Gain/Losses hari ini turun ~${fmtL(z.prev)} lalu naik setara besoknya — keduanya SEMU. Perlu koreksi entri opname di EasyMax.`,
        time: z.d,
        href,
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

/**
 * TTL cache feed anomali (detik). Keputusan owner D3 (2026-07-24).
 *
 * MASALAH: `buildAnomalies` menembakkan 8 query PARALEL per unit di dalam loop
 * unit yang SERIAL (lihat atas) → untuk armada 7 unit itu **56 query per render**
 * di atas pool `max: 5` (db.ts), dan ia dipanggil layout grup `(app)` di SETIAP
 * halaman. Terukur 2026-07-24: **240 item, 5,36 detik**, tiap render, tiap
 * halaman. Itu fondasi yang dipijak Laporan Harian; menambah beban di atasnya
 * tanpa membereskannya tidak masuk akal.
 *
 * PERBAIKAN yang dipilih dari tiga opsi owner ("batasi konkurensi / gabungkan
 * query / jangan panggil tiap render") = **yang ketiga**. Alasan menolak dua
 * lainnya, dengan angka:
 *  - Membatasi konkurensi inner (8→4) adalah PESIMISASI: total query tetap 56,
 *    tetapi tiap unit jadi 2 gelombang → wall-time naik, dan koneksi ditahan
 *    LEBIH LAMA (memperbesar risiko `connectionTimeoutMillis` 10 dtk), bukan
 *    lebih pendek. Puncak permintaan 8-di-atas-pool-5 sudah di-antre pg dengan
 *    aman hari ini (tak ada query mendekati 10 dtk: 5,36 dtk / 7 unit ≈ 0,77
 *    dtk per gelombang 8-query).
 *  - Menggabungkan 8 query jadi multi-unit berarti menulis ulang antara lain
 *    getDailyGlByProduct — 90 baris SQL paling kritis di proyek ini yang sudah
 *    kita tolak tulis-ulang secara sadar di Fase 2.
 *
 * KONSEKUENSI KONEKSI: puncak per-build TIDAK berubah (tetap 8), tetapi
 * FREKUENSInya turun dari "tiap render tiap halaman" jadi ≤1 per 120 detik per
 * (himpunan unit × tanggal WIB). Untuk direksi yang membuka 5 halaman dalam satu
 * menit: 280 query → 56.
 *
 * KESEGARAN: data sumbernya sendiri sudah bergerak dalam orde menit (jadwal
 * agent), dan shell me-refresh tiap 60 dtk (AutoRefresh) — 120 dtk tak menggeser
 * apa pun yang bisa ditindaklanjuti. Bandingkan skala insiden yang jadi alasan
 * pengawasan ini ada: agent Bakau mati **34 jam**.
 *
 * RBAC: key memuat daftar unit_id ber-scope yang TERURUT — dua pemakai berbagi
 * entri HANYA bila scope-nya identik (persis pola cache per-unit di gl-window.ts).
 * `todayWib()` masuk key agar cache berganti tepat di tengah malam WIB, bukan
 * menyajikan `today` kemarin selama 2 menit.
 *
 * ⚠️ EFEK KE `/board`: panel anomali board ikut memakai cache ini (satu fungsi,
 * dua pemanggil) → isinya bisa tertinggal ≤120 dtk. Disengaja & disebut di
 * deskripsi PR; revert = satu baris.
 */
const ANOMALIES_TTL_S = 120;

/** Feed anomali ber-cache — dipakai layout `(app)` dan `/board`. */
export function getAnomalies(units: ScopedUnit[]): Promise<AnomalyItem[]> {
  const ids = units
    .map((u) => u.unit_id as number)
    .sort((a, b) => a - b)
    .join(",");
  return unstable_cache(() => buildAnomalies(units), ["anomalies", todayWib(), ids], {
    revalidate: ANOMALIES_TTL_S,
  })();
}
