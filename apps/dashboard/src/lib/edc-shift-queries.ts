import { qScoped } from "./db";
import type { CekSlip, EdcEasymaxShift, PetaKartu } from "./edc-shift-model";
import type { ScopedUnitId } from "./scope";

/**
 * Bahan alur EDC per shift (§10.25) — BACA saja. Vonis di `edc-shift-model.ts`.
 *
 * Transaksi blank-card (`ckdkartu` kosong) sengaja TIDAK ikut: tanpa kode kartu
 * ia tak bisa dipetakan ke bank mana pun. Ia tetap terlihat sebagai flag
 * kepatuhan di Rincian (ADR-001 keputusan #3).
 */

/** Kueri bruto EasyMax per (shift, kode kartu) — dipakai layar DAN server action. */
export const SQL_EDC_PER_SHIFT = `
  SELECT COALESCE(NULLIF(trim(e.cshift), ''), '?')      AS cshift,
         trim(e.ckdkartu)                               AS ckdkartu,
         COALESCE(max(c.vcnmcard), trim(e.ckdkartu))    AS "namaKartu",
         COALESCE(sum(e.total), 0)::float8              AS rp,
         count(*)::int                                  AS n
    FROM public.edc e
    LEFT JOIN public.card c ON c.unit_id = e.unit_id AND c.ckdcard = e.ckdkartu
   WHERE e.unit_id = $1 AND e.business_date = $2::date
     AND e.ckdkartu IS NOT NULL AND trim(e.ckdkartu) <> ''
   GROUP BY 1, 2
  HAVING COALESCE(sum(e.total), 0) <> 0
   ORDER BY 1, 2`;

export async function getEdcPerShift(unit: ScopedUnitId, date: string): Promise<EdcEasymaxShift[]> {
  return qScoped<EdcEasymaxShift>(unit, SQL_EDC_PER_SHIFT, [unit, date]);
}

export async function getPetaKartu(unit: ScopedUnitId): Promise<PetaKartu[]> {
  return qScoped<PetaKartu>(
    unit,
    `SELECT ckdkartu, acquirer FROM app.edc_kartu_acquirer WHERE unit_id = $1 ORDER BY ckdkartu`,
    [unit],
  );
}

export async function getCekSlip(unit: ScopedUnitId, date: string): Promise<CekSlip[]> {
  return qScoped<CekSlip>(
    unit,
    `SELECT k.id::text                              AS id,
            k.cshift,
            k.acquirer,
            k.easymax_rp::float8                    AS "easymaxRp",
            k.slip_rp::float8                       AS "slipRp",
            k.checked_by_user_id                    AS "checkedByUserId",
            u.email                                 AS "checkedByEmail",
            to_char(k.checked_at AT TIME ZONE 'Asia/Pontianak', 'YYYY-MM-DD HH24:MI') AS "checkedAt",
            k.reason_code                           AS "reasonCode",
            EXISTS (
              SELECT 1 FROM app.cash_ledger l
               WHERE l.edc_shift_cek_id = k.id AND NOT l.void
            )                                       AS dibukukan,
            (k.slip_foto_ref IS NOT NULL)           AS "adaFoto"
       FROM app.edc_shift_cek k
       LEFT JOIN app.users u ON u.id = k.checked_by_user_id
      WHERE k.unit_id = $1 AND k.business_date = $2::date AND NOT k.void
      ORDER BY k.cshift, k.acquirer`,
    [unit, date],
  );
}

/** Nama bank yang sudah dipakai di unit ini — saran isian peta, supaya ejaannya seragam. */
export async function getAcquirerDikenal(unit: ScopedUnitId): Promise<string[]> {
  const r = await qScoped<{ a: string }>(
    unit,
    `SELECT DISTINCT acquirer AS a FROM app.edc_kartu_acquirer WHERE unit_id = $1
     UNION
     SELECT DISTINCT acquirer FROM app.edc_settlement WHERE unit_id = $1 AND NOT void
     ORDER BY 1`,
    [unit],
  );
  return r.map((x) => x.a);
}
