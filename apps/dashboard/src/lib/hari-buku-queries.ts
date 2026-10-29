import type { PoolClient } from "pg";
import { tentukanHariBuku, type HasilHariBuku } from "./hari-buku";
import type { ScopedUnitId } from "./scope";

/**
 * PENJAGA HARI TERTUTUP untuk jalur tulis baru (rencana 2026-10-29 U2; KTD5,
 * R22, R28). Dipanggil **DI DALAM transaksi pemanggil**, sesudah
 * `set_config('app.unit_ids', …, true)` dan SEBELUM `INSERT` ke `cash_ledger`.
 *
 * ⛔ JANJINYA: tak pernah mengembalikan hari yang `closed`, dan hari yang
 * dikembalikan TETAP terbuka sampai transaksi pemanggil selesai. Caranya:
 *
 * 1. Kunci advisory BERSAMA per (unit, hari) — `tutupHari` mengambil kunci
 *    yang sama secara EKSKLUSIF sebelum menghitung ulang selisihnya. Jalur
 *    tulis yang sudah memegangnya membuat penutupan menunggu sampai COMMIT
 *    (barisnya ikut terhitung); jalur tulis yang datang sesudah penutup
 *    menunggu, lalu melihat harinya tertutup dan maju ke hari berikutnya.
 * 2. Status `day_close` dibaca ULANG sesudah kunci didapat (pernyataan baru,
 *    snapshot baru di READ COMMITTED) dan barisnya — bila ada — dikunci
 *    `FOR SHARE`, sehingga `FOR UPDATE` milik `tutupHari` pun bertabrakan.
 *
 * ⚠️ PENYIMPANGAN DARI RENCANA, DISENGAJA: KTD5 menulis "baris `day_close`
 * dipastikan ada (`INSERT … ON CONFLICT DO NOTHING` berstatus open) lalu
 * dikunci `FOR SHARE`". Baris minimal itu MUSTAHIL tanpa angka: 0026 menuntut
 * `difference_rp NOT NULL` dan `tier` yang cocok dengannya, jadi satu-satunya
 * baris yang bisa ditulis adalah selisih **Rp 0** — dan §10.15 melarang persis
 * itu ("nol terbaca seimbang, padahal belum terhitung"); Papan (Layar 1) dan
 * Pemantauan juga akan membaca hari yang tak pernah dibuka sebagai "pernah
 * dinilai". Kunci advisory menutup celah yang sama untuk hari TANPA baris,
 * tanpa menulis apa pun ke `day_close`.
 *
 * ⚠️ BATAS YANG DISEBUT: `simpanMutasiKas` (jalur ketik lama) TIDAK memakai
 * penjaga ini — celah lama yang direkomendasikan rencana untuk PR terpisah
 * (Outstanding Questions). Jalur lama tetap bisa menulis ke hari tertutup.
 */

const KUNCI_SQL =
  "hashtextextended('day-close:' || $1::text || ':' || $2::text, 0)";

/** Jalur tulis: kunci BERSAMA — banyak penulis boleh bersamaan di satu hari. */
export async function kunciHariBersama(c: PoolClient, unitId: ScopedUnitId, hari: string): Promise<void> {
  await c.query(`SELECT pg_advisory_xact_lock_shared(${KUNCI_SQL})`, [unitId, hari]);
}

/**
 * Penutup: kunci EKSKLUSIF — menunggu semua penulis yang sedang memegang hari
 * itu, dan menahan penulis baru sampai penutupan COMMIT. Dipakai `tutupHari`.
 */
export async function kunciHariEksklusif(c: PoolClient, unitId: ScopedUnitId, hari: string): Promise<void> {
  await c.query(`SELECT pg_advisory_xact_lock(${KUNCI_SQL})`, [unitId, hari]);
}

export type HasilHariBukuTerkunci =
  | Extract<HasilHariBuku, { status: "pra-cut-over" }>
  | (Extract<HasilHariBuku, { status: "dibukukan" }> & {
      /** R28: baris yang terdorong maju WAJIB membawa kode alasan `ADJ-FWD-*`. */
      perluKodeAlasan: boolean;
    });

/** Batas ulang bila hari tujuan ditutup tepat di antara membaca dan mengunci. */
const MAKS_PERCOBAAN = 5;

export interface OpsiHariBuku {
  /**
   * Rekening tujuan. Bila diisi, cut-over-nya adalah saldo pembuka REKENING itu
   * (§10.24 butir 2 — persis `simpanMutasiKas`), jatuh ke cut-over terawal unit
   * (§10.26, `cutOverTerawal`) bila rekening itu belum punya saldo pembuka.
   */
  accountId?: string | null;
}

export async function hariBukuTerkunci(
  c: PoolClient,
  unitId: ScopedUnitId,
  tanggal: string,
  opsi: OpsiHariBuku = {},
): Promise<HasilHariBukuTerkunci> {
  // ⛔ PRASYARAT, DIPERIKSA — bukan dipercaya. Tanpa `app.unit_ids` berisi unit
  //    ini, RLS menyembunyikan SEMUA baris `day_close`, dan setiap hari tampak
  //    terbuka: penjaga ini akan menulis ke hari tertutup tanpa galat. Karena
  //    GUC-nya transaction-local (`set_config(…, true)`), keberadaannya juga
  //    bukti bahwa kita di dalam transaksi — kunci `xact` di luar transaksi
  //    lepas seketika. READ COMMITTED wajib: di REPEATABLE READ snapshot beku
  //    sebelum kunci didapat, jadi penutupan yang baru COMMIT tak terlihat.
  const pra = await c.query<{ diScope: boolean; isolasi: string }>(
    `SELECT $1::int = ANY (ARRAY(
              SELECT tok::int
                FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
               WHERE tok ~ '^-?[0-9]+$'
            )) AS "diScope",
            current_setting('transaction_isolation') AS isolasi`,
    [unitId],
  );
  if (!pra.rows[0]?.diScope) {
    throw new Error(
      "hariBukuTerkunci: app.unit_ids transaksi ini tidak memuat unit tujuan — " +
        "panggil di dalam BEGIN sesudah set_config('app.unit_ids', …, true).",
    );
  }
  if (pra.rows[0].isolasi !== "read committed") {
    throw new Error(`hariBukuTerkunci: butuh READ COMMITTED, transaksi ini ${pra.rows[0].isolasi}.`);
  }

  // Cut-over dari sumber yang sama dengan `simpanMutasiKas` (baris saldo_awal
  // non-void, §10.24) dan laporan (`cutOverTerawal`, §10.26).
  const cut = await c.query<{ unit: string | null; akun: string | null }>(
    `SELECT to_char(min(business_date), 'YYYY-MM-DD') AS unit,
            to_char(min(business_date) FILTER (WHERE account_id = $2::uuid), 'YYYY-MM-DD') AS akun
       FROM app.cash_ledger
      WHERE unit_id = $1 AND saldo_awal AND NOT void`,
    [unitId, opsi.accountId ?? null],
  );
  const cutOver = cut.rows[0]?.akun ?? cut.rows[0]?.unit ?? null;

  for (let i = 0; i < MAKS_PERCOBAAN; i++) {
    const tutup = await c.query<{ d: string }>(
      `SELECT to_char(business_date, 'YYYY-MM-DD') AS d
         FROM app.day_close
        WHERE unit_id = $1 AND business_date >= $2::date AND status = 'closed'`,
      [unitId, tanggal],
    );
    const hasil = tentukanHariBuku({ tanggal, cutOver, tertutup: tutup.rows.map((r) => r.d) });
    if (hasil.status === "pra-cut-over") return hasil;

    await kunciHariBersama(c, unitId, hasil.hariBuku);
    // Dibaca ULANG sesudah kunci: penutupan yang COMMIT selagi kita menunggu
    // kini terlihat. Hari tanpa baris = terbuka (§10.15) — tak ada yang dikunci
    // baris, kunci advisory di atas yang menahannya.
    const kini = await c.query<{ status: string }>(
      `SELECT status::text AS status
         FROM app.day_close
        WHERE unit_id = $1 AND business_date = $2::date
        FOR SHARE`,
      [unitId, hasil.hariBuku],
    );
    if (kini.rows[0]?.status === "closed") continue; // ditutup bersamaan → cari lagi

    return { ...hasil, perluKodeAlasan: hasil.terdorongMaju };
  }
  throw new Error(
    `hariBukuTerkunci: hari tujuan terus ditutup bersamaan (${MAKS_PERCOBAAN}×) — coba lagi.`,
  );
}
