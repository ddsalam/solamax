"use server";

import { bentukJurnalSesudahTulis } from "./buku-besar-tulis";
import { revalidatePath } from "next/cache";
import { pool } from "./db";
import { auditKeuangan } from "./keuangan-tx";
import { PESAN_TAK_BOLEH_INPUT, alasanTakBolehInput } from "./keuangan-wewenang";
import { NOMINAL_MANUAL_ENTRY_SQL } from "./manual-entry-nominal";
import { getDataScope } from "./scope";
import { periksaTautanBeban, type BebanTautan, type KasTautan } from "./tautan-model";

/**
 * TAUTKAN baris Biaya pintu Finance yang belum bermutasi ke mutasi buku
 * kas/bank yang DIPILIH staf Keuangan (rencana K6 U3; R27 jenis (b)).
 *
 * ⛔ SISTEM TIDAK MENEBAK: yang datang dari klien hanya dua id. Kedua baris
 * dibaca ulang & dikunci di transaksi, lalu `periksaTautanBeban` memutuskan
 * (pintu Finance saja, satu Biaya aktif per mutasi, nominal sama, ±3 hari,
 * kategori sejalan, bulan/hari terbuka). DB menegakkan dua yang terpenting
 * lagi: CHECK `manual_entry_cash_ledger_finance` dan unik parsial 0053.
 *
 * Yang ditulis HANYA `cash_ledger_id` — nominal, kategori, dan akun baris
 * Biaya tidak berubah. Hari tertutup: trigger 0026 menolak UPDATE, dan model
 * menolaknya lebih dulu dengan kalimat yang menyebut sebabnya.
 */

export type TautanResult = { ok: true } | { ok: false; error: string };

export async function tautkanBebanKeMutasi(input: {
  code: string;
  manualEntryId: string;
  cashLedgerId: string;
}): Promise<TautanResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound(), tak menulis
  const alasan = alasanTakBolehInput({ role: scope.role, email: scope.email });
  if (alasan !== null) return { ok: false, error: PESAN_TAK_BOLEH_INPUT[alasan] };

  const client = await pool.connect();
  const tolak = async (error: string): Promise<TautanResult> => {
    await client.query("ROLLBACK");
    return { ok: false, error };
  };
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    const b = await client.query<BebanTautan>(
      `SELECT m.id::text AS id, to_char(m.business_date,'YYYY-MM-DD') AS "businessDate",
              m.section::text AS section, m.source_door AS "sourceDoor", m.keterangan,
              ${NOMINAL_MANUAL_ENTRY_SQL}::float8 AS amount,
              m.operational_category AS "operationalCategory", m.void,
              m.cash_ledger_id::text AS "cashLedgerId",
              EXISTS (SELECT 1 FROM app.day_close d
                       WHERE d.unit_id = m.unit_id AND d.business_date = m.business_date
                         AND d.status = 'closed') AS "hariTertutup",
              EXISTS (SELECT 1 FROM app.tutup_bulan t
                       WHERE t.unit_id = m.unit_id AND t.bulan = date_trunc('month', m.business_date)::date) AS "bulanTertutup"
         FROM app.manual_entry m
        WHERE m.id = $1::uuid AND m.unit_id = $2
        FOR UPDATE OF m`,
      [input.manualEntryId, unit.unit_id],
    );
    const k = await client.query<KasTautan>(
      `SELECT l.id::text AS id, l.account_id::text AS "accountId", a.nama AS "namaAkun", a.kind::text AS "kindAkun",
              to_char(l.business_date,'YYYY-MM-DD') AS "businessDate", l.keterangan,
              l.category_label AS "categoryLabel", l.amount::float8 AS amount, l.void,
              EXISTS (SELECT 1 FROM app.manual_entry m
                       WHERE m.cash_ledger_id = l.id AND m.unit_id = l.unit_id AND NOT m.void) AS "bebanAktif",
              false AS "penebusanAktif",
              EXISTS (SELECT 1 FROM app.tutup_bulan t
                       WHERE t.unit_id = l.unit_id AND t.bulan = date_trunc('month', l.business_date)::date) AS "bulanTertutup"
         FROM app.cash_ledger l
         JOIN app.cash_account a ON a.id = l.account_id AND a.unit_id = l.unit_id
        WHERE l.id = $1::uuid AND l.unit_id = $2 AND NOT l.saldo_awal
        FOR UPDATE OF l`,
      [input.cashLedgerId, unit.unit_id],
    );
    const beban = b.rows[0];
    const kas = k.rows[0];
    if (!beban || !kas) return tolak("Baris tak ditemukan lagi — muat ulang halaman.");
    const salah = periksaTautanBeban(beban, kas);
    if (salah !== null) return tolak(salah);

    const res = await client.query(
      `UPDATE app.manual_entry
          SET cash_ledger_id = $1::uuid, updated_at = now()
        WHERE id = $2::uuid AND unit_id = $3 AND NOT void
          AND cash_ledger_id IS NULL AND source_door = 'finance'`,
      [input.cashLedgerId, input.manualEntryId, unit.unit_id],
    );
    if (res.rowCount !== 1) return tolak("Baris Biaya berubah sejak dibaca — muat ulang halaman.");

    await auditKeuangan(client, scope, "biaya.tautkan_mutasi", `${unit.code}/${input.manualEntryId}`, {
      kas: input.cashLedgerId,
      tanggalBiaya: beban.businessDate,
      tanggalKas: kas.businessDate,
      nominal: beban.amount,
    });
    await bentukJurnalSesudahTulis(client, unit.unit_id, { userId: scope.userId, email: scope.email });
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/${beban.businessDate}/input`);
    if (kas.businessDate !== beban.businessDate) revalidatePath(`/keuangan/unit/${unit.code}/${kas.businessDate}/input`);
    return { ok: true };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menautkan." };
  } finally {
    client.release();
  }
}
