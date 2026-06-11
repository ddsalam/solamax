import { q } from "./db";

/**
 * Semua query dashboard — SELECT murni (read-only). Konvensi waktu:
 * tanggal BISNIS = kolom date sumber (DTGLJUAL / DTAGLOPN / DTGL) — shift 3
 * lewat tengah malam tetap tercatat di hari bisnisnya. "Hari ini" dihitung
 * dalam WIB (Asia/Pontianak), bukan UTC.
 */

const TZ = "Asia/Pontianak";

export interface UnitRow {
  unit_id: number;
  code: string;
  name: string;
}

export async function getUnits(): Promise<UnitRow[]> {
  return q<UnitRow>(
    `SELECT unit_id, code, name FROM unit WHERE active ORDER BY unit_id`,
  );
}

export async function getUnitByCode(code: string): Promise<UnitRow | null> {
  const rows = await q<UnitRow>(
    `SELECT unit_id, code, name FROM unit WHERE code = $1 AND active`,
    [code],
  );
  return rows[0] ?? null;
}

/** Satu baris per hari bisnis: kelengkapan input tiap modul. */
export interface ComplianceDay {
  d: string; // YYYY-MM-DD
  shifts: number; // distinct NSHIFT terisi (target 3)
  tanks: number; // distinct tangki ter-opname (target = total tangki)
  cash_rows: number; // nota kas hari itu (non-batal)
}

export async function getComplianceMatrix(
  unitId: number,
  days: number,
): Promise<ComplianceDay[]> {
  return q<ComplianceDay>(
    `WITH hari AS (
       SELECT generate_series(
         (now() AT TIME ZONE '${TZ}')::date - ($2::int - 1),
         (now() AT TIME ZONE '${TZ}')::date,
         interval '1 day'
       )::date AS d
     )
     SELECT to_char(d, 'YYYY-MM-DD') AS d,
       (SELECT count(DISTINCT h.nshift)::int FROM sales_header h
         WHERE h.unit_id = $1 AND h.dtgljual = hari.d) AS shifts,
       (SELECT count(DISTINCT o.ckdtangki)::int FROM opname o
         WHERE o.unit_id = $1 AND COALESCE(o.sbatal,0) = 0
           AND COALESCE(o.dtaglopn, (o.dtgljam AT TIME ZONE '${TZ}')::date) = hari.d) AS tanks,
       (SELECT count(*)::int FROM cash_header c
         WHERE c.unit_id = $1 AND COALESCE(c.sbatal,0) = 0 AND c.dtgl = hari.d) AS cash_rows
     FROM hari
     ORDER BY d DESC`,
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

/** Waktu input terakhir per modul (null = belum pernah). */
export interface LastInputs {
  sales: string | null; // timestamptz ISO
  opname: string | null;
  delivery: string | null;
  cash: string | null; // date
}

export async function getLastInputs(unitId: number): Promise<LastInputs> {
  const rows = await q<LastInputs>(
    `SELECT
       (SELECT to_char(max(dtgljam) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM sales_detail WHERE unit_id = $1) AS sales,
       (SELECT to_char(max(dtgljam) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM opname WHERE unit_id = $1) AS opname,
       (SELECT to_char(max(dtgljam) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM delivery WHERE unit_id = $1) AS delivery,
       (SELECT to_char(max(dtgl), 'YYYY-MM-DD') FROM cash_header WHERE unit_id = $1) AS cash`,
    [unitId],
  );
  return rows[0] ?? { sales: null, opname: null, delivery: null, cash: null };
}

/** Selisih (losses / kekurangan kiriman) terbesar dalam rentang hari. */
export interface SelisihRow {
  src: "opname" | "terima";
  d: string;
  ref: string; // tangki / no DO
  ckdbbm: string | null;
  selisih: number;
  basis: number | null; // stok buku / vol DO (untuk konteks %)
  sbatal: number;
}

export async function getSelisih(
  unitId: number,
  days: number,
  limit = 20,
): Promise<SelisihRow[]> {
  return q<SelisihRow>(
    `SELECT * FROM (
       SELECT 'opname'::text AS src,
              to_char(COALESCE(o.dtaglopn, (o.dtgljam AT TIME ZONE '${TZ}')::date), 'YYYY-MM-DD') AS d,
              trim(o.ckdtangki) AS ref, trim(o.ckdbbm) AS ckdbbm,
              o.nvolselisih::float8 AS selisih, o.nstockbk::float8 AS basis,
              COALESCE(o.sbatal,0)::int AS sbatal
       FROM opname o
       WHERE o.unit_id = $1 AND COALESCE(o.nvolselisih,0) <> 0
         AND o.dtgljam >= now() - ($2::int || ' days')::interval
       UNION ALL
       SELECT 'terima', to_char(COALESCE(t.dtgltrm, (t.dtgljam AT TIME ZONE '${TZ}')::date), 'YYYY-MM-DD'),
              trim(COALESCE(t.cnodo,'-')), trim(t.ckdbbm),
              t.nvolselisih::float8, t.nvoldo::float8, COALESCE(t.sbatal,0)::int
       FROM delivery t
       WHERE t.unit_id = $1 AND COALESCE(t.nvolselisih,0) <> 0
         AND t.dtgljam >= now() - ($2::int || ' days')::interval
     ) x
     ORDER BY abs(selisih) DESC
     LIMIT $3`,
    [unitId, days, limit],
  );
}

/** Omzet & volume harian (tanggal bisnis DTGLJUAL). */
export interface DailySales {
  d: string;
  vol: number;
  omzet: number;
}

export async function getDailySales(
  unitId: number,
  days: number,
): Promise<DailySales[]> {
  return q<DailySales>(
    `SELECT to_char(h.dtgljual, 'YYYY-MM-DD') AS d,
            COALESCE(sum(sd.nvolume),0)::float8 AS vol,
            COALESCE(sum(sd.nsubtotal),0)::float8 AS omzet
     FROM sales_header h
     JOIN sales_detail sd ON sd.unit_id = h.unit_id AND sd.ckdjualbbm = h.ckdjualbbm
     WHERE h.unit_id = $1
       AND h.dtgljual >= (now() AT TIME ZONE '${TZ}')::date - ($2::int - 1)
     GROUP BY h.dtgljual
     ORDER BY h.dtgljual`,
    [unitId, days],
  );
}

export interface ProductSales {
  ckdbbm: string;
  nama: string;
  vol: number;
  omzet: number;
}

export async function getProductSales(
  unitId: number,
  days: number,
): Promise<ProductSales[]> {
  return q<ProductSales>(
    `SELECT trim(sd.ckdbbm) AS ckdbbm,
            COALESCE(max(p.vcnmbbm), trim(sd.ckdbbm)) AS nama,
            COALESCE(sum(sd.nvolume),0)::float8 AS vol,
            COALESCE(sum(sd.nsubtotal),0)::float8 AS omzet
     FROM sales_detail sd
     JOIN sales_header h ON h.unit_id = sd.unit_id AND h.ckdjualbbm = sd.ckdjualbbm
     LEFT JOIN product p ON p.unit_id = sd.unit_id AND p.ckdbbm = sd.ckdbbm
     WHERE sd.unit_id = $1
       AND h.dtgljual >= (now() AT TIME ZONE '${TZ}')::date - ($2::int - 1)
     GROUP BY trim(sd.ckdbbm)
     ORDER BY omzet DESC`,
    [unitId, days],
  );
}

/** Kategori pengeluaran kas (join chart-of-accounts tm_perk). All-time bila dorman. */
export interface CashCategory {
  ckdperk: string;
  nama: string;
  total: number;
  n: number;
}

export async function getCashCategories(
  unitId: number,
  limit = 12,
): Promise<CashCategory[]> {
  return q<CashCategory>(
    `SELECT trim(cd.ckdperk) AS ckdperk,
            COALESCE(max(a.vcnmperk), trim(cd.ckdperk)) AS nama,
            COALESCE(sum(cd.njumlah),0)::float8 AS total,
            count(*)::int AS n
     FROM cash_detail cd
     JOIN cash_header ch ON ch.unit_id = cd.unit_id AND ch.ckdkb = cd.ckdkb
     LEFT JOIN account a ON a.unit_id = cd.unit_id AND a.ckdperk = cd.ckdperk
     WHERE cd.unit_id = $1 AND COALESCE(ch.sbatal,0) = 0
     GROUP BY trim(cd.ckdperk)
     ORDER BY total DESC
     LIMIT $2`,
    [unitId, limit],
  );
}
