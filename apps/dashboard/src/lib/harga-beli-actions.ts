"use server";

import { revalidatePath } from "next/cache";
import { pool } from "./db";
import { evaluateP1 } from "./harga-beli";
import { canInputKeuangan } from "./keuangan-wewenang";
import { getDataScope } from "./scope";

/**
 * Server action harga beli — permukaan TULIS pertama modul keuangan.
 *
 * Polanya SAMA dengan `usulan-actions.ts` / `manual-entry-actions.ts`; tak ada
 * pola baru di sini:
 *   · `unit_id` SELALU dari `scope.requireUnit(code)` — notFound() bila di luar
 *     scope, jadi aksi ini tak pernah menulis untuk unit yang bukan haknya;
 *   · RLS 0016 di-set TRANSACTION-LOCAL lewat `set_config(..., true)` sebelum
 *     DML, sebab koneksi pool dipakai bergantian antar-request;
 *   · VOID-only: baris lama tak pernah di-UPDATE, apalagi di-DELETE.
 *
 * ⛔ TIGA HAL YANG MENGIKAT DI SINI:
 *
 * 1. **Gerbang tulis `canInputKeuangan`** (§2.6) — pengawas tidak boleh
 *    menulis harga beli. Diperiksa di SERVER; tombol yang disembunyikan di
 *    layar bukan gerbang.
 * 2. **P1 tidak pernah menolak karena NILAINYA** (§4.1). Yang menghalangi
 *    penyimpanan adalah PENGAKUAN yang belum lengkap. Diuji ke 2.048 hari
 *    Bakau: reject keras akan memblokir 336 hari yang sah.
 * 3. **Harga jual tidak diterima dari client.** Ia dibaca ulang di server dari
 *    EasyMax. Kalau nilai P1 datang dari browser, siapa pun bisa mematikan
 *    penjaga itu dengan mengirim harga jual palsu — penjaga yang bisa dimatikan
 *    oleh yang dijaganya bukan penjaga.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ActionResult =
  | { ok: true; p1: boolean }
  | { ok: false; error: string; missing?: ReadonlyArray<"acknowledgement" | "reason"> };

export interface SimpanHargaBeliInput {
  code: string;
  /** Tanggal halaman — dipakai untuk revalidate, BUKAN untuk berlaku-sejak. */
  date: string;
  productKey: string;
  /** `YYYY-MM-DD`. Harga berlaku SEJAK tanggal ini sampai diganti. */
  effectiveFrom: string;
  price: number;
  sourceNote: string | null;
  /** Centang "saya sadar harga beli di atas harga jual". */
  acknowledged: boolean;
  reason: string | null;
}

export async function simpanHargaBeli(input: SimpanHargaBeliInput): Promise<ActionResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound(), tak menulis

  if (!canInputKeuangan({ role: scope.role, email: scope.email })) {
    return { ok: false, error: "Hanya peran Keuangan yang boleh mengisi harga beli." };
  }
  if (!DATE_RE.test(input.date) || !DATE_RE.test(input.effectiveFrom)) {
    return { ok: false, error: "Tanggal tak valid." };
  }
  const productKey = input.productKey.trim();
  if (productKey === "") return { ok: false, error: "Produk wajib dipilih." };
  if (!(typeof input.price === "number" && Number.isFinite(input.price) && input.price > 0)) {
    // Nol adalah harga yang sah secara tipe tetapi mustahil secara ekonomi, dan
    // ia menular diam-diam: HargaBeli Solar Bakau yang kosong membuat COGS dan
    // Inventory Solar = 0 selama berbulan-bulan tanpa satu pun alarm.
    return { ok: false, error: "Harga beli harus lebih besar dari nol." };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    // Harga jual dibaca DI SERVER (lihat butir 3 di kepala berkas): harga jual
    // terakhir yang teramati pada/ sebelum tanggal berlaku.
    const jual = await client.query<{ price: number }>(
      `SELECT sd.nhargajual::float8 AS price
         FROM sales_detail sd
         JOIN sales_header h
           ON h.unit_id = sd.unit_id AND h.ckdjualbbm = sd.ckdjualbbm
        WHERE sd.unit_id = $1 AND trim(sd.ckdbbm) = $2 AND h.dtgljual <= $3::date
        ORDER BY h.dtgljual DESC, sd.dtgljam DESC
        LIMIT 1`,
      [unit.unit_id, productKey, input.effectiveFrom],
    );
    const sellPrice = jual.rows[0]?.price ?? null;

    const p1 = evaluateP1({
      buyPrice: input.price,
      sellPrice,
      acknowledged: input.acknowledged,
      reason: input.reason,
    });
    if (p1.triggered && !p1.canSave) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error:
          "Harga beli di atas harga jual. Ini boleh disimpan, tetapi harus diakui: " +
          "centang pengakuannya DAN tulis alasannya.",
        missing: p1.missing,
      };
    }

    // VOID-only: generasi lama untuk (produk, tanggal berlaku) yang sama
    // dibatalkan, bukan ditimpa — partial-unique `WHERE NOT void` (0020) terjaga
    // dan riwayat siapa-mengisi-apa tetap utuh.
    await client.query(
      `UPDATE app.purchase_price
          SET void=true, voided_by_user_id=$1, voided_at=now()
        WHERE unit_id=$2 AND product_key=$3 AND effective_from=$4::date AND NOT void`,
      [scope.userId, unit.unit_id, productKey, input.effectiveFrom],
    );
    await client.query(
      `INSERT INTO app.purchase_price
         (unit_id, product_key, effective_from, price, source_note,
          p1_triggered, p1_sell_price, p1_acknowledged_by, p1_acknowledged_at, p1_reason,
          created_by_user_id)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        unit.unit_id,
        productKey,
        input.effectiveFrom,
        input.price,
        input.sourceNote?.trim() || null,
        p1.triggered,
        p1.triggered ? sellPrice : null,
        p1.triggered ? scope.userId : null,
        p1.triggered ? new Date() : null,
        p1.triggered ? (input.reason ?? "").trim() : null,
      ],
    );
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/${input.date}/input`);
    return { ok: true, p1: p1.triggered };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan: koneksi mungkin sudah rusak */
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menyimpan." };
  } finally {
    client.release();
  }
}
