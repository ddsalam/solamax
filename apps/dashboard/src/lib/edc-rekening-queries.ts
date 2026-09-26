import { qScoped } from "./db";
import type { KartuEdc, VersiRekening } from "./edc-rekening-model";
import type { ScopedUnitId } from "./scope";

/**
 * Bahan layar Pengaturan EDC (§10.28) — BACA saja. Susunan & aturan tanggal
 * berlaku di `edc-rekening-model.ts`.
 */

/** Seluruh versi pengaturan rekening pencairan unit ini, termasuk yang dibatalkan. */
export async function getVersiRekening(unit: ScopedUnitId): Promise<VersiRekening[]> {
  return qScoped<VersiRekening>(
    unit,
    `SELECT r.id::text                                   AS id,
            r.acquirer,
            r.to_account_id::text                        AS "toAccountId",
            a.nama                                       AS "namaAkun",
            to_char(r.berlaku_sejak, 'YYYY-MM-DD')       AS "berlakuSejak",
            r.catatan,
            u.email                                      AS oleh,
            to_char(r.created_at AT TIME ZONE 'Asia/Pontianak', 'YYYY-MM-DD HH24:MI') AS dibuat,
            r.void
       FROM app.edc_rekening_pencairan r
       JOIN app.cash_account a ON a.id = r.to_account_id AND a.unit_id = r.unit_id
       LEFT JOIN app.users u ON u.id = r.created_by_user_id
      WHERE r.unit_id = $1
      ORDER BY r.acquirer, r.berlaku_sejak DESC, r.created_at DESC`,
    [unit],
  );
}

/**
 * Kode kartu unit ini: yang BERTRANSAKSI dalam jendela ∪ yang SUDAH dipetakan.
 * Kode terpetakan yang sepi tetap tampil (n = 0) — petanya tetap berlaku dan
 * boleh dilihat; kode tak terpetakan yang sepi tak perlu diurus siapa pun.
 * Blank-card (`ckdkartu` kosong) tak ikut — ia tak bisa dipetakan (§10.25).
 */
export async function getKartuEdcUnit(
  unit: ScopedUnitId,
  dari: string,
  sampai: string,
): Promise<KartuEdc[]> {
  return qScoped<KartuEdc>(
    unit,
    `WITH jual AS (
       SELECT trim(e.ckdkartu)                           AS ckdkartu,
              count(*)::int                              AS n,
              COALESCE(sum(e.total), 0)::float8          AS rp
         FROM public.edc e
        WHERE e.unit_id = $1 AND e.business_date BETWEEN $2::date AND $3::date
          AND e.ckdkartu IS NOT NULL AND trim(e.ckdkartu) <> ''
        GROUP BY 1
     ), kode AS (
       SELECT ckdkartu FROM jual
       UNION
       SELECT ckdkartu FROM app.edc_kartu_acquirer WHERE unit_id = $1
     )
     SELECT k.ckdkartu,
            COALESCE((SELECT max(c.vcnmcard) FROM public.card c
                       WHERE c.unit_id = $1 AND trim(c.ckdcard) = k.ckdkartu), k.ckdkartu) AS "namaKartu",
            m.acquirer,
            COALESCE(j.n, 0)                             AS n,
            COALESCE(j.rp, 0)::float8                    AS rp
       FROM kode k
       LEFT JOIN jual j ON j.ckdkartu = k.ckdkartu
       LEFT JOIN app.edc_kartu_acquirer m ON m.unit_id = $1 AND m.ckdkartu = k.ckdkartu
      ORDER BY k.ckdkartu`,
    [unit, dari, sampai],
  );
}
