/**
 * Formula and load limits accepted at the B1 capacity gate. These are code
 * constants on purpose: an environment variable must not widen the build
 * window, raise concurrency, or postpone the 9 GB capacity review.
 */
export const SNAPSHOT_FORMULA_VERSION = "saldo-pelanggan-v2";

export const SNAPSHOT_OPERATIONAL_LIMITS = Object.freeze({
  timezone: "Asia/Pontianak",
  buildWindowStartMinutes: 2 * 60,
  buildWindowEndMinutes: 5 * 60,
  latestLeaseMinutes: 4 * 60 + 45,
  globalConcurrency: 1,
  databaseReviewBytes: 9_000_000_000,
  leaseSeconds: 2 * 60,
  heartbeatSeconds: 30,
  attemptSeconds: 15 * 60,
  statementSeconds: 10 * 60,
  publishSeconds: 30,
  poolAcquireMilliseconds: 1_000,
  maxAttempts: 5,
  retryInitialSeconds: 30,
  retryJitterFraction: 0.25,
} as const);

export type SnapshotOperationalLimits = typeof SNAPSHOT_OPERATIONAL_LIMITS;

/**
 * Batas pemensiunan source cut. Ada karena mode kegagalannya SENYAP DAN TOTAL:
 * prune yang tak berbatas berjalan di dalam satu transaksi ber-budget, jadi
 * sekali ia melewati budget, SELURUHNYA di-rollback dan pemanggilnya hanya
 * menulis satu baris peringatan ke stderr (`snapshot-worker.service.ts`).
 * Tidak ada kemajuan yang tersimpan, dan tumpukannya membesar — yang membuat
 * percobaan berikutnya lebih pasti gagal lagi.
 *
 * Terukur di produksi 12-13 September 2026: invokasi 114.521 ms dan 99.784 ms
 * terhadap budget 120.000 ms — 95% dan 83%. Keduanya masih commit, jadi tidak
 * ada peringatan; tebingnya tidak terlihat sampai dilewati.
 *
 * Dengan batch: tiap batch commit sendiri, jadi budget yang habis berarti
 * KEMAJUAN SEBAGIAN yang tersimpan, bukan nol.
 */
export const SNAPSHOT_RETIREMENT_LIMITS = Object.freeze({
  batchRows: 20_000,
  batchMilliseconds: 30_000,
  budgetMilliseconds: 90_000,
  /**
   * Di atas ini, laju pemensiunan tidak mengejar laju penangkapan.
   *
   * Dasarnya bukan selera: hanya cut ber-sequence tertinggi yang masih bisa
   * menang, jadi keadaan sehat = 1, dan 2 ketika satu cut sedang diunggah.
   * Ambang 4 memberi kelonggaran dua kali lipat sebelum berbunyi — cukup
   * longgar untuk tidak jadi alarm yang selalu menyala, cukup ketat untuk
   * berbunyi jauh sebelum 22 (keadaan produksi 14-09-2026, ±27 jam tanpa
   * pemensiunan, 3,38 GB/hari).
   */
  stagingReviewCount: 4,
  /**
   * Anggaran satu putaran pemensiunan LINTAS UNIT. Cloud Run memutus permintaan
   * pada 20 menit; sisakan ruang untuk HTTP/framework. Unit yang belum sempat
   * dilayani dilaporkan sebagai `skipped`, bukan didiamkan — dan karena
   * urutannya backlog-terbanyak-lebih-dulu, yang tersisa selalu yang paling
   * ringan.
   */
  allUnitsMilliseconds: 15 * 60 * 1_000,
  /**
   * Umur (jam) di mana "unit ini mengirim cut tetapi tak satu pun pernah
   * mencapai `complete`" berhenti wajar dan menjadi temuan.
   *
   * Build berjalan sekali sehari, jadi 26 jam = satu siklus penuh plus margin.
   * Ambangnya menuntut DUA syarat sekaligus (sudah lama mengirim DAN tak pernah
   * selesai) supaya ia tidak menyala pada unit yang bundle-nya baru ditukar
   * beberapa jam lalu — hari penukaran akan jadi alarm palsu setiap kali.
   */
  staleCompleteCutHours: 26,
} as const);

/**
 * First rollout covers seven prior dates; operators may explicitly widen to 31.
 *
 * ⚠️ `defaultItems`/`maxItems` menghitung BARIS KERJA, bukan manifest. Satu baris
 * kerja dapat menerbitkan dua manifest (baseline lalu target), jadi 8 item
 * pernah terbaca sebagai "9 complete + 1 failed" di produksi. Jangan menalar
 * ongkosnya dari jumlah manifest.
 *
 * Dinaikkan 8 -> 16 pada 18-09-2026, dan dasarnya aritmetika, bukan selera:
 *
 *   · CLEAR_DIRTY_IF_COVERED_SQL hanya mencabut watermark bila SELURUH pointer
 *     >= dirty_invalid_from bersih pada cut berjalan — artinya seluruh tunggakan
 *     harus tuntas DALAM SATU CUT. Unit 1 punya 12 pointer + hari ini = 13.
 *     Dengan 8, itu mustahil selamanya, dan watermark 2023-03-27 tak pernah
 *     tercabut. Dengan 16, tercapai sekali lalu selesai — MARK_STALE menuntut
 *     `dirty_invalid_from IS NOT NULL`, jadi sekali tuntas = tuntas.
 *   · Ongkosnya diukur dari `completed_at - started_at` di manifest produksi:
 *     median 1,0-1,4 detik per item; putaran terburuk 74 detik untuk 9 item
 *     (8,2 detik per item). 16 item = 16-22 detik pada median, 131 detik pada
 *     kasus terburuk — 1,3% dari jendela build 2 jam 45 menit, dan 12% dari
 *     `requestMilliseconds`. `maxItems: 8` tidak pernah menjadi anggaran waktu.
 *
 * Batasnya TIDAK dihapus: anggaran yang sebenarnya adalah `requestMilliseconds`,
 * dan batas item tetap perlu sebagai penjaga terhadap loop patologis. 24 adalah
 * pintu darurat operator untuk kejar-tayang sekali jalan (~197 detik pada kasus
 * terburuk), bukan nilai harian.
 */
export const SNAPSHOT_BACKFILL_LIMITS = Object.freeze({
  defaultDays: 7,
  maxDays: 31,
  defaultItems: 16,
  maxItems: 24,
  requestMilliseconds: 18 * 60 * 1_000,
} as const);
