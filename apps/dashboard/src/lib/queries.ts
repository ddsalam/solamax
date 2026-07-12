import { qScoped } from "./db";
import { GARBAGE_SELISIH_L, GARBAGE_STOCK_L } from "./derive";
import type { ScopedUnitId } from "./scope";

/**
 * FASE 3b (RLS backstop, migration 0016): query data per-unit dijalankan lewat
 * `qScoped(unit, …)` — set GUC `app.unit_ids` transaction-local → Row-Level
 * Security memfilter di lapisan DB, DI BAWAH filter aplikasi `WHERE unit_id`.
 * Filter aplikasi TETAP dipertahankan (defense-in-depth). Query yang masih memakai
 * `q()` polos akan GAGAL-AMAN (0 baris) begitu RLS aktif — daftar konversi penuh
 * ada di session-notes/rls-rehearsal/ (cutover follow-through).
 */

/**
 * Semua query dashboard — SELECT murni (read-only, nol mutasi). Konvensi:
 * tanggal BISNIS = kolom date sumber (DTGLJUAL / DTAGLOPN / DTGL) — shift 3
 * lewat tengah malam tetap di hari bisnisnya. "Hari ini" dihitung WIB.
 *
 * FASE 3: setiap query per-unit menerima `ScopedUnitId` (number ber-brand dari
 * DataScope) — bukan `number` mentah. Jadi tak mungkin memanggil query untuk unit
 * yang belum lolos otorisasi (error type-check). Resolusi unit (getUnits/byCode)
 * pindah ke lib/scope.ts; halaman TIDAK lagi mengakses unit tanpa scope.
 */

const TZ = "Asia/Pontianak";

/**
 * Lookback (hari) sebelum `from` untuk membatasi base-CTE G/L (lihat
 * getDailyGlByProduct). G/L harian butuh DUA hal dari MASA SEBELUM `from`:
 *   (1) lag-anchor: Stock Fisik(D−1) untuk hari pertama rentang (window `lag`
 *       per produk butuh opname penutup terdekat SEBELUM `from`), dan
 *   (2) gap-window: penerimaan/jual/tera dijumlah pada (prev_date, D] — bila ada
 *       celah opname, prev_date bisa mundur beberapa hari.
 * Membatasi base-CTE ke [from − GL_LOOKBACK_DAYS, to] (bukan SELURUH sejarah)
 * menghasilkan output IDENTIK selama lookback ≥ celah opname terpanjang yang
 * relevan. Opname masuk ~harian (≈21 baris/hari lintas tangki), dan DO/celah
 * stok dibatasi DO_STALE_DAYS=30; 365 hari ≫ keduanya → margin keselamatan
 * besar terhadap celah data panjang apa pun. Terbukti byte-identik vs versi
 * tak-terbatas (Jun/Mei 2026, Feb 2024, Sep 2022 = tepi anchor bulan pertama).
 */
const GL_LOOKBACK_DAYS = 365;

// ---------------------------------------------------------------------------
// Sinkronisasi
// ---------------------------------------------------------------------------

export interface SyncRow {
  unit_id: number;
  last_run: string | null; // ISO UTC
}

/** Sinkron terakhir per unit, DIBATASI ke unit dalam scope caller. */
export async function getSyncByUnit(unitIds: ScopedUnitId[]): Promise<SyncRow[]> {
  if (unitIds.length === 0) return [];
  return qScoped<SyncRow>(
    unitIds,
    `SELECT unit_id,
            to_char(max(last_run_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_run
     FROM sync_state WHERE unit_id = ANY($1::int[]) GROUP BY unit_id`,
    [unitIds],
  );
}

// ---------------------------------------------------------------------------
// Penjualan
// ---------------------------------------------------------------------------

export interface ProductAgg {
  ckdbbm: string;
  nama: string;
  vol: number;
  omzet: number;
  /** harga jual terakhir teramati pada rentang (utk tabel harga) */
  harga: number | null;
}

/** Agregat per produk pada rentang tanggal bisnis [from..to]. */
export async function getSalesByProduct(
  unit: ScopedUnitId,
  from: string,
  to: string,
): Promise<ProductAgg[]> {
  return qScoped<ProductAgg>(
    unit,
    `SELECT trim(sd.ckdbbm) AS ckdbbm,
            COALESCE(max(p.vcnmbbm), trim(sd.ckdbbm)) AS nama,
            COALESCE(sum(sd.nvolume),0)::float8 AS vol,
            COALESCE(sum(sd.nsubtotal),0)::float8 AS omzet,
            (array_agg(sd.nhargajual ORDER BY sd.dtgljam DESC))[1]::float8 AS harga
     FROM sales_detail sd
     JOIN sales_header h ON h.unit_id = sd.unit_id AND h.ckdjualbbm = sd.ckdjualbbm
     LEFT JOIN product p ON p.unit_id = sd.unit_id AND p.ckdbbm = sd.ckdbbm
     WHERE sd.unit_id = $1 AND h.dtgljual BETWEEN $2::date AND $3::date
     GROUP BY trim(sd.ckdbbm)
     ORDER BY omzet DESC`,
    [unit, from, to],
  );
}

export interface DailyOmzet {
  d: string;
  vol: number;
  omzet: number;
}

export async function getDailyOmzet(
  unit: ScopedUnitId,
  from: string,
  to: string,
): Promise<DailyOmzet[]> {
  return qScoped<DailyOmzet>(
    unit,
    `SELECT to_char(h.dtgljual,'YYYY-MM-DD') AS d,
            COALESCE(sum(sd.nvolume),0)::float8 AS vol,
            COALESCE(sum(sd.nsubtotal),0)::float8 AS omzet
     FROM sales_header h
     JOIN sales_detail sd ON sd.unit_id = h.unit_id AND sd.ckdjualbbm = h.ckdjualbbm
     WHERE h.unit_id = $1 AND h.dtgljual BETWEEN $2::date AND $3::date
     GROUP BY h.dtgljual ORDER BY h.dtgljual`,
    [unit, from, to],
  );
}

export interface SalesTotals {
  vol: number;
  omzet: number;
}

export async function getSalesTotals(
  unit: ScopedUnitId,
  from: string,
  to: string,
): Promise<SalesTotals> {
  const rows = await qScoped<SalesTotals>(
    unit,
    `SELECT COALESCE(sum(sd.nvolume),0)::float8 AS vol,
            COALESCE(sum(sd.nsubtotal),0)::float8 AS omzet
     FROM sales_detail sd
     JOIN sales_header h ON h.unit_id = sd.unit_id AND h.ckdjualbbm = sd.ckdjualbbm
     WHERE sd.unit_id = $1 AND h.dtgljual BETWEEN $2::date AND $3::date`,
    [unit, from, to],
  );
  return rows[0] ?? { vol: 0, omzet: 0 };
}

export interface ShiftInfo {
  shifts: number;
  /** waktu rekam terakhir hari itu (jam tutup shift terakhir), ISO UTC */
  last_dtgljam: string | null;
}

export async function getShiftInfo(unit: ScopedUnitId, date: string): Promise<ShiftInfo> {
  const rows = await qScoped<ShiftInfo>(
    unit,
    `SELECT count(DISTINCT h.nshift)::int AS shifts,
            to_char(max(sd.dtgljam) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_dtgljam
     FROM sales_header h
     LEFT JOIN sales_detail sd ON sd.unit_id = h.unit_id AND sd.ckdjualbbm = h.ckdjualbbm
     WHERE h.unit_id = $1 AND h.dtgljual = $2::date`,
    [unit, date],
  );
  return rows[0] ?? { shifts: 0, last_dtgljam: null };
}

/** Jumlah baris penjualan terkoreksi (SUBAH/SEDIT) pada satu tanggal bisnis. */
export async function getCorrections(unit: ScopedUnitId, date: string): Promise<number> {
  const rows = await qScoped<{ n: number }>(
    unit,
    `SELECT count(*)::int AS n
     FROM sales_detail sd
     JOIN sales_header h ON h.unit_id = sd.unit_id AND h.ckdjualbbm = sd.ckdjualbbm
     WHERE sd.unit_id = $1 AND h.dtgljual = $2::date
       AND (COALESCE(sd.subah,0) <> 0 OR COALESCE(sd.sedit,0) <> 0)`,
    [unit, date],
  );
  return rows[0]?.n ?? 0;
}

/** Nozzle yang punya koreksi hari ini (untuk titik ⟳ di denah). */
export async function getCorrectedNozzles(unit: ScopedUnitId, date: string): Promise<string[]> {
  const rows = await qScoped<{ ckdnozzle: string }>(
    unit,
    `SELECT DISTINCT trim(sd.ckdnozzle) AS ckdnozzle
     FROM sales_detail sd
     JOIN sales_header h ON h.unit_id = sd.unit_id AND h.ckdjualbbm = sd.ckdjualbbm
     WHERE sd.unit_id = $1 AND h.dtgljual = $2::date
       AND (COALESCE(sd.subah,0) <> 0 OR COALESCE(sd.sedit,0) <> 0)`,
    [unit, date],
  );
  return rows.map((r) => r.ckdnozzle);
}

// ---------------------------------------------------------------------------
// Opname penutup (gain/loss SIGNED) — fix G/L
// ---------------------------------------------------------------------------

export interface ClosingOpnameRow {
  d: string; // tanggal bisnis (dtaglopn, atau fallback tanggal rekam WIB)
  ckdtangki: string;
  ckdbbm: string | null;
  nama: string | null;
  bk: number | null; // stok buku (NSTOCKBK)
  op: number | null; // stok fisik (NSTOCKOP)
  signed: number; // op − bk (− = losses); NVOLSELISIH sumber ABSOLUT → dihitung ulang
  dtgljam: string | null; // ISO UTC waktu rekam baris terpilih
  provisional: boolean; // penutup D+1 belum terekam (hari berjalan) — tambahan C
}

/**
 * Opname PENUTUP per (tanggal bisnis × tangki): baris terakhir per partisi
 * (sesi pagi D+1 yang oleh EasyMax ditandai dtaglopn=D). Sesi siang/malam intra-
 * hari diabaikan (distorsi timing penerimaan). G/L = NSTOCKOP − NSTOCKBK (signed),
 * BUKAN SUM(NVOLSELISIH) yang absolut. Garbage guard diterapkan di derive.ts.
 */
export async function getClosingOpname(
  unit: ScopedUnitId,
  from: string,
  to: string,
): Promise<ClosingOpnameRow[]> {
  return qScoped<ClosingOpnameRow>(
    unit,
    `WITH biz AS (
       SELECT o.*, COALESCE(o.dtaglopn, (o.dtgljam AT TIME ZONE '${TZ}')::date) AS bizdate,
              row_number() OVER (
                PARTITION BY COALESCE(o.dtaglopn, (o.dtgljam AT TIME ZONE '${TZ}')::date), o.ckdtangki
                ORDER BY o.dtgljam DESC
              ) AS rn
       FROM opname o
       WHERE o.unit_id = $1 AND COALESCE(o.sbatal,0) = 0
     )
     SELECT to_char(b.bizdate,'YYYY-MM-DD') AS d,
            trim(b.ckdtangki) AS ckdtangki, trim(b.ckdbbm) AS ckdbbm,
            (SELECT max(p.vcnmbbm) FROM product p WHERE p.unit_id=$1 AND p.ckdbbm=b.ckdbbm) AS nama,
            b.nstockbk::float8 AS bk, b.nstockop::float8 AS op,
            (b.nstockop - b.nstockbk)::float8 AS signed,
            to_char(b.dtgljam AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS dtgljam,
            ((b.dtgljam AT TIME ZONE '${TZ}')::date <= b.bizdate) AS provisional
     FROM biz b
     WHERE b.rn = 1 AND b.bizdate BETWEEN $2::date AND $3::date
     ORDER BY b.bizdate, trim(b.ckdtangki)`,
    [unit, from, to],
  );
}

// ---------------------------------------------------------------------------
// Gain/Losses harian per produk — metode RESUME OPERASIONAL (otoritatif)
// ---------------------------------------------------------------------------

export interface DailyGlRow {
  d: string; // tanggal bisnis
  ckdbbm: string;
  nama: string | null;
  fisik: number | null; // Σ NSTOCKOP penutup non-garbage (Stock Fisik)
  fisik_prev: number | null; // Stock Fisik hari-bisnis sebelumnya (Stock Awal)
  pen_do: number; // Σ NVOLDO (Penerimaan) dlm jendela (prev, D]
  sales_gross: number; // Σ nvolume jual KOTOR dlm jendela (prev, D]
  tera: number; // Σ tera (L) dlm jendela (prev, D]
  gl: number | null; // Gain/Losses bertanda (+ gain, − loss); null = tak terhitung
  excluded_tanks: number; // tangki garbage yg dikecualikan dari fisik hari itu
  provisional: boolean; // penutup D+1 belum ada / anchor D−1 hilang / ada celah
}

/**
 * Gain/Losses harian per produk, **metode RESUME OPERASIONAL** (dikunci 2026-06-26,
 * cocok ±0,06 L di 48 sel 18–25 Jun). BUKAN `NSTOCKOP − NSTOCKBK` (buku EasyMax
 * dirantai ke volume real → kekurangan kiriman DO tak muncul):
 *
 *   Stock Teori(D) = Stock Fisik(D−1) + ΣNVOLDO(D) − Penjualan_BERSIH(D)
 *   Gain/Losses(D) = Stock Fisik(D) − Stock Teori(D)
 *   Penjualan_BERSIH = jual KOTOR − Tera   (tera=0 → = kotor)
 *
 * - Stock Fisik = Σ NSTOCKOP opname PENUTUP per produk (gabung tangki), guard
 *   garbage pada baris stok. Stock Fisik(D−1) = penutup hari-bisnis sebelumnya
 *   (lag; lookback melewati `from` agar hari pertama rentang punya anchor benar).
 * - Penerimaan = ΣNVOLDO (`sbatal=0`), BUKAN NVOLREAL (sampah). Tera dari ledger
 *   RESMI `terra_resmi` (Σ nvolume, sbatal=0) — BUKAN `tera` mentah (semua-pour).
 *   SUMBER TUNGGAL terra (selaras EasyMax RESUME: net-sales = gross − tera RESMI;
 *   bukti 24/6 Pertalite tera 0 & Penjualan=gross−0; 25/6 tera 101). Penjualan jual
 *   KOTOR dari sales_detail.
 * - Jendela (prev_date, D] menjumlah penerimaan/jual/tera lintas-celah bila suatu
 *   hari tak ada opname (fallback penutup terdekat) → ditandai `provisional`.
 * - Kembalikan baris harian utk SELURUH rentang; pemanggil agregasi harian (kolom
 *   tabel) atau Σ bulanan (G/L kumulatif). Murni SELECT, ter-scope `ScopedUnitId`.
 */
export async function getDailyGlByProduct(
  unit: ScopedUnitId,
  from: string,
  to: string,
): Promise<DailyGlRow[]> {
  return qScoped<DailyGlRow>(
    unit,
    `WITH bounds AS (
       -- Batas bawah pemindaian base-CTE: from − GL_LOOKBACK_DAYS (lihat catatan
       -- konstanta). dto memakai 'to' apa adanya. Semua base-CTE memfilter ke
       -- [dlo, dto] agar tak memindai SELURUH sejarah unit untuk 1 bulan output.
       SELECT $2::date AS dfrom, $3::date AS dto, ($2::date - ${GL_LOOKBACK_DAYS}) AS dlo
     ),
     biz AS (
       SELECT o.ckdtangki, o.ckdbbm, o.nstockop, o.nstockbk,
              COALESCE(o.dtaglopn, (o.dtgljam AT TIME ZONE '${TZ}')::date) AS bizdate,
              row_number() OVER (
                PARTITION BY COALESCE(o.dtaglopn, (o.dtgljam AT TIME ZONE '${TZ}')::date), o.ckdtangki
                ORDER BY o.dtgljam DESC
              ) AS rn,
              ((o.dtgljam AT TIME ZONE '${TZ}')::date
                 <= COALESCE(o.dtaglopn, (o.dtgljam AT TIME ZONE '${TZ}')::date)) AS prov_row
       FROM opname o, bounds b
       WHERE o.unit_id = $1 AND COALESCE(o.sbatal,0) = 0
         AND COALESCE(o.dtaglopn, (o.dtgljam AT TIME ZONE '${TZ}')::date)
             BETWEEN b.dlo AND b.dto
     ),
     clo AS (
       SELECT bizdate, trim(ckdbbm) AS ckdbbm, nstockop::float8 AS op, prov_row,
              (nstockop < 0 OR nstockop > ${GARBAGE_STOCK_L}
                OR nstockbk < 0 OR nstockbk > ${GARBAGE_STOCK_L}
                OR abs(nstockop - nstockbk) > ${GARBAGE_SELISIH_L}) AS garbage
       FROM biz WHERE rn = 1
     ),
     fisik AS (
       SELECT bizdate, ckdbbm,
              sum(op) FILTER (WHERE NOT garbage) AS fisik,
              count(*) FILTER (WHERE garbage)::int AS excluded_tanks,
              bool_or(prov_row) AS prov
       FROM clo GROUP BY bizdate, ckdbbm
     ),
     seq AS (
       SELECT f.*,
              lag(fisik)   OVER (PARTITION BY ckdbbm ORDER BY bizdate) AS fisik_prev,
              lag(bizdate) OVER (PARTITION BY ckdbbm ORDER BY bizdate) AS prev_date
       FROM fisik f
     ),
     deliv AS (
       SELECT COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE '${TZ}')::date) AS d,
              trim(t.ckdbbm) AS ckdbbm, sum(t.nvoldo)::float8 AS v
       FROM delivery t, bounds b
       WHERE t.unit_id = $1 AND COALESCE(t.sbatal,0) = 0
         AND abs(COALESCE(t.nvoldo,0)) <= ${GARBAGE_STOCK_L}
         AND COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE '${TZ}')::date)
             BETWEEN b.dlo AND b.dto
       GROUP BY 1, 2
     ),
     sale AS (
       SELECT h.dtgljual AS d, trim(sd.ckdbbm) AS ckdbbm, sum(sd.nvolume)::float8 AS v
       FROM sales_detail sd
       JOIN sales_header h ON h.unit_id = sd.unit_id AND h.ckdjualbbm = sd.ckdjualbbm
       , bounds b
       WHERE sd.unit_id = $1 AND h.dtgljual BETWEEN b.dlo AND b.dto
       GROUP BY 1, 2
     ),
     terad AS (
       -- SUMBER TUNGGAL terra = ledger RESMI (terra_resmi), BUKAN tera mentah.
       -- business_date=DTGLTERRA, hanya sbatal=0; Σ nvolume per (hari, produk).
       SELECT tr.business_date AS d, trim(tr.ckdbbm) AS ckdbbm, sum(tr.nvolume)::float8 AS v
       FROM terra_resmi tr, bounds b
       WHERE tr.unit_id = $1 AND COALESCE(tr.sbatal,0) = 0
         AND tr.business_date BETWEEN b.dlo AND b.dto
       GROUP BY 1, 2
     )
     SELECT to_char(s.bizdate,'YYYY-MM-DD') AS d, s.ckdbbm,
            (SELECT max(p.vcnmbbm) FROM product p WHERE p.unit_id=$1 AND trim(p.ckdbbm)=s.ckdbbm) AS nama,
            s.fisik::float8 AS fisik,
            s.fisik_prev::float8 AS fisik_prev,
            COALESCE((SELECT sum(v) FROM deliv x WHERE x.ckdbbm=s.ckdbbm
                       AND x.d > COALESCE(s.prev_date, s.bizdate - 1) AND x.d <= s.bizdate),0)::float8 AS pen_do,
            COALESCE((SELECT sum(v) FROM sale x WHERE x.ckdbbm=s.ckdbbm
                       AND x.d > COALESCE(s.prev_date, s.bizdate - 1) AND x.d <= s.bizdate),0)::float8 AS sales_gross,
            COALESCE((SELECT sum(v) FROM terad x WHERE x.ckdbbm=s.ckdbbm
                       AND x.d > COALESCE(s.prev_date, s.bizdate - 1) AND x.d <= s.bizdate),0)::float8 AS tera,
            CASE WHEN s.fisik IS NULL OR s.fisik_prev IS NULL THEN NULL
                 ELSE (s.fisik - (s.fisik_prev
                       + COALESCE((SELECT sum(v) FROM deliv x WHERE x.ckdbbm=s.ckdbbm
                                    AND x.d > COALESCE(s.prev_date, s.bizdate - 1) AND x.d <= s.bizdate),0)
                       - (COALESCE((SELECT sum(v) FROM sale x WHERE x.ckdbbm=s.ckdbbm
                                    AND x.d > COALESCE(s.prev_date, s.bizdate - 1) AND x.d <= s.bizdate),0)
                          - COALESCE((SELECT sum(v) FROM terad x WHERE x.ckdbbm=s.ckdbbm
                                    AND x.d > COALESCE(s.prev_date, s.bizdate - 1) AND x.d <= s.bizdate),0))
                       ))::float8 END AS gl,
            s.excluded_tanks,
            (s.prov OR s.fisik_prev IS NULL OR s.prev_date <> s.bizdate - 1) AS provisional
     FROM seq s
     WHERE s.bizdate BETWEEN $2::date AND $3::date
     ORDER BY s.bizdate, s.ckdbbm`,
    [unit, from, to],
  );
}

// ---------------------------------------------------------------------------
// Penerimaan (delivery)
// ---------------------------------------------------------------------------

export interface DeliveryShortfall {
  d: string;
  cnodo: string;
  ckdbbm: string | null;
  nama: string | null;
  selisih: number; // NVOLSELISIH (kekurangan kiriman; absolut apa adanya)
  voldo: number | null;
  volreal: number | null;
  sbatal: number;
}

/** Kekurangan kiriman (NVOLSELISIH delivery) pada rentang — untuk anomali. */
export async function getDeliveryShortfalls(
  unit: ScopedUnitId,
  from: string,
  to: string,
  limit = 20,
): Promise<DeliveryShortfall[]> {
  return qScoped<DeliveryShortfall>(
    unit,
    `SELECT to_char(COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE '${TZ}')::date),'YYYY-MM-DD') AS d,
            trim(COALESCE(t.cnodo,'-')) AS cnodo, trim(t.ckdbbm) AS ckdbbm,
            (SELECT max(p.vcnmbbm) FROM product p WHERE p.unit_id=t.unit_id AND p.ckdbbm=t.ckdbbm) AS nama,
            t.nvolselisih::float8 AS selisih, t.nvoldo::float8 AS voldo, t.nvolreal::float8 AS volreal,
            COALESCE(t.sbatal,0)::int AS sbatal
     FROM delivery t
     WHERE t.unit_id = $1 AND COALESCE(t.nvolselisih,0) <> 0
       AND COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE '${TZ}')::date) BETWEEN $2::date AND $3::date
     ORDER BY abs(t.nvolselisih) DESC LIMIT $4`,
    [unit, from, to, limit],
  );
}

// ---------------------------------------------------------------------------
// Penerimaan (delivery)
// ---------------------------------------------------------------------------

export interface DeliveryAgg {
  ckdbbm: string;
  nama: string;
  vol: number;
}

export async function getDeliveryByProduct(
  unit: ScopedUnitId,
  from: string,
  to: string,
): Promise<DeliveryAgg[]> {
  // Penerimaan = Volume DO (NVOLDO), bukan NVOLREAL. NVOLDO = volume sesuai DO
  // (kelipatan 8.000 L/kompartemen) — cocok kolom "Penerimaan" laporan DO Harian.
  // NVOLREAL (volume terukur) penuh baris sampah di sumber (mis. −14jt/+247jt) →
  // bukan basis Penerimaan. Guard tetap pada kolom yang dipakai (nvoldo).
  return qScoped<DeliveryAgg>(
    unit,
    `SELECT trim(t.ckdbbm) AS ckdbbm,
            COALESCE(max(p.vcnmbbm), trim(t.ckdbbm)) AS nama,
            COALESCE(sum(t.nvoldo),0)::float8 AS vol
     FROM delivery t
     LEFT JOIN product p ON p.unit_id = t.unit_id AND p.ckdbbm = t.ckdbbm
     WHERE t.unit_id = $1 AND COALESCE(t.sbatal,0) = 0
       AND abs(COALESCE(t.nvoldo,0)) <= ${GARBAGE_STOCK_L}
       AND COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE '${TZ}')::date) BETWEEN $2::date AND $3::date
     GROUP BY trim(t.ckdbbm)`,
    [unit, from, to],
  );
}

// ---------------------------------------------------------------------------
// Laporan DO Harian — per-SO open-balance (setara logika F12 EasyMax)
// ---------------------------------------------------------------------------

export interface DoHarianRow {
  ckdbbm: string;
  nama: string;
  /** Sisa DO kemarin (per-SO, as-of D−1). */
  do_awal: number;
  /** Penerimaan hari-D = Σ NVOLDO (alur). */
  penerimaan: number;
  /** Penebusan DO hari-D = Σ NVOLUME (alur). */
  penebusan: number;
  /** Sisa DO = Σ_SO GREATEST(0, ditebus≤D − diterima≤D) — OTORITATIF. */
  sisa: number;
  /**
   * Bagian `sisa` dari SO MACET (tebus terakhir > DO_STALE_DAYS hari sebelum D;
   * definisi identik panel suspect → tertelusur). Segmentasi tampilan (keputusan
   * owner 2026-07-12): headline tetap ledger penuh, bagian macet ditandai.
   */
  sisa_macet: number;
}

/**
 * Laporan DO Harian per produk untuk tanggal `date`, model **per-SO** (setara
 * popup F12 "cari No.SO" EasyMax). Outstanding dihitung per Sales Order:
 *   Sisa DO(produk,D) = Σ atas (CNOSO,produk) GREATEST(0, ΣNVOLUME(tebus,≤D) − ΣNVOLDO(terima,≤D))
 *   DO Awal(D) = Sisa(D−1).
 * Clamp ≥0 per-SO menyelesaikan orphan (tebus=0), over-receipt, & mismatch
 * atribusi-tanggal secara struktural → TANPA δ-seed. Join `trim(cnoso)` (char(20)
 * di-pad) + `trim(ckdbbm)`. Kolom Penebusan/Penerimaan = alur harian apa adanya;
 * pada hari anomali bisa tak rekonsiliasi dgn Sisa (selisih = sinyal anomali,
 * lihat getDoAnomalies). Murni SELECT, ter-scope `ScopedUnitId`.
 */
export async function getDoHarian(
  unit: ScopedUnitId,
  date: string,
): Promise<DoHarianRow[]> {
  return qScoped<DoHarianRow>(
    unit,
    `WITH red AS (
       SELECT trim(th.cnoso) AS cnoso, trim(td.ckdbbm) AS bbm,
              sum(td.nvolume) FILTER (WHERE th.dtgltbs <= $2::date) AS v_d,
              sum(td.nvolume) FILTER (WHERE th.dtgltbs <  $2::date) AS v_p,
              max(th.dtgltbs) AS lastd
       FROM tebus_header th
       JOIN tebus_detail td ON td.unit_id = th.unit_id AND td.ckdtbs = th.ckdtbs
       WHERE th.unit_id = $1 AND COALESCE(th.sbatal,0) = 0
         AND abs(COALESCE(td.nvolume,0)) <= ${GARBAGE_STOCK_L}
         AND th.cnoso IS NOT NULL AND th.dtgltbs <= $2::date
       GROUP BY 1, 2
     ),
     rec AS (
       SELECT trim(t.cnoso) AS cnoso, trim(t.ckdbbm) AS bbm,
              sum(t.nvoldo) FILTER (WHERE COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE '${TZ}')::date) <= $2::date) AS v_d,
              sum(t.nvoldo) FILTER (WHERE COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE '${TZ}')::date) <  $2::date) AS v_p
       FROM delivery t
       WHERE t.unit_id = $1 AND COALESCE(t.sbatal,0) = 0
         AND abs(COALESCE(t.nvoldo,0)) <= ${GARBAGE_STOCK_L}
         AND t.cnoso IS NOT NULL
         AND COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE '${TZ}')::date) <= $2::date
       GROUP BY 1, 2
     ),
     per_so AS (
       SELECT COALESCE(red.bbm, rec.bbm) AS bbm,
              GREATEST(0, COALESCE(red.v_d,0) - COALESCE(rec.v_d,0)) AS out_d,
              GREATEST(0, COALESCE(red.v_p,0) - COALESCE(rec.v_p,0)) AS out_p,
              red.lastd AS lastd
       FROM red FULL JOIN rec ON red.cnoso = rec.cnoso AND red.bbm = rec.bbm
     ),
     sisa AS (
       SELECT bbm, sum(out_d)::float8 AS sisa, sum(out_p)::float8 AS do_awal,
              COALESCE(sum(out_d) FILTER (WHERE lastd < $2::date - ${DO_STALE_DAYS}), 0)::float8 AS sisa_macet
       FROM per_so GROUP BY bbm
     ),
     penf AS (
       SELECT trim(t.ckdbbm) AS bbm, sum(t.nvoldo)::float8 AS v FROM delivery t
       WHERE t.unit_id = $1 AND COALESCE(t.sbatal,0) = 0 AND abs(COALESCE(t.nvoldo,0)) <= ${GARBAGE_STOCK_L}
         AND COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE '${TZ}')::date) = $2::date GROUP BY 1
     ),
     tebf AS (
       SELECT trim(td.ckdbbm) AS bbm, sum(td.nvolume)::float8 AS v
       FROM tebus_header th JOIN tebus_detail td ON td.unit_id = th.unit_id AND td.ckdtbs = th.ckdtbs
       WHERE th.unit_id = $1 AND COALESCE(th.sbatal,0) = 0 AND abs(COALESCE(td.nvolume,0)) <= ${GARBAGE_STOCK_L}
         AND th.dtgltbs = $2::date GROUP BY 1
     ),
     prod AS (SELECT bbm FROM sisa UNION SELECT bbm FROM penf UNION SELECT bbm FROM tebf)
     SELECT prod.bbm AS ckdbbm,
            COALESCE(max(p.vcnmbbm), prod.bbm) AS nama,
            COALESCE(max(s.do_awal),0)::float8 AS do_awal,
            COALESCE(max(pf.v),0)::float8 AS penerimaan,
            COALESCE(max(tf.v),0)::float8 AS penebusan,
            COALESCE(max(s.sisa),0)::float8 AS sisa,
            COALESCE(max(s.sisa_macet),0)::float8 AS sisa_macet
     FROM prod
     LEFT JOIN sisa s ON s.bbm = prod.bbm
     LEFT JOIN penf pf ON pf.bbm = prod.bbm
     LEFT JOIN tebf tf ON tf.bbm = prod.bbm
     LEFT JOIN product p ON p.unit_id = $1 AND trim(p.ckdbbm) = prod.bbm
     GROUP BY prod.bbm`,
    [unit, date],
  );
}

export interface DoAnomalyRow {
  ckdbbm: string;
  nama: string;
  /** Penerimaan ber-CNOSO tanpa tr_htebus (≤D) — "penerimaan tanpa penebusan". */
  orphan: number;
  /** Σ_SO kelebihan terima vs ditebus (rec−red>0, ≤D), SO yang punya tebus. */
  over_receipt: number;
  /**
   * Produk AKTIF = masih dipetakan ≥1 tangki (tm_tangki full-sync tiap siklus).
   * Aturan berbasis-data, tanpa hardcode nama (keputusan owner 2026-07-12):
   * produk nonaktif (mis. PREMIUM) dipisahkan dari daftar kerja aktif.
   */
  aktif: boolean;
}

/**
 * Anomali alokasi DO (≤ `date`) per produk untuk panel "Alokasi Penerimaan Tidak
 * Sesuai": (a) orphan = penerimaan ber-CNOSO yang tak punya `tr_htebus`; (b)
 * over-receipt = SO yang diterima melebihi yang ditebus. Keduanya di-clamp keluar
 * dari Sisa per-SO → ditampilkan di sini agar tak hilang. Ter-scope.
 */
export async function getDoAnomalies(
  unit: ScopedUnitId,
  date: string,
): Promise<DoAnomalyRow[]> {
  return qScoped<DoAnomalyRow>(
    unit,
    `WITH red AS (
       SELECT trim(th.cnoso) AS cnoso, trim(td.ckdbbm) AS bbm, sum(td.nvolume) AS v
       FROM tebus_header th JOIN tebus_detail td ON td.unit_id = th.unit_id AND td.ckdtbs = th.ckdtbs
       WHERE th.unit_id = $1 AND COALESCE(th.sbatal,0) = 0 AND abs(COALESCE(td.nvolume,0)) <= ${GARBAGE_STOCK_L}
         AND th.cnoso IS NOT NULL AND th.dtgltbs <= $2::date GROUP BY 1, 2
     ),
     rec AS (
       SELECT trim(t.cnoso) AS cnoso, trim(t.ckdbbm) AS bbm, sum(t.nvoldo) AS v
       FROM delivery t
       WHERE t.unit_id = $1 AND COALESCE(t.sbatal,0) = 0 AND abs(COALESCE(t.nvoldo,0)) <= ${GARBAGE_STOCK_L}
         AND t.cnoso IS NOT NULL AND COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE '${TZ}')::date) <= $2::date GROUP BY 1, 2
     ),
     j AS (
       SELECT COALESCE(red.bbm, rec.bbm) AS bbm,
              CASE WHEN red.cnoso IS NULL THEN COALESCE(rec.v,0) ELSE 0 END AS orphan,
              CASE WHEN red.cnoso IS NOT NULL THEN GREATEST(0, COALESCE(rec.v,0) - COALESCE(red.v,0)) ELSE 0 END AS over_r
       FROM red FULL JOIN rec ON red.cnoso = rec.cnoso AND red.bbm = rec.bbm
     )
     SELECT j.bbm AS ckdbbm, COALESCE(max(p.vcnmbbm), j.bbm) AS nama,
            sum(j.orphan)::float8 AS orphan, sum(j.over_r)::float8 AS over_receipt,
            EXISTS (SELECT 1 FROM tangki g WHERE g.unit_id = $1 AND trim(g.ckdbbm) = j.bbm) AS aktif
     FROM j LEFT JOIN product p ON p.unit_id = $1 AND trim(p.ckdbbm) = j.bbm
     GROUP BY j.bbm
     HAVING sum(j.orphan) <> 0 OR sum(j.over_r) <> 0`,
    [unit, date],
  );
}

export interface DoSuspectSO {
  cnoso: string;
  ckdbbm: string;
  nama: string;
  /** Volume ditebus untuk (SO,produk) ≤D. */
  ditebus: number;
  /** Volume diterima untuk (SO,produk) ≤D. */
  diterima: number;
  /** Outstanding = ditebus − diterima (>0). */
  outstanding: number;
  /** Tanggal penebusan terakhir SO ini (YYYY-MM-DD). */
  sejak: string;
  /** Umur outstanding dalam hari (≤D). */
  umur_hari: number;
  /** Produk masih dipetakan tangki (lihat DoAnomalyRow.aktif). */
  aktif: boolean;
}

/** Ambang umur (hari) sebuah DO dianggap "macet/suspect" bila belum tuntas. */
export const DO_STALE_DAYS = 30;

/**
 * Daftar SO ber-outstanding **macet** (ditebus > `DO_STALE_DAYS` hari lalu, BBM
 * belum tuntas diterima per (CNOSO,produk)) — kandidat **salah input produk/volume
 * di EasyMax** (mis. tebus 80rb Pertamax tapi fisik masuk tangki lain). Inilah yang
 * menyetir "phantom outstanding" di Sisa per-SO; ditampilkan sbg daftar-kerja
 * koreksi-sumber untuk owner. Setelah diralat di POS, per-SO bersih sendiri (tanpa
 * ubah kode). Ter-scope; murni SELECT.
 */
export async function getDoSuspectSO(
  unit: ScopedUnitId,
  date: string,
): Promise<DoSuspectSO[]> {
  return qScoped<DoSuspectSO>(
    unit,
    `WITH red AS (
       SELECT trim(th.cnoso) AS cnoso, trim(td.ckdbbm) AS bbm,
              sum(td.nvolume) AS v, max(th.dtgltbs) AS lastd
       FROM tebus_header th JOIN tebus_detail td ON td.unit_id = th.unit_id AND td.ckdtbs = th.ckdtbs
       WHERE th.unit_id = $1 AND COALESCE(th.sbatal,0) = 0 AND abs(COALESCE(td.nvolume,0)) <= ${GARBAGE_STOCK_L}
         AND th.cnoso IS NOT NULL AND th.dtgltbs <= $2::date GROUP BY 1, 2
     ),
     rec AS (
       SELECT trim(t.cnoso) AS cnoso, trim(t.ckdbbm) AS bbm, sum(t.nvoldo) AS v
       FROM delivery t
       WHERE t.unit_id = $1 AND COALESCE(t.sbatal,0) = 0 AND abs(COALESCE(t.nvoldo,0)) <= ${GARBAGE_STOCK_L}
         AND t.cnoso IS NOT NULL AND COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE '${TZ}')::date) <= $2::date GROUP BY 1, 2
     )
     SELECT red.cnoso, red.bbm AS ckdbbm, COALESCE(max(p.vcnmbbm), red.bbm) AS nama,
            red.v::float8 AS ditebus, COALESCE(rec.v,0)::float8 AS diterima,
            (red.v - COALESCE(rec.v,0))::float8 AS outstanding,
            to_char(red.lastd,'YYYY-MM-DD') AS sejak,
            ($2::date - red.lastd) AS umur_hari,
            EXISTS (SELECT 1 FROM tangki g WHERE g.unit_id = $1 AND trim(g.ckdbbm) = red.bbm) AS aktif
     FROM red LEFT JOIN rec ON rec.cnoso = red.cnoso AND rec.bbm = red.bbm
     LEFT JOIN product p ON p.unit_id = $1 AND trim(p.ckdbbm) = red.bbm
     WHERE red.v - COALESCE(rec.v,0) > 0 AND red.lastd < ($2::date - ${DO_STALE_DAYS})
     GROUP BY red.cnoso, red.bbm, red.v, rec.v, red.lastd
     ORDER BY aktif DESC, outstanding DESC, red.lastd ASC
     LIMIT 50`,
    [unit, date],
  );
}

// ---------------------------------------------------------------------------
// Stok (estimasi dari opname terakhir + mutasi sejak itu)
// ---------------------------------------------------------------------------

export interface TankStock {
  ckdtangki: string;
  ckdbbm: string | null;
  nama: string | null;
  /** stok fisik saat opname terakhir */
  stock_op: number | null;
  /** waktu opname terakhir (ISO UTC) */
  opname_at: string | null;
  /** penjualan sejak opname (per tangki) */
  sold_since: number;
  /** penerimaan sejak opname (per tangki) */
  received_since: number;
}

export async function getTankStocks(unit: ScopedUnitId): Promise<TankStock[]> {
  return qScoped<TankStock>(
    unit,
    `WITH last_op AS (
       SELECT DISTINCT ON (o.ckdtangki) o.ckdtangki, o.ckdbbm, o.nstockop, o.dtgljam
       FROM opname o
       WHERE o.unit_id = $1 AND COALESCE(o.sbatal,0) = 0
       ORDER BY o.ckdtangki, o.dtgljam DESC
     )
     SELECT trim(t.ckdtangki) AS ckdtangki,
            trim(COALESCE(lo.ckdbbm, t.ckdbbm)) AS ckdbbm,
            (SELECT max(p.vcnmbbm) FROM product p
              WHERE p.unit_id = $1 AND p.ckdbbm = COALESCE(lo.ckdbbm, t.ckdbbm)) AS nama,
            lo.nstockop::float8 AS stock_op,
            to_char(lo.dtgljam AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS opname_at,
            COALESCE((SELECT sum(sd.nvolume) FROM sales_detail sd
              WHERE sd.unit_id = $1 AND sd.ckdtangki = t.ckdtangki
                AND abs(COALESCE(sd.nvolume,0)) <= ${GARBAGE_STOCK_L}
                AND lo.dtgljam IS NOT NULL AND sd.dtgljam > lo.dtgljam),0)::float8 AS sold_since,
            COALESCE((SELECT sum(d.nvolreal) FROM delivery d
              WHERE d.unit_id = $1 AND d.ckdtangki = t.ckdtangki AND COALESCE(d.sbatal,0)=0
                AND abs(COALESCE(d.nvolreal,0)) <= ${GARBAGE_STOCK_L}
                AND lo.dtgljam IS NOT NULL AND d.dtgljam > lo.dtgljam),0)::float8 AS received_since
     FROM tangki t
     LEFT JOIN last_op lo ON lo.ckdtangki = t.ckdtangki
     WHERE t.unit_id = $1
     ORDER BY trim(t.ckdtangki)`,
    [unit],
  );
}

/**
 * Snapshot ATG keadaan-kini per tangki (tabel `real_tank`, di-sync dari view
 * EasyMax `vw_realtm`). `ckdtangki` = kunci natural ("T-0N"); `nkapasitas` =
 * kapasitas OTORITATIF dari EasyMax (bukan kalibrasi). Tinggi mm di sumber.
 */
export interface RealTankRow {
  ckdtangki: string;
  nkapasitas: number | null;
  ntinggi: number | null;
  nvolume: number | null;
  nsuhu: number | null;
  ntinggiair: number | null;
  nvolumeair: number | null;
  reading_at: string | null; // ISO UTC waktu pembacaan
}

export async function getRealTank(unit: ScopedUnitId): Promise<RealTankRow[]> {
  return qScoped<RealTankRow>(
    unit,
    `SELECT trim(ckdtangki)    AS ckdtangki,
            nkapasitas::float8 AS nkapasitas,
            ntinggi::float8    AS ntinggi,
            nvolume::float8    AS nvolume,
            nsuhu::float8      AS nsuhu,
            ntinggiair::float8 AS ntinggiair,
            nvolumeair::float8 AS nvolumeair,
            to_char(dtanggaljam AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS reading_at
     FROM real_tank WHERE unit_id = $1 ORDER BY trim(ckdtangki)`,
    [unit],
  );
}

/**
 * Pengisian (penerimaan) TERAKHIR per tangki — utk blok "Pengisian" kartu denah.
 * EasyMax `tr_terimabbm` punya NVOLAWAL/NVOLAKHIR tapi BELUM di-sync (delivery
 * hanya nvolreal/nvolselisih) → kartu tampilkan volume real + selisih + waktu;
 * Awal/Akhir = n/a sampai kolom itu ikut pipeline.
 */
export interface LastFillRow {
  ckdtangki: string;
  nvolreal: number | null;
  nvolselisih: number | null;
  filled_at: string | null; // ISO UTC
}

export async function getLastFills(unit: ScopedUnitId): Promise<LastFillRow[]> {
  return qScoped<LastFillRow>(
    unit,
    `SELECT DISTINCT ON (trim(ckdtangki)) trim(ckdtangki) AS ckdtangki,
            nvolreal::float8 AS nvolreal,
            nvolselisih::float8 AS nvolselisih,
            to_char(dtgljam AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS filled_at
     FROM delivery
     WHERE unit_id = $1 AND COALESCE(sbatal,0) = 0 AND ckdtangki IS NOT NULL
     ORDER BY trim(ckdtangki), dtgljam DESC`,
    [unit],
  );
}

export interface NozzleRow {
  ckdnozzle: string;
  ckdtangki: string | null;
}

export async function getNozzles(unit: ScopedUnitId): Promise<NozzleRow[]> {
  return qScoped<NozzleRow>(
    unit,
    `SELECT trim(ckdnozzle) AS ckdnozzle, trim(ckdtangki) AS ckdtangki
     FROM nozzle WHERE unit_id = $1 ORDER BY trim(ckdnozzle)`,
    [unit],
  );
}

/** Rata-rata penjualan harian per produk, n hari bisnis terakhir (utk ketahanan). */
export interface AvgDaily {
  ckdbbm: string;
  avg_vol: number;
}

export async function getAvgDailySales(
  unit: ScopedUnitId,
  from: string,
  to: string,
): Promise<AvgDaily[]> {
  return qScoped<AvgDaily>(
    unit,
    `SELECT trim(sd.ckdbbm) AS ckdbbm,
            (COALESCE(sum(sd.nvolume),0) / GREATEST(($3::date - $2::date) + 1, 1))::float8 AS avg_vol
     FROM sales_detail sd
     JOIN sales_header h ON h.unit_id = sd.unit_id AND h.ckdjualbbm = sd.ckdjualbbm
     WHERE sd.unit_id = $1 AND h.dtgljual BETWEEN $2::date AND $3::date
     GROUP BY trim(sd.ckdbbm)`,
    [unit, from, to],
  );
}

// ---------------------------------------------------------------------------
// Kepatuhan & kas (struktur lama dipertahankan)
// ---------------------------------------------------------------------------

export interface ComplianceDay {
  d: string;
  shifts: number;
  tanks: number;
  cash_rows: number;
}

export async function getComplianceMatrix(
  unit: ScopedUnitId,
  days: number,
): Promise<ComplianceDay[]> {
  return qScoped<ComplianceDay>(
    unit,
    `WITH hari AS (
       SELECT generate_series(
         (now() AT TIME ZONE '${TZ}')::date - ($2::int - 1),
         (now() AT TIME ZONE '${TZ}')::date, interval '1 day')::date AS d
     )
     SELECT to_char(d,'YYYY-MM-DD') AS d,
       (SELECT count(DISTINCT h.nshift)::int FROM sales_header h
         WHERE h.unit_id = $1 AND h.dtgljual = hari.d) AS shifts,
       (SELECT count(DISTINCT o.ckdtangki)::int FROM opname o
         WHERE o.unit_id = $1 AND COALESCE(o.sbatal,0)=0
           AND COALESCE(o.dtaglopn,(o.dtgljam AT TIME ZONE '${TZ}')::date) = hari.d) AS tanks,
       (SELECT count(*)::int FROM cash_header c
         WHERE c.unit_id = $1 AND COALESCE(c.sbatal,0)=0 AND c.dtgl = hari.d) AS cash_rows
     FROM hari ORDER BY d DESC`,
    [unit, days],
  );
}

export async function getTankCount(unit: ScopedUnitId): Promise<number> {
  const rows = await qScoped<{ n: number }>(
    unit,
    `SELECT count(*)::int AS n FROM tangki WHERE unit_id = $1`,
    [unit],
  );
  return rows[0]?.n ?? 0;
}

export interface LastInputs {
  sales: string | null;
  opname: string | null;
  delivery: string | null;
  cash: string | null;
}

export async function getLastInputs(unit: ScopedUnitId): Promise<LastInputs> {
  const rows = await qScoped<LastInputs>(
    unit,
    `SELECT
       (SELECT to_char(max(dtgljam) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM sales_detail WHERE unit_id=$1) AS sales,
       (SELECT to_char(max(dtgljam) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM opname WHERE unit_id=$1) AS opname,
       (SELECT to_char(max(dtgljam) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM delivery WHERE unit_id=$1) AS delivery,
       (SELECT to_char(max(dtgl),'YYYY-MM-DD') FROM cash_header WHERE unit_id=$1) AS cash`,
    [unit],
  );
  return rows[0] ?? { sales: null, opname: null, delivery: null, cash: null };
}

export interface CashRow {
  ckdkb: string;
  vcket: string | null;
  ntotal: number | null;
  sbatal: number;
  kategori: string | null;
}

/** Nota kas pada satu tanggal bisnis (dorman → kosong, itu sinyalnya). */
export async function getCashForDate(unit: ScopedUnitId, date: string): Promise<CashRow[]> {
  return qScoped<CashRow>(
    unit,
    `SELECT trim(ch.ckdkb) AS ckdkb, ch.vcket, ch.ntotal::float8 AS ntotal,
            COALESCE(ch.sbatal,0)::int AS sbatal,
            (SELECT max(a.vcnmperk) FROM cash_detail cd
              LEFT JOIN account a ON a.unit_id = cd.unit_id AND a.ckdperk = cd.ckdperk
              WHERE cd.unit_id = ch.unit_id AND cd.ckdkb = ch.ckdkb) AS kategori
     FROM cash_header ch
     WHERE ch.unit_id = $1 AND ch.dtgl = $2::date
     ORDER BY ch.ckdkb`,
    [unit, date],
  );
}

// ===========================================================================
// Rincian Penjualan — seksi auto-sync (FASE 1c). Sumber TERKUNCI by probe
// (ADR-001). Query schema-qualified; tiap fungsi per-unit lewat ScopedUnitId.
// ===========================================================================

export interface PelangganRow {
  ckdplg: string | null;
  nama: string | null;
  liter: number;
  rp: number;
}

/**
 * Seksi 2 Pelanggan (penjualan tempo) = UNION pelanggan_sale ∪ voucher_sale,
 * SUM per CKDPLG, non-batal. C = Σ rp; volume = Σ liter (lihat ADR-001).
 */
export async function getPelangganForDate(
  unit: ScopedUnitId,
  date: string,
): Promise<PelangganRow[]> {
  return qScoped<PelangganRow>(
    unit,
    `SELECT u.ckdplg,
            max(u.nama) AS nama,
            COALESCE(sum(u.liter),0)::float8 AS liter,
            COALESCE(sum(u.rp),0)::float8 AS rp
     FROM (
       SELECT trim(ps.ckdplg) AS ckdplg, ps.vcnmplg AS nama,
              COALESCE(ps.liter,0) AS liter, COALESCE(ps.total,0) AS rp
       FROM public.pelanggan_sale ps
       WHERE ps.unit_id = $1 AND ps.business_date = $2::date AND COALESCE(ps.sbatal,0) = 0
       UNION ALL
       SELECT trim(vs.ckdplg), vs.vcnmplg,
              COALESCE(vs.liter,0), COALESCE(vs.total,0)
       FROM public.voucher_sale vs
       WHERE vs.unit_id = $1 AND vs.business_date = $2::date AND COALESCE(vs.sbatal,0) = 0
     ) u
     GROUP BY u.ckdplg
     ORDER BY rp DESC`,
    [unit, date],
  );
}

export interface TerraRow {
  ckdbbm: string | null;
  nama: string | null;
  liter: number;
  rp: number;
}

/**
 * Seksi TERRA (Rincian) + komponen B "Terra/Nozzle Test" = ledger RESMI
 * `terra_resmi`, SUM per produk (nama resolve by `product.vcnmbbm`),
 * business_date = DTGLTERRA, hanya sbatal=0. B = Σ rp; volume = Σ nvolume.
 * SUMBER TUNGGAL (identik dengan kolom Tera Laporan & net-sales G/L `terad`).
 * Rekon eksak ke seksi TERRA PDF: 17/6 DEXLITE 21,00/493.500 + PERTALITE
 * 61,27/612.700; 24/6 PERTAMAX 21,08/350.982; hari tanpa tera resmi → 0 baris.
 */
export async function getTerraResmiForDate(
  unit: ScopedUnitId,
  date: string,
): Promise<TerraRow[]> {
  return qScoped<TerraRow>(
    unit,
    `SELECT trim(t.ckdbbm) AS ckdbbm,
            COALESCE(max(p.vcnmbbm), trim(t.ckdbbm)) AS nama,
            COALESCE(sum(t.nvolume),0)::float8 AS liter,
            COALESCE(sum(t.ntotal),0)::float8 AS rp
     FROM public.terra_resmi t
     LEFT JOIN public.product p ON p.unit_id = t.unit_id AND trim(p.ckdbbm) = trim(t.ckdbbm)
     WHERE t.unit_id = $1 AND t.business_date = $2::date AND COALESCE(t.sbatal,0) = 0
     GROUP BY trim(t.ckdbbm)
     ORDER BY rp DESC`,
    [unit, date],
  );
}

export interface EdcChannelRow {
  ckdkartu: string;
  nama: string;
  rp: number;
}

/**
 * Seksi 3 EDC = SUM per channel (CKDKARTU) by business_date, KECUALI blank-card
 * (ckdkartu NULL — agent memetakan '' → null). D = Σ rp. Nama dari master card.
 */
export async function getEdcForDate(
  unit: ScopedUnitId,
  date: string,
): Promise<EdcChannelRow[]> {
  return qScoped<EdcChannelRow>(
    unit,
    `SELECT trim(e.ckdkartu) AS ckdkartu,
            COALESCE(max(c.vcnmcard), trim(e.ckdkartu)) AS nama,
            COALESCE(sum(e.total),0)::float8 AS rp
     FROM public.edc e
     LEFT JOIN public.card c ON c.unit_id = e.unit_id AND c.ckdcard = e.ckdkartu
     WHERE e.unit_id = $1 AND e.business_date = $2::date
       AND e.ckdkartu IS NOT NULL AND trim(e.ckdkartu) <> ''
     GROUP BY trim(e.ckdkartu)
     ORDER BY rp DESC`,
    [unit, date],
  );
}

export interface EdcBlankCard {
  rp: number;
  n: number;
}

/**
 * Total EDC blank-card (ckdkartu NULL) — DIKECUALIKAN dari channel-sum laporan
 * tapi WAJIB ditampilkan sebagai flag kepatuhan (keputusan #3, ADR-001).
 */
export async function getEdcBlankCard(
  unit: ScopedUnitId,
  date: string,
): Promise<EdcBlankCard> {
  const rows = await qScoped<EdcBlankCard>(
    unit,
    `SELECT COALESCE(sum(e.total),0)::float8 AS rp, count(*)::int AS n
     FROM public.edc e
     WHERE e.unit_id = $1 AND e.business_date = $2::date
       AND (e.ckdkartu IS NULL OR trim(e.ckdkartu) = '')`,
    [unit, date],
  );
  return rows[0] ?? { rp: 0, n: 0 };
}

export interface DepositRow {
  ckdplg: string | null;
  vcket: string | null;
  rp: number;
}

/** Seksi 5 Pendapatan Non Tunai = deposit prabayar by DTGL, non-batal. */
export async function getDepositForDate(
  unit: ScopedUnitId,
  date: string,
): Promise<DepositRow[]> {
  return qScoped<DepositRow>(
    unit,
    `SELECT trim(d.ckdplg) AS ckdplg, d.vcket, COALESCE(d.ntotal,0)::float8 AS rp
     FROM public.deposit d
     WHERE d.unit_id = $1 AND d.dtgl = $2::date AND COALESCE(d.sbatal,0) = 0
     ORDER BY rp DESC`,
    [unit, date],
  );
}

export type ManualSection = "pendapatan_lain" | "pengeluaran" | "setoran_tunai";

export interface ManualEntryRow {
  id: string;
  keterangan: string;
  amount: number;
  urut: number;
}

export interface SaldoPelanggan {
  /** Saldo Piutang Pelanggan Lokal (SJENIS 1,5) — as-of (dtgl < tanggal bisnis). */
  piutangLokal: number;
  /** Saldo Piutang Pelanggan Online (SJENIS 3). */
  piutangOnline: number;
  /** Saldo Hutang Pelanggan Lokal — liabilitas (≤0; ditampilkan merah). */
  hutangLokal: number;
}

/**
 * Saldo Piutang/Hutang Pelanggan as-of tanggal bisnis (blok RECAP). Formula
 * TERKUNCI vs oracle (probe ronde 11-13, EKSAK 27-Jun); "as-of" = saldo dibawa
 * (dtgl < tanggal). Piutang dari `bppiut` (SJNSBP 1=debet/+, 2=kredit/−), split
 * via `pelanggan_master.sjenis`: Lokal {1,5}, Online {3}, SJENIS 4 DIKECUALIKAN
 * (dorman). Hutang dari `bphut` (SJNSBP 2=+, 1=−), dinegatifkan. Murni SELECT,
 * ter-scope `ScopedUnitId`. trim() kedua sisi join (char(12) vs varchar(12)).
 */
export async function getSaldoPelanggan(
  unit: ScopedUnitId,
  date: string,
): Promise<SaldoPelanggan> {
  const rows = await qScoped<SaldoPelanggan>(
    unit,
    `SELECT
       COALESCE((SELECT sum(b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END)
                 FROM public.bppiut b
                 JOIN public.pelanggan_master m
                   ON m.unit_id = b.unit_id AND trim(m.ckdplg) = trim(b.ckdplg)
                 WHERE b.unit_id = $1 AND COALESCE(b.sbatal,0) = 0
                   AND b.dtgl < $2::date AND m.sjenis IN (1,5)),0)::float8 AS "piutangLokal",
       COALESCE((SELECT sum(b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END)
                 FROM public.bppiut b
                 JOIN public.pelanggan_master m
                   ON m.unit_id = b.unit_id AND trim(m.ckdplg) = trim(b.ckdplg)
                 WHERE b.unit_id = $1 AND COALESCE(b.sbatal,0) = 0
                   AND b.dtgl < $2::date AND m.sjenis = 3),0)::float8 AS "piutangOnline",
       (-COALESCE((SELECT sum(h.njumlah * CASE h.sjnsbp WHEN 2 THEN 1 WHEN 1 THEN -1 ELSE 0 END)
                  FROM public.bphut h
                  WHERE h.unit_id = $1 AND COALESCE(h.sbatal,0) = 0
                    AND h.dtgl < $2::date),0))::float8 AS "hutangLokal"`,
    [unit, date],
  );
  return rows[0] ?? { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 };
}

/** Seksi 4 (pendapatan_lain) & 6 (pengeluaran) — input pengawas, non-void. */
export async function getManualEntries(
  unit: ScopedUnitId,
  date: string,
  section: ManualSection,
): Promise<ManualEntryRow[]> {
  return qScoped<ManualEntryRow>(
    unit,
    `SELECT id::text AS id, keterangan, amount::float8 AS amount, urut
     FROM app.manual_entry
     WHERE unit_id = $1 AND business_date = $2::date
       AND section = $3::app.manual_entry_section AND NOT void
     ORDER BY urut, created_at`,
    [unit, date, section],
  );
}

// ---------------------------------------------------------------------------
// Usulan Penebusan SO (app.usulan_so) — input pengawas per produk per tanggal
// ---------------------------------------------------------------------------

export type UsulanStatus = "draft" | "diajukan";

export interface UsulanSoRow {
  productKey: string;
  penerimaanHari: number;
  permintaanBesok: number;
  usulanPenebusan: number;
  status: UsulanStatus;
}

/** Baris AKTIF (non-void) usulan per produk untuk (unit, tanggal). Ter-scope. */
export async function getUsulanSo(unit: ScopedUnitId, date: string): Promise<UsulanSoRow[]> {
  return qScoped<UsulanSoRow>(
    unit,
    `SELECT product_key AS "productKey",
            penerimaan_hari::float8 AS "penerimaanHari",
            permintaan_besok::float8 AS "permintaanBesok",
            usulan_penebusan::float8 AS "usulanPenebusan",
            status
     FROM app.usulan_so
     WHERE unit_id = $1 AND business_date = $2::date AND NOT void`,
    [unit, date],
  );
}

export interface UsulanSoListItem {
  /** Tanggal bisnis usulan (YYYY-MM-DD). */
  date: string;
  totalPenerimaan: number;
  totalPermintaan: number;
  totalUsulan: number;
  status: UsulanStatus;
  /** Waktu simpan terakhir (ISO UTC) generasi aktif. */
  lastSavedAt: string | null;
}

/**
 * Riwayat usulan per tanggal (agregat baris AKTIF) untuk halaman daftar (C).
 * Status diambil dari max() — semua baris satu generasi berbagi status sama.
 * Ter-scope. `limit` membatasi riwayat (default 60 tanggal terbaru).
 */
export async function getUsulanSoList(
  unit: ScopedUnitId,
  limit = 60,
): Promise<UsulanSoListItem[]> {
  return qScoped<UsulanSoListItem>(
    unit,
    `SELECT to_char(business_date,'YYYY-MM-DD') AS date,
            sum(penerimaan_hari)::float8 AS "totalPenerimaan",
            sum(permintaan_besok)::float8 AS "totalPermintaan",
            sum(usulan_penebusan)::float8 AS "totalUsulan",
            max(status) AS status,
            to_char(max(updated_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastSavedAt"
     FROM app.usulan_so
     WHERE unit_id = $1 AND NOT void
     GROUP BY business_date
     ORDER BY business_date DESC
     LIMIT $2`,
    [unit, limit],
  );
}
