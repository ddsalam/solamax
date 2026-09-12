/**
 * Formula and load limits accepted at the B1 capacity gate. These are code
 * constants on purpose: an environment variable must not widen the build
 * window, raise concurrency, or postpone the 9 GB capacity review.
 */
export const SNAPSHOT_FORMULA_VERSION = "saldo-pelanggan-v1";

export const SNAPSHOT_OPERATIONAL_LIMITS = Object.freeze({
  timezone: "Asia/Pontianak",
  // PELONGGARAN SEMENTARA - 2026-09-12, atas keputusan eksplisit Dion.
  // Jendela build normal 02.00-05.00 WIB dilebarkan sepanjang hari HANYA untuk
  // menjalankan kanari snapshot Imam Bonjol pada sore hari; layar
  // /keuangan/piutang hanya membaca snapshot dan tak ada jalur lain.
  // WAJIB DIKEMBALIKAN ke 2*60 / 5*60 / 4*60+45 segera setelah kanari selesai.
  buildWindowStartMinutes: 0,
  buildWindowEndMinutes: 24 * 60,
  latestLeaseMinutes: 23 * 60,
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
