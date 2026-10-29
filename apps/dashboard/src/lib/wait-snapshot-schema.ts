/** Migration 0039 is atomic, so this unique column appears only after the
 * complete v2 rebuild commits. Never retry unrelated K1 query failures. */
export const SNAPSHOT_V2_SCHEMA_READY_SQL = `
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'app' AND table_name = 'saldo_pelanggan_snapshot_row'
    AND column_name = 'akhir_hutang_lokal_kredit'
    AND is_nullable = 'NO' AND data_type = 'numeric'
) AS ready`;

/**
 * U6 (rencana 2026-10-29) — migrasi 0049 berjalan dalam satu transaksi; kolom
 * `cash_ledger.tanggal_asal` dan tabel `pihak_lawan_saldo_awal` muncul bersama
 * seluruh isinya. Penunggu yang sama, pertanyaan yang lain.
 */
export const PIHAK_LAWAN_SCHEMA_READY_SQL = `
SELECT (
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app' AND table_name = 'cash_ledger' AND column_name = 'tanggal_asal'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app' AND table_name = 'pihak_lawan_saldo_awal'
  )
) AS ready`;

/** U7 (rencana 2026-10-29) — kueri penebusan membaca tabel 0050. */
export const PENEBUSAN_SCHEMA_READY_SQL = `
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'app' AND table_name = 'penebusan'
) AS ready`;

/** Rencana 2026-10-29 U9 — tabel impor rekening koran (backend migration 0051). */
export const IMPOR_BANK_SCHEMA_READY_SQL = `
SELECT (
  SELECT count(*) FROM information_schema.tables
  WHERE table_schema = 'app' AND table_name IN ('rekening_koran', 'mutasi_bank')
) = 2 AS ready`;

/** U10 — kelompok cocok (0052): dua tabel + kolom `cash_ledger.lahir_dari_cocok_id`. */
export const COCOK_BANK_SCHEMA_READY_SQL = `
SELECT (
  SELECT count(*) FROM information_schema.tables
  WHERE table_schema = 'app' AND table_name IN ('cocok_bank', 'cocok_bank_baris')
) = 2
AND EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'app' AND table_name = 'cash_ledger' AND column_name = 'lahir_dari_cocok_id'
) AS ready`;

/**
 * U11 — 0053: `manual_entry.cash_ledger_id` (beban/pendapatan pintu Finance yang
 * lahir bersama baris kasnya). Satu kolom; ADD COLUMN-nya pernyataan pertama
 * migrasi, jadi kolom terlihat = migrasi sudah commit.
 */
export const MANUAL_ENTRY_KAS_SCHEMA_READY_SQL = `
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'app' AND table_name = 'manual_entry' AND column_name = 'cash_ledger_id'
) AS ready`;

/**
 * U12 — 0054: tabel `tutup_bulan` + kolom `day_close.koreksi_susulan_rp`.
 * Keduanya dituntut — layar tutup bulan membaca yang pertama, `getDayClose`
 * (tutup hari & ringkasan keuangan) membaca yang kedua.
 */
export const TUTUP_BULAN_SCHEMA_READY_SQL = `
SELECT (
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app' AND table_name = 'tutup_bulan'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'app' AND table_name = 'day_close' AND column_name = 'koreksi_susulan_rp'
  )
) AS ready`;

/** The backend and dashboard deployment workflows start concurrently. K1 must
 * wait for the backend's atomic upgrade before testing the new reader SQL. */
export async function waitForSnapshotV2Schema(
  readReady: () => Promise<boolean>,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
    /** Awal pesan galat tenggat — bawaannya menyebut 0039 (pemakai pertama). */
    notReady?: string;
  } = {},
): Promise<void> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + (options.timeoutMs ?? 10 * 60 * 1000);
  for (;;) {
    if (await readReady()) return;
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error(
        `${options.notReady ?? "snapshot_v2_schema_not_ready: backend migration 0039"} did not finish before dashboard K1 deadline`,
      );
    }
    await sleep(Math.min(options.intervalMs ?? 5000, remaining));
  }
}
