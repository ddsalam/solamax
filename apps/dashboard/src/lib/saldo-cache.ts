/**
 * Cache Saldo Piutang/Hutang — query TERBERAT di halaman Laporan Operasional.
 *
 * TERUKUR (KB, 2026-08-04, DB pilot): `getSaldoPelanggan` **104.006 ms**, yakni
 * 71% dari 146 dtk total 17 query yang ditembakkan render Laporan. Ia mengunci
 * satu koneksi dari pool selama itu; 12 query lain berebut 3 slot sisa dan
 * antre ±9,5 dtk — tepat di bibir `connectionTimeoutMillis: 10_000` di db.ts.
 * Hasilnya `timeout exceeded when trying to connect` dan halaman jatuh ke error
 * boundary. Kelas yang SAMA sudah pernah menjatuhkan `/board` (lihat catatan
 * panjang di anomalies.ts) — obatnya di sana juga cache + pecah gelombang.
 *
 * Kenapa query itu mahal dan makin mahal: ia saldo BERJALAN tanpa batas bawah
 * (`dtgl < tanggal`), jadi tiap render memindai ulang seluruh riwayat. `bppiut`
 * = 2,76 juta baris / 1.805 MB, KB sendiri 926.950 baris sejak 2011-10-06, di
 * instance ber-RAM 1,7 GB. BUKAN masalah index: `bppiut_unit_id_dtgl_idx` ADA,
 * dan memaksa jalur index justru 112,0 dtk vs 49,7 dtk seq scan — planner benar.
 *
 * ATURAN CAKUPAN (keputusan owner):
 *   - tanggal HISTORIS (≤ hari-ini − 2) → revalidate 24 jam
 *   - hari berjalan & H−1          → TTL pendek 120 dtk
 * Batas H−2 disalin dari gl-window.ts dan alasannya sama: angka untuk hari yang
 * penutupnya belum masuk masih bisa bergerak; meng-cache-nya 24 jam akan
 * mengawetkan nilai provisional. Saldo hari ini yang basi sehari penuh di
 * laporan operasional adalah regresi KOREKTNESS, bukan sekadar angka lawas.
 *
 * Cache per (unit, tanggal) — BUKAN per user — dan hanya dibaca setelah unit
 * lolos `ScopedUnitId` dari getDataScope(); tak ada jalur bocor. Mekanisme
 * bawaan Next, TANPA tabel cache di DB (jalur baca tetap read-only penuh).
 */
import { unstable_cache } from "next/cache";
import { addDays, todayWib } from "./periods";
import { getSaldoPelanggan, type SaldoPelanggan } from "./queries";
import type { ScopedUnitId } from "./scope-rule";

/** Revalidate tanggal historis — selaras cadence koreksi back-dated agent. */
export const SALDO_HIST_REVALIDATE_S = 86_400;
/**
 * TTL hari berjalan & H−1 — kembali ke 120 dtk (preseden anomalies.ts).
 *
 * Sempat dinaikkan SEMENTARA ke 15 menit (PR #179) karena TTL-nya lebih pendek
 * daripada biaya mengisinya: `getSaldoPelanggan` 104 dtk, dan `unstable_cache`
 * MEMBLOKIR saat kedaluwarsa (terukur di build pilot: jeda >120 dtk membayar
 * penuh lagi). Kedua syarat pengembalian yang ditulis di sana kini terpenuhi:
 *
 *   (a) UPSERT ingest memakai `IS DISTINCT FROM` — full-sync berhenti menulis
 *       ulang seluruh ledger (PR #182);
 *   (b) `bppiut`/`bphut` di-reclaim (VACUUM FULL 2026-08-05).
 *
 * Terukur berpasangan rapat di jendela yang sama, DB pilot:
 *   T0 sebelum reclaim  15,7 dtk   (dan 17,5 dtk sejam sebelumnya)
 *   T2 sesudah reclaim   1,47 dtk  (ulang: 1,41)  → 10,7× lebih cepat
 * Nilai query identik di ketiganya; hanya durasinya yang berubah.
 *
 * Dengan query 1,47 dtk, TTL 120 dtk kembali LEBIH PANJANG daripada biaya
 * mengisinya — alasan menaikkannya hilang, dan awetan pendek lebih baik untuk
 * angka hari berjalan.
 */
export const SALDO_LIVE_REVALIDATE_S = 120;

/**
 * Berapa lama hasil untuk `date` boleh diawetkan, relatif ke `today`. MURNI
 * agar teruji unit tanpa runtime Next. Batas historis = hari-ini − 2.
 */
export function saldoRevalidateSeconds(date: string, today: string): number {
  return date <= addDays(today, -2) ? SALDO_HIST_REVALIDATE_S : SALDO_LIVE_REVALIDATE_S;
}

/**
 * JANGAN SAJIKAN NOL-SEMUA DARI CACHE — kembaran jebakan D13 di gl-window.ts.
 * Bila (unit, tanggal) pernah diminta saat backfill unit baru BELUM memuat
 * `bppiut`, hasilnya nol-semua dan `unstable_cache` akan menyajikannya 24 jam.
 * Nol tak bisa dibedakan dari "memang tidak ada piutang". Unit yang saldonya
 * benar-benar nol hanya membayar query lambat — bukan angka salah.
 */
export function shouldBypassEmptySaldo(s: SaldoPelanggan): boolean {
  return s.piutangLokal === 0 && s.piutangOnline === 0 && s.hutangLokal === 0;
}

/** Ambil dari cache; nol-semua → ulang segar (lihat shouldBypassEmptySaldo). */
export async function resolveSaldo(
  cached: () => Promise<SaldoPelanggan>,
  fresh: () => Promise<SaldoPelanggan>,
): Promise<SaldoPelanggan> {
  const hit = await cached();
  if (!shouldBypassEmptySaldo(hit)) return hit;
  return fresh();
}

/**
 * Saldo Piutang/Hutang untuk (unit, tanggal) — lewat cache sesuai aturan di
 * atas. Nilai & bentuknya identik `getSaldoPelanggan`; hanya kapan query itu
 * benar-benar menyentuh DB yang berubah.
 */
export function getSaldoPelangganCached(
  unit: ScopedUnitId,
  date: string,
  today: string = todayWib(),
): Promise<SaldoPelanggan> {
  const revalidate = saldoRevalidateSeconds(date, today);
  return resolveSaldo(
    unstable_cache(
      () => getSaldoPelanggan(unit, date),
      ["saldo-pelanggan", String(unit), date],
      { revalidate },
    ),
    () => getSaldoPelanggan(unit, date),
  );
}
