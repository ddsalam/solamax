/**
 * Kueri kesehatan sinkronisasi per unit — bahan alarm "unit diam".
 *
 * ⚠️ KENAPA INI ADA. Imam Bonjol berhenti mengirim 16-09-2026 14:33 WIB dan baru
 * ketahuan 23 jam kemudian — bukan oleh sistem, melainkan karena Dion melaporkan
 * datanya hilang. Ini kejadian KEDUA dengan bentuk sama (Bakau 34,5 jam,
 * 24-07-2026, ketahuan karena Dion kebetulan membuka layar Ketaatan). Kedua kali
 * datanya sudah ada di `public.sync_state` sepanjang waktu; yang tidak ada adalah
 * sesuatu yang membacanya tanpa diminta.
 */

/**
 * Unit aktif — penyebut alarm.
 *
 * `public.unit` TIDAK ber-RLS (`relrowsecurity = f`), jadi ia terbaca tanpa
 * scope dan aman dipakai untuk menyusun daftar scope bagi kueri berikutnya.
 * Hanya `active` yang dihitung: unit non-aktif memang tidak mengirim apa-apa,
 * dan mengalarmkannya berarti melatih penerima untuk mengabaikan alarm.
 */
export const ACTIVE_UNITS_SQL = `
  SELECT unit_id, code, name
  FROM public.unit
  WHERE active
  ORDER BY unit_id
`;

/**
 * Scope RLS. WAJIB dijalankan di transaksi yang SAMA dengan kueri di bawah —
 * `set_config(..., true)` bersifat transaction-local.
 *
 * 🛑 `public.sync_state` ber-`FORCE ROW LEVEL SECURITY` dan peran `ingest`
 * **tidak** punya `BYPASSRLS` (diverifikasi di produksi 17-09-2026:
 * `rolbypassrls = f`, `relforcerowsecurity = t`). Tanpa scope, kueri di bawah
 * memulangkan **NOL BARIS TANPA ERROR** — yang akan terbaca sebagai "tidak ada
 * unit diam" dan menghasilkan alarm yang MUSTAHIL BERBUNYI. Nol baris dari scope
 * sempit bukan fakta; lihat `source-capture-sql.ts` yang menemukan akar insiden
 * kapasitas 14-09-2026 persis karena pengukuran ter-scope ke satu unit.
 */
export const SET_ALL_UNITS_SCOPE_SQL =
  "SELECT set_config('app.unit_ids', $1, true)";

/**
 * Umur sinkronisasi per unit.
 *
 * 🔑 Memakai **MAX**(`last_run_at`), bukan MIN. Cadence antar-domain berbeda jauh
 * secara sah: domain berjendela berjalan tiap ±3 menit, sedangkan `masters`,
 * `piutang`, dan `hutang` ikut cadence master (±1 jam) karena full-sync-nya berat
 * ~385k baris. MIN akan menyalakan alarm pada unit yang sehat sempurna. Yang
 * membuktikan agent hidup adalah domain yang PALING BARU: pada armada sehat
 * 17-09-2026 angkanya 0–2 menit di ketujuh unit, sementara unit yang mati
 * menunjukkan 23 jam — pemisahan tiga ordo besaran.
 *
 * `domains_total` ikut dibawa untuk membedakan "unit ini memang baru" dari
 * "unit ini berhenti".
 */
export const SYNC_AGE_BY_UNIT_SQL = `
  SELECT unit_id,
         MAX(last_run_at)                                            AS last_run_at,
         COUNT(*)::int                                               AS domains_total,
         EXTRACT(EPOCH FROM (now() - MAX(last_run_at)))::bigint      AS age_seconds
  FROM public.sync_state
  GROUP BY unit_id
`;
