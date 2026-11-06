import type { PoolClient } from "pg";
import { periksaBatal, type IsianBatal } from "./batal-balik-model";
import { kunciHariBersama } from "./hari-buku-queries";
import { auditKeuangan, type Aktor } from "./keuangan-tx";
import type { ScopedUnitId } from "./scope";
import { bulanTertutupTerkunci } from "./tutup-bulan-queries";

/**
 * Inti TULIS Batalkan baris pintu Finance (rencana 2026-11-07 U3; R1–R3, KTD3)
 * — dipanggil DI DALAM transaksi pemanggil, sesudah
 * `set_config('app.unit_ids', '<unit>', true)`. Tanpa gerbang wewenang:
 * gerbangnya (`canBatalkanBarisFinance` + `requireUnit`) milik
 * `batal-balik-actions.ts` dan dijalankan SEBELUM BEGIN.
 *
 * ⚠️ Sengaja BUKAN berkas "use server" (pola `antar-unit-tulis.ts`): setiap
 * ekspor berkas seperti itu menjadi endpoint peramban — termasuk fungsi tanpa
 * gerbang ini. Dipisah supaya uji DB-live menguji SQL yang sama dengan aksi.
 *
 * Penjaga, berurutan:
 * 1. baris dikunci `FOR UPDATE` (dua Batalkan bersamaan diurutkan);
 * 2. kunci BERSAMA bulan → hari (urutan `cocok-bank-actions`), supaya
 *    `tutupBulan`/`tutupHari` tak bisa menyelip di antara periksa dan tulis;
 * 3. fakta dibaca ULANG di bawah kunci, lalu `periksaBatal` (pesan yang sama
 *    dengan layar);
 * 4. UPDATE bersyarat `NOT void` — trigger 0026 tetap jaring terakhir.
 */

export type HasilBatal = { ok: true; businessDate: string } | { ok: false; error: string };

export async function batalkanBarisFinance(
  c: PoolClient,
  unitId: ScopedUnitId,
  aktor: Aktor,
  input: IsianBatal & { entryId: string },
): Promise<HasilBatal> {
  const r = await c.query<{
    businessDate: string;
    sourceDoor: string;
    void: boolean;
    cashLedgerId: string | null;
    section: string;
    amount: string;
  }>(
    `SELECT to_char(business_date, 'YYYY-MM-DD') AS "businessDate", source_door AS "sourceDoor",
            void, cash_ledger_id::text AS "cashLedgerId", section::text AS section, amount::text AS amount
       FROM app.manual_entry
      WHERE id = $1::uuid AND unit_id = $2
        AND section IN ('pengeluaran', 'pendapatan_lain')
      FOR UPDATE`,
    [input.entryId, unitId],
  );
  const b = r.rows[0];
  if (!b) return { ok: false, error: "Baris tak ditemukan di unit ini — muat ulang halaman." };

  const bulanTutup = (await bulanTertutupTerkunci(c, unitId, [b.businessDate.slice(0, 7)])).length > 0;
  await kunciHariBersama(c, unitId, b.businessDate);
  const hari = await c.query<{ tutup: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM app.day_close
                     WHERE unit_id = $1 AND business_date = $2::date AND status = 'closed') AS tutup`,
    [unitId, b.businessDate],
  );
  const kode = await c.query<{ code: string }>(
    `SELECT code FROM app.reason_code WHERE applies_to = 'void' AND active`,
  );

  const salah = periksaBatal(
    {
      sourceDoor: b.sourceDoor,
      void: b.void,
      cashLedgerId: b.cashLedgerId,
      hariTutup: hari.rows[0]?.tutup === true,
      bulanTutup,
    },
    input,
    new Set(kode.rows.map((k) => k.code)),
  );
  if (salah !== null) return { ok: false, error: salah };

  const u = await c.query(
    `UPDATE app.manual_entry
        SET void = true, voided_at = now(), voided_by_user_id = $3, updated_at = now(),
            void_reason_code = $4, void_reason_applies_to = 'void', void_alasan = $5
      WHERE id = $1::uuid AND unit_id = $2 AND NOT void AND source_door = 'finance'`,
    [input.entryId, unitId, aktor.userId, input.reasonCode, input.alasan.trim()],
  );
  if (u.rowCount !== 1) return { ok: false, error: "Baris berubah saat disimpan — muat ulang halaman." };

  await auditKeuangan(c, aktor, "manual_entry.batal_finance", input.entryId, {
    unitId,
    businessDate: b.businessDate,
    section: b.section,
    amount: b.amount,
    reasonCode: input.reasonCode,
    alasan: input.alasan.trim(),
  });
  return { ok: true, businessDate: b.businessDate };
}
