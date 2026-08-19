/**
 * Tangga toleransi penutupan hari — aturan MURNI (tanpa I/O).
 *
 * Sumber keputusannya [`KEUANGAN-HARIAN.md`](../../KEUANGAN-HARIAN.md) §3.2 dan
 * keputusan owner 13 Agustus 2026 untuk tingkat ketiga. Berkas ini menegakkan,
 * tidak memutuskan.
 *
 * | |selisih| | tier | siapa boleh menutup |
 * |---|---|---|
 * | ≤ Rp 10.000 | `within_tolerance` | penutup operasional (siapa pun yang berhak menutup) |
 * | Rp 10.001 – 100.000 | `exception_hof` | Direksi ∨ super_admin ∨ **Head of Finance** |
 * | > Rp 100.000 | `override_direksi` | Direksi ∨ super_admin — **TANPA HoF** |
 *
 * Tiga hal yang mudah dirusak:
 *
 * 1. **Yang diukur adalah LANGKAH HARIAN** `BSCheck(d) − BSCheck(d−1)` (§1.2),
 *    bukan nilai kumulatifnya. `BSCheck` kumulatif: satu residu lama akan
 *    memerahkan setiap hari sesudahnya selamanya, dan hari yang benar-benar
 *    rusak tenggelam di antaranya.
 * 2. **Ambangnya pada NILAI MUTLAK.** Toleransi soal besaran, bukan arah —
 *    kurang setor Rp 50.000 sama seriusnya dengan lebih setor Rp 50.000.
 * 3. **Selisih ≤ toleransi TIDAK dinolkan.** Ia tetap disimpan dengan
 *    `reason_code`-nya. Pola yang berulang hanya terlihat kalau yang kecil
 *    disimpan; gerbang yang membuang selisih kecil menghapus buktinya sendiri.
 */
import {
  canCloseException,
  canOverrideAboveMax,
  type WewenangCtx,
} from "./keuangan-wewenang";

/**
 * Batas toleransi operasional per hari per outlet (§3.2). Nilainya keputusan
 * owner — kalau berubah, §3.2 berubah lebih dulu, bukan sebaliknya. Cermin
 * ambang di CHECK `day_close_tier_matches_difference` (migrasi 0026); keduanya
 * harus bergerak bersama.
 */
export const TOLERANSI_RP = 10_000;
/** Batas atas wewenang Head of Finance (§3.2). Di atas ini: Direksi saja. */
export const BATAS_HOF_RP = 100_000;

export type Tier = "within_tolerance" | "exception_hof" | "override_direksi";

/**
 * Tier dari selisih. **Fungsi**, bukan pilihan — itulah sebabnya DB pun
 * menegakkannya (CHECK 0026): tanpa itu, selisih Rp 5 juta bisa ditulis
 * `within_tolerance` dan lolos tanpa persetujuan siapa pun.
 */
export function tierFor(differenceRp: number): Tier {
  const d = Math.abs(differenceRp);
  if (d <= TOLERANSI_RP) return "within_tolerance";
  if (d <= BATAS_HOF_RP) return "exception_hof";
  return "override_direksi";
}

/**
 * Penutup OPERASIONAL — tingkat pertama tangga §3.2 ("Rp 0" dan "s.d. Rp
 * 10.000": **Finance**, menurut tabel tangga di mockup Layar 4).
 *
 * 🔴 **LUBANG YANG DITUTUP DI SINI (17 Agu 2026).** Sampai hari ini
 * {@link bolehMenutup} mengembalikan `true` untuk tier pertama **bagi siapa
 * pun** — termasuk `pengawas`. Waktu aturan ini ditulis (K1), peran `keuangan`
 * belum ada, jadi "penutup operasional" tak punya wujud dan dibiarkan terbuka.
 * Sejak 0032 ia punya wujud, dan membiarkannya terbuka berarti pengawas bisa
 * menutup hari — mengunci `manual_entry`-nya sendiri terhadap koreksi.
 *
 * `super_admin` ikut, sejalan break-glass §10.11.
 */
export function bolehMenutupOperasional(ctx: WewenangCtx): boolean {
  return ctx.role === "keuangan" || ctx.role === "super_admin";
}

/**
 * Boleh menutup hari pada tier ini?
 *
 * Tiap tingkat menyebut SIAPA, dan tingkatnya adalah **alternatif**, bukan
 * syarat berlapis: Direksi yang meng-override tingkat ketiga tidak perlu juga
 * jadi Finance — satu-peran-per-orang membuat itu mustahil.
 *
 * ⛔ Tingkat ketiga memakai {@link canOverrideAboveMax}, **bukan**
 * `canCloseException`. Keduanya hanya beda satu suku (`isHeadOfFinance`), dan
 * suku itulah yang membuat tangga ini punya arti.
 */
export function bolehMenutup(tier: Tier, ctx: WewenangCtx, daftarHof?: readonly string[]): boolean {
  switch (tier) {
    case "within_tolerance":
      return bolehMenutupOperasional(ctx);
    case "exception_hof":
      return canCloseException(ctx, daftarHof);
    case "override_direksi":
      return canOverrideAboveMax(ctx);
  }
}

export interface SyaratTutup {
  /** Selisih langkah harian, apa adanya. */
  differenceRp: number;
  /** Kode dari master `reason_code`; `null` = belum dipilih. */
  reasonCode: string | null;
  /** `reason_code.requires_target_date` untuk kode itu; `null` bila kode null. */
  reasonRequiresTarget: boolean | null;
  /** `YYYY-MM-DD`; wajib bila kodenya menuntut target. */
  targetDate: string | null;
}

export type HasilTutup =
  | { boleh: true; tier: Tier }
  | { boleh: false; tier: Tier; kurang: ReadonlyArray<Kekurangan> };

export type Kekurangan = "reason_code" | "target_date" | "wewenang" | "persetujuan";

/**
 * Pemeriksaan lengkap sebelum hari boleh ditutup. SATU tempat yang memutuskan —
 * layar, server action, dan laporan semuanya memanggil ini, supaya tidak ada
 * dua jawaban untuk pertanyaan yang sama.
 *
 * `sudahDisetujui` dipisah dari wewenang: seseorang boleh **berwenang**
 * menyetujui dan tetap belum **menyetujui**. Menyatukannya membuat tier di luar
 * toleransi tertutup begitu orang yang tepat membuka layarnya.
 */
export function periksaTutupHari(
  syarat: SyaratTutup,
  ctx: WewenangCtx,
  opts: { sudahDisetujui: boolean; daftarHof?: readonly string[] },
): HasilTutup {
  const tier = tierFor(syarat.differenceRp);
  const kurang: Kekurangan[] = [];

  // §3.2: selisih bukan nol WAJIB bersebab — termasuk yang di dalam toleransi.
  if (syarat.differenceRp !== 0 && !syarat.reasonCode) kurang.push("reason_code");

  // Tanggal target dibaca dari DATA (`requiresTargetDate`), bukan dari nama
  // kode. Tidak ada 'CLS-INVESTIGATING' yang di-hardcode di mana pun.
  if (syarat.reasonRequiresTarget === true && !syarat.targetDate) kurang.push("target_date");

  if (!bolehMenutup(tier, ctx, opts.daftarHof)) kurang.push("wewenang");

  if (tier !== "within_tolerance" && !opts.sudahDisetujui) kurang.push("persetujuan");

  return kurang.length === 0 ? { boleh: true, tier } : { boleh: false, tier, kurang };
}
