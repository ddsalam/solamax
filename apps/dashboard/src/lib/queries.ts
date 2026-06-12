import { q } from "./db";

/**
 * Semua query dashboard — SELECT murni (read-only, nol mutasi). Konvensi:
 * tanggal BISNIS = kolom date sumber (DTGLJUAL / DTAGLOPN / DTGL) — shift 3
 * lewat tengah malam tetap di hari bisnisnya. "Hari ini" dihitung WIB.
 */

const TZ = "Asia/Pontianak";

// ---------------------------------------------------------------------------
// Unit & sinkronisasi
// ---------------------------------------------------------------------------

export interface UnitRow {
  unit_id: number;
  code: string;
  name: string;
}

export async function getUnits(): Promise<UnitRow[]> {
  return q<UnitRow>(`SELECT unit_id, code, name FROM unit WHERE active ORDER BY unit_id`);
}

export async function getUnitByCode(code: string): Promise<UnitRow | null> {
  const rows = await q<UnitRow>(
    `SELECT unit_id, code, name FROM unit WHERE code = $1 AND active`,
    [code],
  );
  return rows[0] ?? null;
}

export interface SyncRow {
  unit_id: number;
  last_run: string | null; // ISO UTC
}

/** Sinkron terakhir per unit (max last_run_at lintas domain). */
export async function getSyncByUnit(): Promise<SyncRow[]> {
  return q<SyncRow>(
    `SELECT unit_id,
            to_char(max(last_run_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_run
     FROM sync_state GROUP BY unit_id`,
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
  unitId: number,
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
    [unitId, from, to],
  );
}

export interface DailyOmzet {
  d: string;
  vol: number;
  omzet: number;
}

export async function getDailyOmzet(
  unitId: number,
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
    [unitId, from, to],
  );
}

export interface SalesTotals {
  vol: number;
  omzet: number;
}

export async function getSalesTotals(
  unitId: number,
  from: string,
  to: string,
): Promise<SalesTotals> {
  const rows = await q<SalesTotals>(
    `SELECT COALESCE(sum(sd.nvolume),0)::float8 AS vol,
            COALESCE(sum(sd.nsubtotal),0)::float8 AS omzet
     FROM sales_detail sd
     JOIN sales_header h ON h.unit_id = sd.unit_id AND h.ckdjualbbm = sd.ckdjualbbm
     WHERE sd.unit_id = $1 AND h.dtgljual BETWEEN $2::date AND $3::date`,
    [unitId, from, to],
  );
  return rows[0] ?? { vol: 0, omzet: 0 };
}

export interface ShiftInfo {
  shifts: number;
  /** waktu rekam terakhir hari itu (jam tutup shift terakhir), ISO UTC */
  last_dtgljam: string | null;
}

export async function getShiftInfo(unitId: number, date: string): Promise<ShiftInfo> {
  const rows = await q<ShiftInfo>(
    `SELECT count(DISTINCT h.nshift)::int AS shifts,
            to_char(max(sd.dtgljam) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_dtgljam
     FROM sales_header h
     LEFT JOIN sales_detail sd ON sd.unit_id = h.unit_id AND sd.ckdjualbbm = h.ckdjualbbm
     WHERE h.unit_id = $1 AND h.dtgljual = $2::date`,
    [unitId, date],
  );
  return rows[0] ?? { shifts: 0, last_dtgljam: null };
}

/** Jumlah baris penjualan terkoreksi (SUBAH/SEDIT) pada satu tanggal bisnis. */
export async function getCorrections(unitId: number, date: string): Promise<number> {
  const rows = await q<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM sales_detail sd
     JOIN sales_header h ON h.unit_id = sd.unit_id AND h.ckdjualbbm = sd.ckdjualbbm
     WHERE sd.unit_id = $1 AND h.dtgljual = $2::date
       AND (COALESCE(sd.subah,0) <> 0 OR COALESCE(sd.sedit,0) <> 0)`,
    [unitId, date],
  );
  return rows[0]?.n ?? 0;
}

/** Nozzle yang punya koreksi hari ini (untuk titik ⟳ di denah). */
export async function getCorrectedNozzles(unitId: number, date: string): Promise<string[]> {
  const rows = await q<{ ckdnozzle: string }>(
    `SELECT DISTINCT trim(sd.ckdnozzle) AS ckdnozzle
     FROM sales_detail sd
     JOIN sales_header h ON h.unit_id = sd.unit_id AND h.ckdjualbbm = sd.ckdjualbbm
     WHERE sd.unit_id = $1 AND h.dtgljual = $2::date
       AND (COALESCE(sd.subah,0) <> 0 OR COALESCE(sd.sedit,0) <> 0)`,
    [unitId, date],
  );
  return rows.map((r) => r.ckdnozzle);
}

// ---------------------------------------------------------------------------
// Opname (gain/loss)
// ---------------------------------------------------------------------------

export interface GlByProduct {
  ckdbbm: string;
  nama: string;
  selisih: number;
}

/** Total NVOLSELISIH opname per produk pada rentang tanggal bisnis. */
export async function getGlByProduct(
  unitId: number,
  from: string,
  to: string,
): Promise<GlByProduct[]> {
  return q<GlByProduct>(
    `SELECT trim(o.ckdbbm) AS ckdbbm,
            COALESCE(max(p.vcnmbbm), trim(o.ckdbbm)) AS nama,
            COALESCE(sum(o.nvolselisih),0)::float8 AS selisih
     FROM opname o
     LEFT JOIN product p ON p.unit_id = o.unit_id AND p.ckdbbm = o.ckdbbm
     WHERE o.unit_id = $1 AND COALESCE(o.sbatal,0) = 0
       AND COALESCE(o.dtaglopn, (o.dtgljam AT TIME ZONE '${TZ}')::date) BETWEEN $2::date AND $3::date
     GROUP BY trim(o.ckdbbm)`,
    [unitId, from, to],
  );
}

export interface SelisihRow {
  src: "opname" | "terima";
  d: string;
  ref: string;
  ckdbbm: string | null;
  nama: string | null;
  selisih: number;
  basis: number | null;
  sbatal: number;
}

export async function getSelisih(
  unitId: number,
  from: string,
  to: string,
  limit = 20,
): Promise<SelisihRow[]> {
  return q<SelisihRow>(
    `SELECT * FROM (
       SELECT 'opname'::text AS src,
              to_char(COALESCE(o.dtaglopn,(o.dtgljam AT TIME ZONE '${TZ}')::date),'YYYY-MM-DD') AS d,
              trim(o.ckdtangki) AS ref, trim(o.ckdbbm) AS ckdbbm,
              (SELECT max(p.vcnmbbm) FROM product p WHERE p.unit_id=o.unit_id AND p.ckdbbm=o.ckdbbm) AS nama,
              o.nvolselisih::float8 AS selisih, o.nstockbk::float8 AS basis,
              COALESCE(o.sbatal,0)::int AS sbatal
       FROM opname o
       WHERE o.unit_id = $1 AND COALESCE(o.nvolselisih,0) <> 0
         AND COALESCE(o.dtaglopn,(o.dtgljam AT TIME ZONE '${TZ}')::date) BETWEEN $2::date AND $3::date
       UNION ALL
       SELECT 'terima',
              to_char(COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE '${TZ}')::date),'YYYY-MM-DD'),
              trim(COALESCE(t.cnodo,'-')), trim(t.ckdbbm),
              (SELECT max(p.vcnmbbm) FROM product p WHERE p.unit_id=t.unit_id AND p.ckdbbm=t.ckdbbm),
              t.nvolselisih::float8, t.nvoldo::float8, COALESCE(t.sbatal,0)::int
       FROM delivery t
       WHERE t.unit_id = $1 AND COALESCE(t.nvolselisih,0) <> 0
         AND COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE '${TZ}')::date) BETWEEN $2::date AND $3::date
     ) x ORDER BY abs(selisih) DESC LIMIT $4`,
    [unitId, from, to, limit],
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
  unitId: number,
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
    [unitId, from, to],
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

export async function getTankStocks(unitId: number): Promise<TankStock[]> {
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
    [unitId],
  );
}

export interface NozzleRow {
  ckdnozzle: string;
  ckdtangki: string | null;
}

export async function getNozzles(unitId: number): Promise<NozzleRow[]> {
  return q<NozzleRow>(
    `SELECT trim(ckdnozzle) AS ckdnozzle, trim(ckdtangki) AS ckdtangki
     FROM nozzle WHERE unit_id = $1 ORDER BY trim(ckdnozzle)`,
    [unitId],
  );
}

/** Rata-rata penjualan harian per produk, n hari bisnis terakhir (utk ketahanan). */
export interface AvgDaily {
  ckdbbm: string;
  avg_vol: number;
}

export async function getAvgDailySales(
  unitId: number,
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
    [unitId, from, to],
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
  unitId: number,
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
    [unitId, days],
  );
}

export async function getTankCount(unitId: number): Promise<number> {
  const rows = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM tangki WHERE unit_id = $1`,
    [unitId],
  );
  return rows[0]?.n ?? 0;
}

export interface LastInputs {
  sales: string | null;
  opname: string | null;
  delivery: string | null;
  cash: string | null;
}

export async function getLastInputs(unitId: number): Promise<LastInputs> {
  const rows = await q<LastInputs>(
    `SELECT
       (SELECT to_char(max(dtgljam) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM sales_detail WHERE unit_id=$1) AS sales,
       (SELECT to_char(max(dtgljam) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM opname WHERE unit_id=$1) AS opname,
       (SELECT to_char(max(dtgljam) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM delivery WHERE unit_id=$1) AS delivery,
       (SELECT to_char(max(dtgl),'YYYY-MM-DD') FROM cash_header WHERE unit_id=$1) AS cash`,
    [unitId],
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
export async function getCashForDate(unitId: number, date: string): Promise<CashRow[]> {
  return q<CashRow>(
    `SELECT trim(ch.ckdkb) AS ckdkb, ch.vcket, ch.ntotal::float8 AS ntotal,
            COALESCE(ch.sbatal,0)::int AS sbatal,
            (SELECT max(a.vcnmperk) FROM cash_detail cd
              LEFT JOIN account a ON a.unit_id = cd.unit_id AND a.ckdperk = cd.ckdperk
              WHERE cd.unit_id = ch.unit_id AND cd.ckdkb = ch.ckdkb) AS kategori
     FROM cash_header ch
     WHERE ch.unit_id = $1 AND ch.dtgl = $2::date
     ORDER BY ch.ckdkb`,
    [unitId, date],
  );
}
