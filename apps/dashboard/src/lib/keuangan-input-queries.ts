import { qScoped } from "./db";
import { KODE_BALIK, type BarisDibalik } from "./batal-balik-model";
import { NOMINAL_MANUAL_ENTRY_SQL } from "./manual-entry-nominal";
import { SQL_AKUN_EFEKTIF } from "./keuangan-reklas";
import { SQL_ME_TAK_BERLAKU } from "./keuangan-berlaku";
import { sqlTitipan } from "./titipan-bright";
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
  /** Kaki jurnal "Setujui pencairan" EDC — ditulis mesin, tiga kaki sekaligus. */
  dariPencairanEdc: boolean;
  /** Batch settlement kaki pencairan ini — `null` untuk mutasi biasa. */
  edcSettlementId?: string | null;
  /** 0049 — kaki (atau pembalik) pasangan antar unit: hanya dibalik lewat "Balik pasangan" (R31). */
  antarUnit?: boolean;
  /** 0049 — pihak lawan baris ini (wajib untuk "Penyerahan titipan"/"Hutang Piutang"). */
  pihakLawanId?: string | null;
  /** 0049 — tanggal asal bila dibukukan maju (R28); `null` = sama dengan hari buku. KTD15. */
  tanggalAsal?: string | null;
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
            saldo_awal                            AS "saldoAwal",
            saldo_awal_sementara                  AS "saldoAwalSementara",
            void,
            source_manual_entry_id::text          AS "sourceManualEntryId",
            (edc_settlement_id IS NOT NULL)       AS "dariPencairanEdc",
            edc_settlement_id::text               AS "edcSettlementId",
            (pasangan_uuid IS NOT NULL)           AS "antarUnit",
            pihak_lawan_id::text                  AS "pihakLawanId",
            to_char(tanggal_asal,'YYYY-MM-DD')    AS "tanggalAsal"
       FROM app.cash_ledger
      -- Saldo pembuka SELALU ikut, apa pun tanggalnya (§10.26): cut-over bisa
      -- bertanggal sesudah hari yang dilaporkan, dan tanpa baris itu hari-hari
      -- sebelum cut-over tak tahu bahwa bukunya belum dimulai.
      WHERE unit_id = $1 AND (business_date <= $2::date OR (saldo_awal AND NOT void))
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
  /** Jurnal pencairannya pernah dibatalkan (ada kaki kas yang void) — rencana 2026-11-02. */
  pernahDibatalkan: boolean;
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
            void,
            EXISTS (
              SELECT 1 FROM app.cash_ledger l
               WHERE l.edc_settlement_id = app.edc_settlement.id
                 AND l.unit_id = app.edc_settlement.unit_id AND l.void
            )                                       AS "pernahDibatalkan"
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

/** Kode alasan grup `reclass` (§10.2) — untuk reklasifikasi biaya pengawas. */
export async function getReasonCodeReclass(
  unit: ScopedUnitId,
): Promise<{ code: string; label: string }[]> {
  return qScoped<{ code: string; label: string }>(
    unit,
    `SELECT code, label
       FROM app.reason_code
      WHERE applies_to = 'reclass' AND active
      ORDER BY code`,
  );
}

/** Kode alasan grup `void` (0059) — untuk Batalkan baris pintu Finance. */
export async function getReasonCodeVoid(
  unit: ScopedUnitId,
): Promise<{ code: string; label: string }[]> {
  return qScoped<{ code: string; label: string }>(
    unit,
    `SELECT code, label
       FROM app.reason_code
      WHERE applies_to = 'void' AND active
      ORDER BY code`,
  );
}

/**
 * R12b — baris yang dibalik sesudah hari ditutup (reversal disetujui, 0060).
 * `day_close` hari itu tak dihitung ulang; daftar ini yang menjelaskan beda
 * antara selisih saat ditutup dan angka sekarang.
 */
export async function getDibalikSesudahTutup(unit: ScopedUnitId, date: string): Promise<BarisDibalik[]> {
  return qScoped<BarisDibalik>(
    unit,
    `SELECT m.keterangan, m.section::text AS section, ${SQL_AKUN_EFEKTIF("m")} AS akun,
            ${NOMINAL_MANUAL_ENTRY_SQL}::float8 AS amount, ce.reason_code AS kode,
            COALESCE(q.alasan, '') AS alasan, us.email AS pengaju, ua.email AS penyetuju,
            to_char(ce.approved_at AT TIME ZONE 'Asia/Pontianak', 'YYYY-MM-DD HH24:MI') AS waktu
       FROM app.correction_entry ce
       JOIN app.manual_entry m ON m.id = ce.original_txn_id AND m.unit_id = ce.unit_id
       LEFT JOIN app.correction_request q ON q.correction_entry_id = ce.id
       LEFT JOIN app.users us ON us.id = ce.submitted_by_user_id
       LEFT JOIN app.users ua ON ua.id = ce.approved_by_user_id
      WHERE ce.unit_id = $1 AND ce.source_kind = 'manual_entry' AND ce.kind = 'reversal'
        AND m.business_date = $2::date
      ORDER BY ce.approved_at`,
    [unit, date],
  );
}

/** Kode alasan Balik (rencana 2026-11-07 R8) — grup `adjustment`, daftar `KODE_BALIK`. */
export async function getReasonCodeBalik(
  unit: ScopedUnitId,
): Promise<{ code: string; label: string }[]> {
  return qScoped<{ code: string; label: string }>(
    unit,
    `SELECT code, label
       FROM app.reason_code
      WHERE applies_to = 'adjustment' AND active AND code = ANY($1::text[])
      ORDER BY code`,
    [[...KODE_BALIK]],
  );
}

/** Satu reklasifikasi yang pernah dibuat atas baris `manual_entry` (0021). */
export interface ReklasBaris {
  sourceTxnId: string;
  fromAccount: string;
  toAccount: string;
  reasonCode: string;
  note: string | null;
  oleh: string | null;
  /** WIB, `YYYY-MM-DD HH24:MI`. */
  waktu: string;
}

/** Riwayat reklasifikasi baris biaya/pendapatan lain satu unit+tanggal — terbaru dulu. */
export async function getReklasHarian(unit: ScopedUnitId, date: string): Promise<ReklasBaris[]> {
  return qScoped<ReklasBaris>(
    unit,
    `SELECT r.source_txn_id::text AS "sourceTxnId",
            r.from_account        AS "fromAccount",
            r.to_account          AS "toAccount",
            r.reason_code         AS "reasonCode",
            r.note,
            u.email               AS oleh,
            to_char(r.created_at AT TIME ZONE 'Asia/Pontianak', 'YYYY-MM-DD HH24:MI') AS waktu
       FROM app.reclassification r
       JOIN app.manual_entry m ON m.id = r.source_txn_id AND m.unit_id = r.unit_id
       LEFT JOIN app.users u ON u.id = r.created_by_user_id
      WHERE r.unit_id = $1 AND r.source_kind = 'manual_entry' AND m.business_date = $2::date
      ORDER BY r.created_at DESC, r.id DESC`,
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
    `SELECT m.id::text            AS id,
            m.section::text       AS section,
            m.keterangan,
            ${NOMINAL_MANUAL_ENTRY_SQL}::float8 AS amount,
            m.operational_category AS "operationalCategory",
            -- §10.29 — akun EFEKTIF (reklasifikasi terakhir) & akun beku aslinya.
            ${SQL_AKUN_EFEKTIF("m")} AS "accountingAccount",
            m.accounting_account  AS "akunAsli",
            m.status::text        AS status,
            m.source_door         AS "sourceDoor",
            -- Rencana 2026-11-07 KTD1 — 'void' = TIDAK BERLAKU (satu aturan).
            ${SQL_ME_TAK_BERLAKU("m")} AS void,
            ${sqlTitipan("m")} AS "titipanBright",
            -- Rencana 2026-11-07 U4 — fakta penentu tindakan & jejak Batalkan.
            (m.cash_ledger_id IS NOT NULL) AS "bertautKas",
            EXISTS (SELECT 1 FROM app.day_close dc
                     WHERE dc.unit_id = m.unit_id AND dc.business_date = m.business_date
                       AND dc.status = 'closed') AS "hariTutup",
            to_char(m.voided_at AT TIME ZONE 'Asia/Pontianak', 'YYYY-MM-DD HH24:MI') AS "voidAt",
            uv.email              AS "voidOleh",
            m.void_reason_code    AS "voidReasonCode",
            m.void_alasan         AS "voidAlasan",
            -- Rilis 2 (0060) — dibalik & pengajuan Balik TERAKHIR.
            EXISTS (SELECT 1 FROM app.correction_entry ce
                     WHERE ce.source_kind = 'manual_entry' AND ce.kind = 'reversal'
                       AND ce.original_txn_id = m.id AND ce.unit_id = m.unit_id) AS dibalik,
            CASE WHEN q.id IS NULL THEN NULL ELSE json_build_object(
              'id', q.id::text, 'status', q.status, 'olehId', q.requested_by_user_id, 'oleh', uq.email,
              'waktu', to_char(q.requested_at AT TIME ZONE 'Asia/Pontianak', 'YYYY-MM-DD HH24:MI'),
              'kode', q.reason_code, 'alasan', q.alasan, 'putusOleh', ud.email,
              'putusWaktu', to_char(q.decided_at AT TIME ZONE 'Asia/Pontianak', 'YYYY-MM-DD HH24:MI'),
              'catatan', q.catatan_keputusan) END AS balik
       FROM app.manual_entry m
       LEFT JOIN app.users uv ON uv.id = m.voided_by_user_id
       LEFT JOIN LATERAL (
              SELECT * FROM app.correction_request r
               WHERE r.source_kind = 'manual_entry' AND r.original_txn_id = m.id AND r.unit_id = m.unit_id
               ORDER BY r.requested_at DESC, r.id DESC
               LIMIT 1) q ON true
       LEFT JOIN app.users uq ON uq.id = q.requested_by_user_id
       LEFT JOIN app.users ud ON ud.id = q.decided_by_user_id
      WHERE m.unit_id = $1 AND m.business_date = $2::date
        AND m.section IN ('pendapatan_lain','pengeluaran')
      ORDER BY m.section, m.urut, m.created_at`,
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
  /** Diresolusi dari `app.users` — kertas menyebut orang, bukan id. */
  closedByEmail: string | null;
  approvedByEmail: string | null;
  /**
   * KTD15 (0054) — koreksi susulan yang disimpan di samping selisih. `null` =
   * hari ditutup sebelum 0054 (tak tercatat) atau belum terhitung. Opsional di
   * tipe supaya fixture kertas lama tetap sah; kueri selalu mengisinya.
   */
  koreksiSusulanRp?: number | null;
}

export async function getDayClose(
  unit: ScopedUnitId,
  date: string,
): Promise<DayCloseRow | null> {
  const r = await qScoped<DayCloseRow>(
    unit,
    `SELECT dc.status::text                   AS status,
            dc.difference_rp::float8          AS "differenceRp",
            dc.koreksi_susulan_rp::float8     AS "koreksiSusulanRp",
            dc.tier::text                     AS tier,
            dc.reason_code                    AS "reasonCode",
            dc.reason_requires_target         AS "reasonRequiresTarget",
            to_char(dc.target_date,'YYYY-MM-DD') AS "targetDate",
            dc.closed_by_user_id              AS "closedByUserId",
            to_char(dc.closed_at,'YYYY-MM-DD HH24:MI') AS "closedAt",
            dc.approved_by_user_id            AS "approvedByUserId",
            to_char(dc.approved_at,'YYYY-MM-DD HH24:MI') AS "approvedAt",
            -- Kertas menyebut ORANG, bukan id. Pola LEFT JOIN yang sama dengan
            -- getBackdateOverride; LEFT supaya hari yang belum ditutup tetap
            -- mengembalikan barisnya, bukan lenyap.
            cu.email                          AS "closedByEmail",
            au.email                          AS "approvedByEmail"
       FROM app.day_close dc
       LEFT JOIN app.users cu ON cu.id = dc.closed_by_user_id
       LEFT JOIN app.users au ON au.id = dc.approved_by_user_id
      WHERE dc.unit_id = $1 AND dc.business_date = $2::date`,
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
      `SELECT count(*)::int AS n FROM app.manual_entry m
        WHERE m.unit_id = $1 AND m.business_date = $2::date AND NOT ${SQL_ME_TAK_BERLAKU("m")}
          AND m.section IN ('pengeluaran','pendapatan_lain') AND m.status = 'submitted'`,
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
