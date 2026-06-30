"use server";

import { revalidatePath } from "next/cache";
import { pool } from "./db";
import { DO_PRODUCTS } from "./config";
import type { UsulanStatus } from "./queries";
import { getDataScope } from "./scope";

/**
 * Server action Usulan Penebusan SO — tulis ke `app.usulan_so`. Keamanan identik
 * app.manual_entry: `unit_id` SELALU dari `scope.requireUnit(code)` (notFound bila
 * di luar scope → tak menulis), BUKAN input mentah. VOID-only: edit = void semua
 * baris aktif (unit,tanggal) lalu insert generasi baru — dalam SATU transaksi
 * (partial-unique `WHERE NOT void` terjaga). `created_by_user_id` = user sesi.
 * `status` informasional (draft → diajukan, pengawas-driven; tak ada role Keuangan).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_KEYS = new Set(DO_PRODUCTS.map((p) => p.key));

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface UsulanInputRow {
  productKey: string;
  penerimaanHari: number;
  permintaanBesok: number;
  usulanPenebusan: number;
}

export async function saveUsulanSo(input: {
  code: string;
  date: string;
  status: UsulanStatus;
  rows: UsulanInputRow[];
}): Promise<ActionResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound(), tak menulis

  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };
  if (input.status !== "draft" && input.status !== "diajukan") {
    return { ok: false, error: "Status tak dikenal." };
  }
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  const clean: UsulanInputRow[] = [];
  for (const r of input.rows) {
    if (!VALID_KEYS.has(r.productKey)) return { ok: false, error: `Produk tak dikenal: ${r.productKey}` };
    const a = num(r.penerimaanHari), b = num(r.permintaanBesok), c = num(r.usulanPenebusan);
    if (a === null || b === null || c === null) {
      return { ok: false, error: "Angka harus ≥ 0." };
    }
    clean.push({ productKey: r.productKey, penerimaanHari: a, permintaanBesok: b, usulanPenebusan: c });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Void generasi aktif lama (unit,tanggal) — `unit_id` ter-scope (lapis-2).
    await client.query(
      `UPDATE app.usulan_so
          SET void=true, voided_by_user_id=$1, voided_at=now(), updated_at=now()
        WHERE unit_id=$2 AND business_date=$3::date AND NOT void`,
      [scope.userId, unit.unit_id, input.date],
    );
    for (const r of clean) {
      await client.query(
        `INSERT INTO app.usulan_so
           (unit_id, business_date, product_key, penerimaan_hari, permintaan_besok,
            usulan_penebusan, status, created_by_user_id)
         VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8)`,
        [unit.unit_id, input.date, r.productKey, r.penerimaanHari, r.permintaanBesok,
          r.usulanPenebusan, input.status, scope.userId],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menyimpan." };
  } finally {
    client.release();
  }

  revalidatePath(`/unit/${unit.code}/usulan/${input.date}`);
  revalidatePath(`/unit/${unit.code}/usulan/${input.date}/edit`);
  return { ok: true };
}
