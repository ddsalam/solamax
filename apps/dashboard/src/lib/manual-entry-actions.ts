"use server";

import { revalidatePath } from "next/cache";
import { qScoped } from "./db";
import type { ManualSection } from "./queries";
import { getDataScope } from "./scope";

/**
 * Server action seksi MANUAL (Pendapatan Lain / Pengeluaran) — tulis ke
 * `app.manual_entry`. Keamanan: `unit_id` SELALU dari `scope.requireUnit(code)`
 * (notFound bila di luar scope → tak menulis), BUKAN dari input mentah. RBAC:
 * pengawas/role-ber-scope unit ybs. `created_by_user_id` = user sesi. Edit =
 * void + re-create (jejak audit: `voided_by/voided_at`). Lihat ADR-001 / FASE1-PLAN.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function addManualEntry(input: {
  code: string;
  date: string;
  section: ManualSection;
  keterangan: string;
  amount: number;
}): Promise<ActionResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound(), tak menulis

  const ket = input.keterangan.trim();
  if (!ket) return { ok: false, error: "Keterangan wajib diisi." };
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: "Jumlah harus angka > 0." };
  }
  if (
    input.section !== "pendapatan_lain" &&
    input.section !== "pengeluaran" &&
    input.section !== "setoran_tunai"
  ) {
    return { ok: false, error: "Seksi tak dikenal." };
  }
  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };

  // unit_id = unit.unit_id (TER-SCOPE) — bukan input.code mentah. `urut` = ordering
  // berikutnya per (unit, tanggal, seksi); BUKAN unique (input manusia, ADR-001).
  await qScoped(
    unit.unit_id, // RLS (0016): set app.unit_ids → WITH CHECK pada INSERT ke app.manual_entry
    `INSERT INTO app.manual_entry
       (unit_id, business_date, section, urut, keterangan, amount, created_by_user_id)
     VALUES ($1, $2::date, $3::app.manual_entry_section,
       (SELECT COALESCE(MAX(urut),-1)+1 FROM app.manual_entry
         WHERE unit_id=$1 AND business_date=$2::date AND section=$3::app.manual_entry_section),
       $4, $5, $6)`,
    [unit.unit_id, input.date, input.section, ket, input.amount, scope.userId],
  );
  revalidatePath(`/unit/${unit.code}/rincian/${input.date}`);
  return { ok: true };
}

export async function voidManualEntry(input: {
  code: string;
  date: string;
  id: string;
}): Promise<ActionResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound()

  // Lapis-2: `unit_id = $3` ter-scope → mustahil membatalkan entri unit lain
  // walau `id` ditebak. Void (bukan DELETE) → jejak audit utuh.
  await qScoped(
    unit.unit_id, // RLS (0016): app.unit_ids → USING+WITH CHECK pada UPDATE app.manual_entry
    `UPDATE app.manual_entry
        SET void=true, voided_by_user_id=$1, voided_at=now(), updated_at=now()
      WHERE id=$2::uuid AND unit_id=$3 AND NOT void`,
    [scope.userId, input.id, unit.unit_id],
  );
  revalidatePath(`/unit/${unit.code}/rincian/${input.date}`);
  return { ok: true };
}
