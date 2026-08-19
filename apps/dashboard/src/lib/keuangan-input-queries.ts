import { qScoped } from "./db";
import type { ScopedUnitId } from "./scope";
import type { PurchasePriceRow, SellPricePoint } from "./harga-beli";
import type { AkunKasRow } from "./keuangan-akun-model";
import type { BarisBiaya } from "./keuangan-biaya-model";
import type { Settlement } from "./keuangan-edc";
import type { MutasiKas } from "./keuangan-kas";
import type { AkunKas, SetoranPengawas } from "./keuangan-kas-model";

/**
 * Kueri BACA untuk Layar 3 — Input Keuangan (mockup layar 3, blok 1).
 *
 * Semuanya lewat `qScoped()` dengan `ScopedUnitId` ber-brand: lupa men-scope =
 * error type-check, dan RLS 0016 memfilter ulang di DB (fail-closed).
 *
 * ⛔ HARGA JUAL TIDAK PERNAH DIKETIK. Ia datang dari EasyMax (`sales_detail`),
 * dan di layar ia hanya DITAMPILKAN berdampingan dengan harga beli. Satu-satunya
 * angka yang diketik manusia di blok ini adalah harga beli — itulah sebabnya ia
 * dijaga dua penjaga (§4.1), sebab ia satu-satunya angka besar tanpa sumber
 * pembanding.
 */

/** Produk BBM unit ini, dari master EasyMax. */
export interface ProdukUnit {
  productKey: string;
  nama: string;
}

export async function getProdukUnit(unit: ScopedUnitId): Promise<ProdukUnit[]> {
  return qScoped<ProdukUnit>(
    unit,
    `SELECT trim(p.ckdbbm) AS "productKey",
            COALESCE(p.vcnmbbm, trim(p.ckdbbm)) AS nama
       FROM product p
      WHERE p.unit_id = $1
      ORDER BY 2`,
    [unit],
  );
}

/**
 * SELURUH baris harga beli unit ini (termasuk yang `void`).
 *
 * Yang void ikut ditarik dengan sengaja: `effectiveBuyPrice` dan `evaluateP2`
 * menyaringnya sendiri, dan menyaringnya di SQL akan membuat kedua fungsi murni
 * itu tak pernah teruji terhadap keadaan yang sebenarnya bisa terjadi. Volumenya
 * kecil — satu baris per produk per perubahan harga.
 */
export async function getHargaBeliRows(unit: ScopedUnitId): Promise<PurchasePriceRow[]> {
  return qScoped<PurchasePriceRow>(
    unit,
    `SELECT product_key                        AS "productKey",
            to_char(effective_from,'YYYY-MM-DD') AS "effectiveFrom",
            price::float8                      AS price,
            void
       FROM app.purchase_price
      WHERE unit_id = $1
      ORDER BY product_key, effective_from`,
    [unit],
  );
}

/** Baris harga beli + jejak pengakuan P1-nya — untuk kolom "Berlaku sejak" & riwayat. */
export interface HargaBeliDetail extends PurchasePriceRow {
  id: string;
  p1Triggered: boolean;
  p1Reason: string | null;
  sourceNote: string | null;
}

export async function getHargaBeliDetail(unit: ScopedUnitId): Promise<HargaBeliDetail[]> {
  return qScoped<HargaBeliDetail>(
    unit,
    `SELECT id::text                            AS id,
            product_key                         AS "productKey",
            to_char(effective_from,'YYYY-MM-DD') AS "effectiveFrom",
            price::float8                       AS price,
            void,
            p1_triggered                        AS "p1Triggered",
            p1_reason                           AS "p1Reason",
            source_note                         AS "sourceNote"
       FROM app.purchase_price
      WHERE unit_id = $1 AND NOT void
      ORDER BY product_key, effective_from DESC`,
    [unit],
  );
}

/**
 * Jendela riwayat harga jual yang ditarik untuk mengevaluasi P2, dalam hari.
 *
 * ⚠️ BATAS YANG DISENGAJA, sebut apa adanya: perubahan harga jual yang terjadi
 * LEBIH LAMA dari jendela ini tidak terlihat, sehingga P2 **tidak menagih**
 * untuk kasus itu. Arah kesalahannya dipilih sadar — jendela pendek membuat
 * penjaga DIAM, bukan berbunyi palsu. Penjaga yang berbunyi palsu akan diabaikan
 * dalam sebulan, dan setelah itu ia tak menjaga apa pun.
 *
 * 180 hari ≈ dua kali jarak antar-perubahan harga Pertamina yang teramati di
 * data Bakau. Kalau kelak harga membeku lebih lama dari ini, yang perlu diubah
 * adalah angkanya di sini — bukan aturannya di `harga-beli.ts`.
 */
export const JENDELA_HARGA_JUAL_HARI = 180;

/**
 * Riwayat harga jual per produk per tanggal bisnis, dari EasyMax.
 *
 * Satu titik per (produk, tanggal) = harga jual TERAKHIR yang teramati hari itu
 * — konvensi yang sama dengan `getSalesByProduct`. Hari tanpa penjualan tidak
 * menghasilkan titik, dan `evaluateP2` memang menangani deret berlubang.
 */
export async function getHargaJualHistory(
  unit: ScopedUnitId,
  asOf: string,
  windowDays: number = JENDELA_HARGA_JUAL_HARI,
): Promise<Map<string, SellPricePoint[]>> {
  const rows = await qScoped<{ productKey: string; date: string; price: number }>(
    unit,
    `SELECT DISTINCT ON (trim(sd.ckdbbm), h.dtgljual)
            trim(sd.ckdbbm)                     AS "productKey",
            to_char(h.dtgljual,'YYYY-MM-DD')    AS date,
            sd.nhargajual::float8               AS price
       FROM sales_detail sd
       JOIN sales_header h
         ON h.unit_id = sd.unit_id AND h.ckdjualbbm = sd.ckdjualbbm
      WHERE sd.unit_id = $1
        AND h.dtgljual > $2::date - $3::int
        AND h.dtgljual <= $2::date
      ORDER BY trim(sd.ckdbbm), h.dtgljual, sd.dtgljam DESC`,
    [unit, asOf, windowDays],
  );
  const out = new Map<string, SellPricePoint[]>();
  for (const r of rows) {
    const arr = out.get(r.productKey) ?? [];
    arr.push({ date: r.date, price: r.price });
    out.set(r.productKey, arr);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Blok 2 — buku kas besar & lima buku bank
// ---------------------------------------------------------------------------


export async function getAkunKas(unit: ScopedUnitId): Promise<AkunKas[]> {
  return qScoped<AkunKas>(
    unit,
    `SELECT id::text AS id, nama, kind::text AS kind, active
       FROM app.cash_account
      WHERE unit_id = $1
      ORDER BY (kind <> 'kas'), nama`,
    [unit],
  );
}

export interface MutasiKasRow extends MutasiKas {
  id: string;
  keterangan: string;
  sourceManualEntryId: string | null;
}

/**
 * SELURUH mutasi unit ini SAMPAI DENGAN `to`.
 *
 * ⚠️ Tidak difilter tanggal-awal dengan sengaja: saldo adalah **kumulatif sejak
 * awal buku**, jadi memotong ekornya akan menghasilkan saldo yang rapi dan
 * salah. Baris `void` ikut ditarik — `saldoAkun`/`barisBuku` menyaringnya, dan
 * menyaring di SQL membuat fungsi murni itu tak pernah teruji terhadap keadaan
 * yang benar-benar bisa terjadi.
 *
 * Volumenya kecil: satu unit menghasilkan beberapa baris kas per hari, dan
 * indeks parsial `cash_ledger_saldo_idx` (0029) melayani jalur ini.
 */
export async function getMutasiKas(unit: ScopedUnitId, to: string): Promise<MutasiKasRow[]> {
  return qScoped<MutasiKasRow>(
    unit,
    `SELECT id::text                              AS id,
            account_id::text                      AS "accountId",
            to_char(business_date,'YYYY-MM-DD')   AS "businessDate",
            keterangan,
            jenis::text                           AS jenis,
            category_side::text                   AS "categorySide",
            category_label                        AS "categoryLabel",
            amount::float8                        AS amount,
            void,
            source_manual_entry_id::text          AS "sourceManualEntryId"
       FROM app.cash_ledger
      WHERE unit_id = $1 AND business_date <= $2::date
      ORDER BY business_date, created_at`,
    [unit, to],
  );
}

/** Daftar kategori mutasi (daftar TERTUTUP, 0029) — untuk pilihan di form. */
export async function getKategoriMutasi(
  unit: ScopedUnitId,
): Promise<{ side: "debet" | "kredit"; label: string }[]> {
  // Tabel ini TIDAK unit-scoped (master global), tetapi tetap dibaca lewat
  // qScoped agar konteks RLS transaksi seragam dengan kueri lain di halaman —
  // dan agar tak ada satu pun jalur baca halaman ini yang lolos tanpa scope.
  return qScoped<{ side: "debet" | "kredit"; label: string }>(
    unit,
    `SELECT side::text AS side, label
       FROM app.cash_mutation_category
      WHERE active
      ORDER BY side, label`,
  );
}

/**
 * Setoran per shift yang sudah diisi pengawas di Rincian Penjualan.
 * Inilah bahan baris kas yang DITAWARKAN — nominalnya tak diketik ulang.
 */
export async function getSetoranPengawas(
  unit: ScopedUnitId,
  date: string,
): Promise<SetoranPengawas[]> {
  return qScoped<SetoranPengawas>(
    unit,
    `SELECT id::text AS id, keterangan, amount::float8 AS amount
       FROM app.manual_entry
      WHERE unit_id = $1 AND business_date = $2::date
        AND section = 'setoran_tunai'::app.manual_entry_section
        AND NOT void
      ORDER BY urut, created_at`,
    [unit, date],
  );
}

// ---------------------------------------------------------------------------
// Blok 3 — settlement EDC
// ---------------------------------------------------------------------------

export interface SettlementRow extends Settlement {
  settlementNo: string;
  reasonCode: string | null;
  /** Sudah ada yang MENYETUJUI jurnal pencairannya? */
  posted: boolean;
}

export async function getSettlements(
  unit: ScopedUnitId,
  from: string,
  to: string,
): Promise<SettlementRow[]> {
  return qScoped<SettlementRow>(
    unit,
    `SELECT id::text                                AS id,
            acquirer,
            settlement_no                           AS "settlementNo",
            to_char(settlement_date,'YYYY-MM-DD')   AS "settlementDate",
            to_char(business_date,'YYYY-MM-DD')     AS "businessDate",
            to_account_id::text                     AS "toAccountId",
            gross_rp::float8                        AS "grossRp",
            net_rp::float8                          AS "netRp",
            txn_total_rp::float8                    AS "txnTotalRp",
            reason_code                             AS "reasonCode",
            (posted_at IS NOT NULL)                 AS posted,
            void
       FROM app.edc_settlement
      WHERE unit_id = $1 AND settlement_date BETWEEN $2::date AND $3::date
      ORDER BY settlement_date DESC, acquirer`,
    [unit, from, to],
  );
}

/**
 * Total transaksi EDC menurut `public.edc` pada satu tanggal bisnis, per
 * acquirer-kartu. Dipakai sebagai PEMBANDING saat rekonsiliasi — angkanya tidak
 * pernah menimpa bruto settlement; selisihnya berdiri sebagai selisih (§10.5).
 */
export async function getTotalEdcHarian(
  unit: ScopedUnitId,
  date: string,
): Promise<{ ckdkartu: string; total: number }[]> {
  return qScoped<{ ckdkartu: string; total: number }>(
    unit,
    `SELECT COALESCE(trim(ckdkartu),'(tanpa kode)') AS ckdkartu,
            COALESCE(sum(total),0)::float8         AS total
       FROM edc
      WHERE unit_id = $1 AND business_date = $2::date
      GROUP BY 1
      ORDER BY 2 DESC`,
    [unit, date],
  );
}

/** Kode alasan grup `closing` — untuk selisih transaksi vs settlement. */
export async function getReasonCodeClosing(
  unit: ScopedUnitId,
): Promise<{ code: string; label: string }[]> {
  return qScoped<{ code: string; label: string }>(
    unit,
    `SELECT code, label
       FROM app.reason_code
      WHERE applies_to = 'closing' AND active
      ORDER BY code`,
  );
}

// ---------------------------------------------------------------------------
// Blok 4 — biaya operasional & pendapatan lain-lain
// ---------------------------------------------------------------------------

/**
 * Baris biaya/pendapatan satu unit+tanggal dari KEDUA pintu (§2.4).
 *
 * `source_door` dibaca apa adanya dari kolomnya (0034) — TIDAK diturunkan dari
 * peran pembuatnya hari ini, sebab peran orang berubah dan sejarah tidak boleh
 * ikut berubah.
 */
export async function getBiayaHarian(
  unit: ScopedUnitId,
  date: string,
): Promise<BarisBiaya[]> {
  return qScoped<BarisBiaya>(
    unit,
    `SELECT id::text              AS id,
            section::text         AS section,
            keterangan,
            amount::float8        AS amount,
            operational_category  AS "operationalCategory",
            accounting_account    AS "accountingAccount",
            status::text          AS status,
            source_door           AS "sourceDoor",
            void
       FROM app.manual_entry
      WHERE unit_id = $1 AND business_date = $2::date
        AND section IN ('pendapatan_lain','pengeluaran')
      ORDER BY section, urut, created_at`,
    [unit, date],
  );
}

/**
 * Pemetaan kategori operasional → CoA (0023) yang BERLAKU pada `date`.
 *
 * Override per-unit (baris ber-`unit_id`) menang atas default (`unit_id` NULL);
 * di antara beberapa `effective_from` yang memenuhi syarat, yang TERBARU menang.
 * `DISTINCT ON` + urutan itulah yang menegakkan keduanya — bukan penyaringan di
 * TypeScript, yang akan berselisih dengan pemakai lain peta ini.
 */
export async function getPetaKategori(
  unit: ScopedUnitId,
  date: string,
): Promise<{ category: string; account: string }[]> {
  return qScoped<{ category: string; account: string }>(
    unit,
    `SELECT DISTINCT ON (operational_category)
            operational_category AS category,
            accounting_account   AS account
       FROM app.category_account_map
      WHERE (unit_id = $1 OR unit_id IS NULL) AND effective_from <= $2::date
      ORDER BY operational_category, (unit_id IS NULL), effective_from DESC`,
    [unit, date],
  );
}

// ---------------------------------------------------------------------------
// Layar 4 — gerbang tutup hari
// ---------------------------------------------------------------------------

export interface DayCloseRow {
  status: "open" | "closed";
  differenceRp: number;
  tier: "within_tolerance" | "exception_hof" | "override_direksi";
  reasonCode: string | null;
  reasonRequiresTarget: boolean | null;
  targetDate: string | null;
  closedByUserId: number | null;
  closedAt: string | null;
  approvedByUserId: number | null;
  approvedAt: string | null;
}

export async function getDayClose(
  unit: ScopedUnitId,
  date: string,
): Promise<DayCloseRow | null> {
  const r = await qScoped<DayCloseRow>(
    unit,
    `SELECT status::text                      AS status,
            difference_rp::float8             AS "differenceRp",
            tier::text                        AS tier,
            reason_code                       AS "reasonCode",
            reason_requires_target            AS "reasonRequiresTarget",
            to_char(target_date,'YYYY-MM-DD') AS "targetDate",
            closed_by_user_id                 AS "closedByUserId",
            to_char(closed_at,'YYYY-MM-DD HH24:MI') AS "closedAt",
            approved_by_user_id               AS "approvedByUserId",
            to_char(approved_at,'YYYY-MM-DD HH24:MI') AS "approvedAt"
       FROM app.day_close
      WHERE unit_id = $1 AND business_date = $2::date`,
    [unit, date],
  );
  return r[0] ?? null;
}

/** Riwayat override backdate untuk satu unit+tanggal (§2.3b). */
export interface OverrideRow {
  id: string;
  reasonCode: string;
  alasan: string;
  requestedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  consumedAt: string | null;
  void: boolean;
}

export async function getBackdateOverride(
  unit: ScopedUnitId,
  date: string,
): Promise<OverrideRow[]> {
  return qScoped<OverrideRow>(
    unit,
    `SELECT o.id::text                            AS id,
            o.reason_code                         AS "reasonCode",
            o.alasan,
            ru.email                              AS "requestedBy",
            au.email                              AS "approvedBy",
            to_char(o.approved_at,'YYYY-MM-DD HH24:MI') AS "approvedAt",
            to_char(o.consumed_at,'YYYY-MM-DD HH24:MI') AS "consumedAt",
            o.void
       FROM app.backdate_override o
       LEFT JOIN app.users ru ON ru.id = o.requested_by_user_id
       LEFT JOIN app.users au ON au.id = o.approved_by_user_id
      WHERE o.unit_id = $1 AND o.business_date = $2::date
      ORDER BY o.created_at DESC`,
    [unit, date],
  );
}

/** Kelengkapan input empat blok Layar 3 — angka, bukan kesan. */
export interface KelengkapanInput {
  hargaBeliLengkap: boolean;
  produkTanpaHarga: number;
  adaAkunKas: boolean;
  settlementBelumCair: number;
  biayaMenungguTinjauan: number;
}

export async function getKelengkapanInput(
  unit: ScopedUnitId,
  date: string,
): Promise<KelengkapanInput> {
  const [produk, harga, akun, edc, biaya] = await Promise.all([
    qScoped<{ n: number }>(unit, `SELECT count(*)::int AS n FROM product WHERE unit_id = $1`, [unit]),
    qScoped<{ n: number }>(
      unit,
      `SELECT count(DISTINCT product_key)::int AS n
         FROM app.purchase_price
        WHERE unit_id = $1 AND NOT void AND effective_from <= $2::date`,
      [unit, date],
    ),
    qScoped<{ n: number }>(unit, `SELECT count(*)::int AS n FROM app.cash_account WHERE unit_id = $1`, [unit]),
    qScoped<{ n: number }>(
      unit,
      `SELECT count(*)::int AS n FROM app.edc_settlement
        WHERE unit_id = $1 AND business_date = $2::date AND NOT void AND posted_at IS NULL`,
      [unit, date],
    ),
    qScoped<{ n: number }>(
      unit,
      `SELECT count(*)::int AS n FROM app.manual_entry
        WHERE unit_id = $1 AND business_date = $2::date AND NOT void
          AND section IN ('pengeluaran','pendapatan_lain') AND status = 'submitted'`,
      [unit, date],
    ),
  ]);
  const nProduk = produk[0]?.n ?? 0;
  const nHarga = harga[0]?.n ?? 0;
  return {
    hargaBeliLengkap: nProduk > 0 && nHarga >= nProduk,
    produkTanpaHarga: Math.max(0, nProduk - nHarga),
    adaAkunKas: (akun[0]?.n ?? 0) > 0,
    settlementBelumCair: edc[0]?.n ?? 0,
    biayaMenungguTinjauan: biaya[0]?.n ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Kelola Akun Kas (§10.18)
// ---------------------------------------------------------------------------

/**
 * Akun kas unit ini — TERMASUK yang tidak aktif, berikut jumlah mutasi dan
 * tanggal mutasi terakhirnya.
 *
 * Yang tidak aktif ikut ditarik dengan sengaja: layar ini yang mengelolanya,
 * dan jalur "aktifkan kembali" (§10.18 butir 3) mustahil tanpa melihatnya.
 * `mutasiTerakhir` yang menghidupkan penanda **dorman** — turunan, bukan kolom.
 */
export async function getAkunKasKelola(unit: ScopedUnitId): Promise<AkunKasRow[]> {
  return qScoped<AkunKasRow>(
    unit,
    `SELECT a.id::text                            AS id,
            a.nama,
            a.kind::text                          AS kind,
            a.active,
            to_char(a.closed_at,'YYYY-MM-DD')     AS "closedAt",
            COALESCE(m.n, 0)::int                 AS "nMutasi",
            to_char(m.terakhir,'YYYY-MM-DD')      AS "mutasiTerakhir"
       FROM app.cash_account a
       LEFT JOIN (
         SELECT account_id, count(*) AS n, max(business_date) AS terakhir
           FROM app.cash_ledger
          WHERE unit_id = $1 AND NOT void
          GROUP BY account_id
       ) m ON m.account_id = a.id
      WHERE a.unit_id = $1
      ORDER BY a.active DESC, (a.kind <> 'kas'), a.nama`,
    [unit],
  );
}
