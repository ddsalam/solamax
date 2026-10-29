"use server";

import { KATEGORI_TITIPAN, POLA_KETERANGAN_TITIPAN } from "./titipan-bright";
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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function addManualEntry(input: {
  code: string;
  date: string;
  section: ManualSection;
  keterangan: string;
  amount: number;
  /** §10.27 — hanya untuk `pendapatan_lain`: titipan outlet, bukan pendapatan SPBU. */
  titipan?: boolean;
  /**
   * U5 (KTD11) — pemilik titipan (pihak lawan berjenis `titipan`, aktif, unit
   * yang SAMA). WAJIB bila `titipan`; diabaikan selain itu.
   */
  pemilikTitipanId?: string | null;
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
  // §10.27 — kategori titipan hanya bermakna di Pendapatan Lain. Pilihan
  // pengawas DICATAT eksplisit di dua arah: "titipan" → kategori titipan;
  // "bukan titipan" pada keterangan yang BERBUNYI titipan → 'Lain-Lain', supaya
  // pengenal baris lama (POLA_KETERANGAN_TITIPAN) tak menimpa pilihannya.
  const kategori =
    input.section !== "pendapatan_lain" || input.titipan === undefined
      ? null
      : input.titipan
        ? KATEGORI_TITIPAN
        : POLA_KETERANGAN_TITIPAN.test(ket)
          ? "Lain-Lain"
          : null;

  // U5 — pemilik titipan dipilih pengawas (kolom miliknya, §2.1) dan DIBACA
  // ULANG di server: aktif, unit yang SAMA, berjenis titipan. FK komposit 0049
  // hanya menjamin unit yang sama; jenis & aktif tak dijaga DB.
  let pemilik: string | null = null;
  if (kategori === KATEGORI_TITIPAN) {
    const id = input.pemilikTitipanId?.trim() ?? "";
    if (id === "") {
      return { ok: false, error: "Pilih pemilik titipan. Pemilik tidak ada? Hubungi Keuangan." };
    }
    if (!UUID_RE.test(id)) return { ok: false, error: "Pemilik titipan tak valid — muat ulang halaman lalu pilih lagi." };
    const [p] = await qScoped<{ nama: string; jenis: string; aktif: boolean }>(
      unit.unit_id,
      `SELECT nama, jenis, aktif FROM app.pihak_lawan WHERE id = $1::uuid AND unit_id = $2`,
      [id, unit.unit_id],
    );
    if (!p) return { ok: false, error: "Pemilik titipan tak ditemukan di unit ini — muat ulang halaman lalu pilih lagi." };
    if (p.jenis !== "titipan") {
      return { ok: false, error: `“${p.nama}” bukan pemilik titipan — pilih pemilik titipannya.` };
    }
    if (!p.aktif) {
      return { ok: false, error: `Pemilik titipan “${p.nama}” sudah nonaktif — pilih pemilik yang aktif atau hubungi Keuangan.` };
    }
    pemilik = id;
  }

  await qScoped(
    unit.unit_id, // RLS (0016): set app.unit_ids → WITH CHECK pada INSERT ke app.manual_entry
    `INSERT INTO app.manual_entry
       (unit_id, business_date, section, urut, keterangan, amount, created_by_user_id,
        operational_category, pihak_lawan_id)
     VALUES ($1, $2::date, $3::app.manual_entry_section,
       (SELECT COALESCE(MAX(urut),-1)+1 FROM app.manual_entry
         WHERE unit_id=$1 AND business_date=$2::date AND section=$3::app.manual_entry_section),
       $4, $5, $6, $7, $8::uuid)`,
    [unit.unit_id, input.date, input.section, ket, input.amount, scope.userId, kategori, pemilik],
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
      WHERE id=$2::uuid AND unit_id=$3 AND NOT void
        -- Baris pintu Finance bukan milik pengawas (§2): tak bisa dibatalkan dari Rincian.
        AND source_door = 'pengawas'`,
    [scope.userId, input.id, unit.unit_id],
  );
  revalidatePath(`/unit/${unit.code}/rincian/${input.date}`);
  return { ok: true };
}
