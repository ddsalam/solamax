import { q } from "./db";
import type { ScopedUnitId } from "./scope";

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
  return q<SyncRow>(
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
  return q<ProductAgg>(
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
  return q<DailyOmzet>(
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
  const rows = await q<SalesTotals>(
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
  const rows = await q<ShiftInfo>(
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
  const rows = await q<{ n: number }>(
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
  const rows = await q<{ ckdnozzle: string }>(
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
  return q<ClosingOpnameRow>(
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

export interface DeliveryByTankDate {
  d: string;
  ckdtangki: string;
  vol: number;
}

/**
 * Volume DO diterima per (tanggal bisnis × tangki) — KONTEKS untuk anomali
 * opname (mis. "selisih −6.109 L · terima DO 7.814 L hari ini"). Murni
 * informatif; tidak mengklasifikasi/mengecualikan apa pun.
 */
export async function getDeliveryByTankDate(
  unit: ScopedUnitId,
  from: string,
  to: string,
): Promise<DeliveryByTankDate[]> {
  return q<DeliveryByTankDate>(
    `SELECT to_char(COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE '${TZ}')::date),'YYYY-MM-DD') AS d,
            trim(t.ckdtangki) AS ckdtangki,
            COALESCE(sum(t.nvolreal),0)::float8 AS vol
     FROM delivery t
     WHERE t.unit_id = $1 AND COALESCE(t.sbatal,0) = 0
       AND COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE '${TZ}')::date) BETWEEN $2::date AND $3::date
     GROUP BY 1, 2`,
    [unit, from, to],
  );
}

/** Kekurangan kiriman (NVOLSELISIH delivery) pada rentang — untuk anomali. */
export async function getDeliveryShortfalls(
  unit: ScopedUnitId,
  from: string,
  to: string,
  limit = 20,
): Promise<DeliveryShortfall[]> {
  return q<DeliveryShortfall>(
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
  return q<DeliveryAgg>(
    `SELECT trim(t.ckdbbm) AS ckdbbm,
            COALESCE(max(p.vcnmbbm), trim(t.ckdbbm)) AS nama,
            COALESCE(sum(t.nvolreal),0)::float8 AS vol
     FROM delivery t
     LEFT JOIN product p ON p.unit_id = t.unit_id AND p.ckdbbm = t.ckdbbm
     WHERE t.unit_id = $1 AND COALESCE(t.sbatal,0) = 0
       AND COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE '${TZ}')::date) BETWEEN $2::date AND $3::date
     GROUP BY trim(t.ckdbbm)`,
    [unit, from, to],
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
  return q<TankStock>(
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
                AND lo.dtgljam IS NOT NULL AND sd.dtgljam > lo.dtgljam),0)::float8 AS sold_since,
            COALESCE((SELECT sum(d.nvolreal) FROM delivery d
              WHERE d.unit_id = $1 AND d.ckdtangki = t.ckdtangki AND COALESCE(d.sbatal,0)=0
                AND lo.dtgljam IS NOT NULL AND d.dtgljam > lo.dtgljam),0)::float8 AS received_since
     FROM tangki t
     LEFT JOIN last_op lo ON lo.ckdtangki = t.ckdtangki
     WHERE t.unit_id = $1
     ORDER BY trim(t.ckdtangki)`,
    [unit],
  );
}

export interface NozzleRow {
  ckdnozzle: string;
  ckdtangki: string | null;
}

export async function getNozzles(unit: ScopedUnitId): Promise<NozzleRow[]> {
  return q<NozzleRow>(
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
  return q<AvgDaily>(
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
  return q<ComplianceDay>(
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
  const rows = await q<{ n: number }>(
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
  const rows = await q<LastInputs>(
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
  return q<CashRow>(
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
