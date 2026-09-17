/**
 * Kueri pengawas pergerakan angka pada data BEKU.
 *
 * ⚠️ KENAPA IA TINGGAL DI DIREKTORI sync-health. Bukan karena ia soal sinkronisasi,
 * melainkan karena RELNYA di sini: log severity ERROR -> log-based metric ->
 * alert policy. Proyek ini punya SATU rel alarm (#372) dan syaratnya jelas —
 * menumpang, jangan membuat rel kedua. Satu endpoint, satu job Scheduler, satu
 * rahasia; penanda log-nya yang berbeda, karena penanggapnya berbeda.
 *
 * ⛔ DEFINISI BEKU tidak dihitung ulang di sini. Ia sudah dibekukan ke kolom
 * `frozen` saat perekaman (lihat RECORD_SHIFT_SQL), memakai definisi tunggal
 * milik G5: as_of_date < source_completed_at::date - 7.
 */

/**
 * Scope RLS. WAJIB satu transaksi dengan kueri di bawah — `set_config(..., true)`
 * bersifat transaction-local.
 *
 * 🛑 `app.saldo_pelanggan_shift` ber-FORCE ROW LEVEL SECURITY dan peran backend
 * tidak punya BYPASSRLS. Tanpa scope, kueri di bawah memulangkan NOL BARIS TANPA
 * ERROR — dan di sini nol baris adalah persis BENTUK KEADAAN SEHAT, jadi ia akan
 * terbaca sebagai "tidak ada pergeseran yang belum diakui". Hijau palsu yang
 * sempurna. Itulah sebab kontrol positif di bawah ada.
 */
export const SET_ALL_UNITS_SCOPE_SQL =
  "SELECT set_config('app.unit_ids', $1, true)";

/**
 * KONTROL POSITIF. Menjawab satu pertanyaan saja: apakah permukaan ber-RLS ini
 * benar-benar terbaca?
 *
 * `saldo_pelanggan_snapshot_pointer` dipilih sebagai subjeknya karena ia tabel
 * ber-RLS di skema yang sama dengan policy yang sama, DAN keberadaannya tak
 * bergantung pada ada-tidaknya pergeseran: armada yang menyajikan piutang pasti
 * punya pointer. Nol pointer pada armada ber-unit-aktif jauh lebih mungkin
 * berarti "scope gagal" ketimbang "tak satu pun unit pernah punya snapshot".
 *
 * Konsekuensi yang disengaja: armada yang benar-benar belum pernah membangun
 * snapshot akan dilaporkan `scope_returned_nothing`, bukan "bersih". Kami memilih
 * berisik di sisi itu — pengawas yang tidak bisa jalan wajib memulangkan keadaan
 * TIDAK DIKETAHUI, bukan ketenangan.
 */
export const RLS_POSITIVE_CONTROL_SQL = `
  SELECT (SELECT count(*) FROM app.saldo_pelanggan_snapshot_pointer)::bigint AS pointer_rows,
         (SELECT count(*) FROM app.saldo_pelanggan_shift)::bigint            AS shift_rows
`;

/**
 * Pergeseran pada data beku yang BELUM DIAKUI siapa pun.
 *
 * Kuncinya menyertakan `generation_id`, jadi pengakuan terikat pada NILAI: kalau
 * tanggal yang sudah disetujui bergeser lagi, generasinya baru, barisnya baru,
 * dan ia muncul lagi di sini. Tidak ada jalur di mana pengakuan lama membungkam
 * pergeseran baru.
 *
 * Selisih dibawa langsung supaya email alarm bisa ditindak tanpa membuka psql —
 * penerimanya sedang tidak di depan terminal.
 */
export const UNACKNOWLEDGED_FROZEN_SHIFTS_SQL = `
  SELECT s.unit_id,
         s.as_of_date,
         s.generation_id,
         s.previous_generation_id,
         s.source_cycle_sequence,
         s.detected_at,
         (COALESCE(s.after_akhir_piutang_lokal, 0)  - COALESCE(s.before_akhir_piutang_lokal, 0))  AS geser_piutang_lokal,
         (COALESCE(s.after_akhir_piutang_online, 0) - COALESCE(s.before_akhir_piutang_online, 0)) AS geser_piutang_online,
         (COALESCE(s.after_akhir_hutang_lokal, 0)   - COALESCE(s.before_akhir_hutang_lokal, 0))   AS geser_hutang_lokal
  FROM app.saldo_pelanggan_shift s
  WHERE s.frozen
    AND NOT EXISTS (
      SELECT 1
      FROM app.saldo_pelanggan_shift_ack a
      WHERE a.unit_id = s.unit_id
        AND a.as_of_date = s.as_of_date
        AND a.generation_id = s.generation_id
    )
  ORDER BY s.unit_id, s.as_of_date, s.source_cycle_sequence
`;
