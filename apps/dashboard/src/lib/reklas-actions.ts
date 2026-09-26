"use server";

import { revalidatePath } from "next/cache";
import { pool } from "./db";
import { AKUN_KOSONG, periksaReklas } from "./keuangan-reklas";
import { alasanTakBolehInput, PESAN_TAK_BOLEH_INPUT } from "./keuangan-wewenang";
import { getDataScope } from "./scope";
import { isTitipanBright } from "./titipan-bright";

/**
 * Server action `Reclassify` (§2.3, §10.29) — memindahkan AKUN AKUNTANSI satu
 * baris biaya/pendapatan lain pengawas, tanpa menyentuh barisnya.
 *
 * ⛔ Yang TIDAK pernah dilakukan berkas ini: UPDATE/DELETE pada
 * `app.manual_entry`. Fakta transaksi milik pengawas (§2.1); jejaknya satu baris
 * BARU di `app.reclassification` (0021, append-only — `dashboard_app` hanya
 * SELECT + INSERT). Membatalkan reklasifikasi = reklasifikasi balik, dan
 * keduanya tetap terlihat.
 *
 * ⛔ Yang tidak dipercaya dari browser: akun ASAL. Ia dibaca ulang di dalam
 * transaksi (akun efektif saat itu), dengan kunci baris supaya dua reklasifikasi
 * bersamaan tak mencatat asal yang sama.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ReklasResult = { ok: true } | { ok: false; error: string };

export async function reklasifikasiBiaya(input: {
  code: string;
  /** Tanggal halaman — untuk revalidate. */
  date: string;
  entryId: string;
  toAccount: string;
  reasonCode: string;
  note: string;
}): Promise<ReklasResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  // Reklasifikasi = tindakan Finance (§2.3) — gerbang tulis Layar 3 yang sama.
  const alasan = alasanTakBolehInput({ role: scope.role, email: scope.email });
  if (alasan !== null) return { ok: false, error: PESAN_TAK_BOLEH_INPUT[alasan] };
  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    // FOR UPDATE pada baris pengawas HANYA sebagai kunci antrean — tak ada
    // UPDATE yang menyusul. Dua reklasifikasi bersamaan diurutkan di sini, jadi
    // yang kedua membaca akun asal yang sudah diubah yang pertama.
    const r = await client.query<{
      section: string;
      void: boolean;
      status: string;
      keterangan: string;
      operationalCategory: string | null;
      accountingAccount: string | null;
    }>(
      `SELECT section::text AS section, void, status::text AS status, keterangan,
              operational_category AS "operationalCategory", accounting_account AS "accountingAccount"
         FROM app.manual_entry
        WHERE id = $1::uuid AND unit_id = $2
        FOR UPDATE`,
      [input.entryId, unit.unit_id],
    );
    const baris = r.rows[0];
    if (!baris) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Baris tak ditemukan di unit ini — muat ulang halaman." };
    }
    const terakhir = await client.query<{ toAccount: string }>(
      `SELECT to_account AS "toAccount" FROM app.reclassification
        WHERE source_kind = 'manual_entry' AND source_txn_id = $1::uuid AND unit_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [input.entryId, unit.unit_id],
    );
    const dari = terakhir.rows[0]?.toAccount ?? baris.accountingAccount;

    const kode = await client.query<{ code: string }>(
      `SELECT code FROM app.reason_code WHERE applies_to = 'reclass' AND active`,
    );
    const salah = periksaReklas({
      section: baris.section,
      void: baris.void,
      status: baris.status,
      titipanBright: isTitipanBright({
        section: baris.section,
        operationalCategory: baris.operationalCategory,
        keterangan: baris.keterangan,
      }),
      dari,
      ke: input.toAccount,
      alasan: input.reasonCode,
      alasanSah: new Set(kode.rows.map((k) => k.code)),
      catatan: input.note,
    });
    if (salah !== null) {
      await client.query("ROLLBACK");
      return { ok: false, error: salah };
    }

    await client.query(
      `INSERT INTO app.reclassification
         (unit_id, source_kind, source_txn_id, from_account, to_account, reason_code, note, created_by_user_id)
       VALUES ($1, 'manual_entry', $2::uuid, $3, $4, $5, $6, $7)`,
      [
        unit.unit_id,
        input.entryId,
        dari ?? AKUN_KOSONG,
        input.toAccount,
        input.reasonCode,
        input.note.trim() || null,
        scope.userId,
      ],
    );
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/${input.date}/input`);
    revalidatePath(`/keuangan/unit/${unit.code}/${input.date}`);
    revalidatePath("/keuangan/pemantauan");
    return { ok: true };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menyimpan reklasifikasi." };
  } finally {
    client.release();
  }
}
