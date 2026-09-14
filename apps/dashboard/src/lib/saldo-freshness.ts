import type { SaldoPelanggan } from "./saldo-snapshot";

/**
 * F1 — deteksi kesegaran snapshot piutang. MURNI, tanpa impor database.
 *
 * ⚠️ LUBANG YANG DITUTUPNYA. `pendingBanner()` lama hanya menyala saat pointer
 * ber-`pending_replacement`, dan tanda itu hanya dipasang ketika ada cut
 * `complete` BARU — sekali sehari, 02:05 WIB. Pada 13-09-2026 koreksi mundur
 * masuk 08:34/08:38 dan layar meleset **Rp 35.979.362** selama ±18 jam tanpa
 * satu pun indikator; banner yang sudah dibangun tidak mungkin muncul.
 *
 * ⚠️ KENAPA MEMBANDINGKAN, BUKAN MEM-PROBE `ingested_at`.
 * Rancangan pertama saya menelusuri baris mirror yang berubah sesudah cut. Ia
 * menuntut `dashboard_app` membaca `app.saldo_pelanggan_source_*` — dan
 * `0037_saldo_pelanggan_snapshot` **sengaja MENCABUT** hak itu, dengan
 * komentarnya sendiri: *"dashboard_app reads only published snapshot surfaces.
 * It cannot read source cuts."* Penjaga `hak-dml.guard` repo ini yang
 * menangkapnya. Membalik batas keamanan yang disengaja demi sebuah banner
 * adalah harga yang salah.
 *
 * Bentuk ini membandingkan **saldo hidup** (`readSaldoPelangganLegacy`, yaitu
 * `getSaldoPelanggan` — rumus yang sudah diverifikasi sampai rupiah terhadap
 * EasyMax) dengan **total yang tersimpan di manifest snapshot**. Keduanya sudah
 * boleh dibaca dashboard. Tidak ada hak baru, tidak ada SQL baru, dan tidak ada
 * rumus kedua yang bisa menyimpang dari yang pertama.
 *
 * Bonus yang hilang pada rancangan pertama: karena saldo hidup membaca master
 * pelanggan secara langsung, perubahan **klasifikasi** (Lokal/Online) ikut
 * terdeteksi. Rancangan `ingested_at` buta terhadapnya, karena
 * `pelanggan_master` tidak menyimpan waktu perubahan.
 */

export type SaldoBucket = "piutangLokal" | "piutangOnline" | "hutangLokal";

export interface SaldoFreshnessBucket {
  bucket: SaldoBucket;
  /** hidup − snapshot, pada batas akhir hari. */
  deltaRupiah: number;
}

export interface SaldoFreshness {
  /** Ada selisih yang MENGUBAH angka tanggal ini. */
  material: boolean;
  buckets: SaldoFreshnessBucket[];
  /** Jumlah MUTLAK seluruh selisih — supaya piutang naik dan hutang turun tidak saling menghapus. */
  totalAbsolut: number;
}

/**
 * Toleransi perbandingan. `numeric` dibaca lewat `::float8` di jalur baca, jadi
 * dua nilai yang secara desimal identik dapat berbeda pada digit terakhir
 * biner. Satu rupiah jauh di bawah apa pun yang layak ditampilkan, dan jauh di
 * atas artefak floating-point terbesar yang pernah terukur di arc ini
 * (deviasi TOTAL 0,0000746 — lihat catatan artefak numeric 2026-08-06).
 */
export const SALDO_FRESHNESS_TOLERANCE = 1;

/** Bandingkan saldo hidup dengan total snapshot. MURNI. */
export function compareFreshness(
  live: SaldoPelanggan,
  snapshotTotals: SaldoPelanggan,
): SaldoFreshness {
  const buckets: SaldoFreshnessBucket[] = (
    ["piutangLokal", "piutangOnline", "hutangLokal"] as const
  )
    .map((bucket) => ({
      bucket,
      deltaRupiah: live.akhir[bucket] - snapshotTotals.akhir[bucket],
    }))
    .filter((row) => Math.abs(row.deltaRupiah) >= SALDO_FRESHNESS_TOLERANCE);

  return {
    material: buckets.length > 0,
    buckets,
    totalAbsolut: buckets.reduce((sum, row) => sum + Math.abs(row.deltaRupiah), 0),
  };
}
