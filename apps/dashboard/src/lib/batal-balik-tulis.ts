import type { PoolClient } from "pg";
import { KODE_BALIK, periksaAjukanBalik, periksaBatal, PESAN_BALIK, type IsianBatal } from "./batal-balik-model";
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

// ---------------------------------------------------------------------------
// Balik hari tertutup (rencana 2026-11-07 U5; R8–R12, KTD5, KTD6)
//
// Empat transisi atas `app.correction_request`; masing-masing satu transaksi
// pemanggil. Setiap transisi mengunci pengajuan `FOR UPDATE` dan menulis lewat
// `UPDATE … WHERE status = 'menunggu' RETURNING` — Tarik dan Setujui yang
// bersamaan: tepat satu menang, yang lain mendapat "sudah diputus". Pemisahan
// tugas dijaga di sini DAN CHECK 0060; keanggotaan penyetuju di aksi
// (`canSetujuiBalikBaris`), sebab HoF hidup di ENV.
// ---------------------------------------------------------------------------

export type HasilBalik = { ok: true; businessDate: string; requestId: string } | { ok: false; error: string };

/** Fakta baris untuk Balik, dibaca di bawah kunci (bulan → hari), seperti Batalkan. */
async function faktaBalik(c: PoolClient, unitId: ScopedUnitId, entryId: string) {
  const r = await c.query<{
    businessDate: string;
    sourceDoor: string;
    void: boolean;
    cashLedgerId: string | null;
    amount: string;
  }>(
    `SELECT to_char(business_date, 'YYYY-MM-DD') AS "businessDate", source_door AS "sourceDoor",
            void, cash_ledger_id::text AS "cashLedgerId", amount::text AS amount
       FROM app.manual_entry
      WHERE id = $1::uuid AND unit_id = $2 AND section IN ('pengeluaran', 'pendapatan_lain')
      FOR UPDATE`,
    [entryId, unitId],
  );
  const b = r.rows[0];
  if (!b) return null;
  const bulanTutup = (await bulanTertutupTerkunci(c, unitId, [b.businessDate.slice(0, 7)])).length > 0;
  await kunciHariBersama(c, unitId, b.businessDate);
  const f = await c.query<{ hariTutup: boolean; dibalik: boolean; menunggu: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM app.day_close
                     WHERE unit_id = $1 AND business_date = $2::date AND status = 'closed') AS "hariTutup",
            EXISTS (SELECT 1 FROM app.correction_entry
                     WHERE source_kind = 'manual_entry' AND kind = 'reversal'
                       AND original_txn_id = $3::uuid AND unit_id = $1) AS dibalik,
            EXISTS (SELECT 1 FROM app.correction_request
                     WHERE source_kind = 'manual_entry' AND status = 'menunggu'
                       AND original_txn_id = $3::uuid AND unit_id = $1) AS menunggu`,
    [unitId, b.businessDate, entryId],
  );
  return { ...b, bulanTutup, ...f.rows[0]! };
}

export async function ajukanBalik(
  c: PoolClient,
  unitId: ScopedUnitId,
  aktor: Aktor,
  input: IsianBatal & { entryId: string },
): Promise<HasilBalik> {
  const b = await faktaBalik(c, unitId, input.entryId);
  if (!b) return { ok: false, error: "Baris tak ditemukan di unit ini — muat ulang halaman." };
  const kode = await c.query<{ code: string }>(
    `SELECT code FROM app.reason_code WHERE applies_to = 'adjustment' AND active AND code = ANY($1::text[])`,
    [[...KODE_BALIK]],
  );
  const salah = periksaAjukanBalik(b, input, new Set(kode.rows.map((k) => k.code)));
  if (salah !== null) return { ok: false, error: salah };
  const r = await c.query<{ id: string }>(
    `INSERT INTO app.correction_request
       (unit_id, original_txn_id, reason_code, reason_applies_to, alasan, value_before, requested_by_user_id)
     VALUES ($1, $2::uuid, $3, 'adjustment', $4, $5::numeric, $6)
     RETURNING id::text`,
    [unitId, input.entryId, input.reasonCode, input.alasan.trim(), b.amount, aktor.userId],
  );
  const id = r.rows[0]!.id;
  await auditKeuangan(c, aktor, "correction_request.ajukan", id, {
    unitId,
    entryId: input.entryId,
    businessDate: b.businessDate,
    reasonCode: input.reasonCode,
  });
  return { ok: true, businessDate: b.businessDate, requestId: id };
}

/** Pengajuan, dikunci. `null` = tak ada di unit ini. */
async function kunciPengajuan(c: PoolClient, unitId: ScopedUnitId, requestId: string) {
  const r = await c.query<{
    entryId: string;
    status: string;
    requestedBy: number;
    reasonCode: string;
    valueBefore: string;
    businessDate: string;
  }>(
    `SELECT q.original_txn_id::text AS "entryId", q.status, q.requested_by_user_id AS "requestedBy",
            q.reason_code AS "reasonCode", q.value_before::text AS "valueBefore",
            to_char(m.business_date, 'YYYY-MM-DD') AS "businessDate"
       FROM app.correction_request q
       JOIN app.manual_entry m ON m.id = q.original_txn_id AND m.unit_id = q.unit_id
      WHERE q.id = $1::uuid AND q.unit_id = $2
      FOR UPDATE OF q`,
    [requestId, unitId],
  );
  return r.rows[0] ?? null;
}

export async function tarikBalik(
  c: PoolClient,
  unitId: ScopedUnitId,
  aktor: Aktor,
  input: { requestId: string },
): Promise<HasilBalik> {
  const q = await kunciPengajuan(c, unitId, input.requestId);
  if (!q) return { ok: false, error: "Pengajuan tak ditemukan di unit ini — muat ulang halaman." };
  if (q.status !== "menunggu") return { ok: false, error: PESAN_BALIK.bukanMenunggu };
  if (q.requestedBy !== aktor.userId) return { ok: false, error: PESAN_BALIK.bukanPengaju };
  const u = await c.query(
    `UPDATE app.correction_request
        SET status = 'ditarik', decided_by_user_id = $2, decided_at = now()
      WHERE id = $1::uuid AND status = 'menunggu' AND requested_by_user_id = $2
      RETURNING id`,
    [input.requestId, aktor.userId],
  );
  if (u.rowCount !== 1) return { ok: false, error: PESAN_BALIK.bukanMenunggu };
  await auditKeuangan(c, aktor, "correction_request.tarik", input.requestId, { unitId });
  return { ok: true, businessDate: q.businessDate, requestId: input.requestId };
}

export async function tolakBalik(
  c: PoolClient,
  unitId: ScopedUnitId,
  aktor: Aktor,
  input: { requestId: string; catatan: string },
): Promise<HasilBalik> {
  const q = await kunciPengajuan(c, unitId, input.requestId);
  if (!q) return { ok: false, error: "Pengajuan tak ditemukan di unit ini — muat ulang halaman." };
  if (q.status !== "menunggu") return { ok: false, error: PESAN_BALIK.bukanMenunggu };
  if (q.requestedBy === aktor.userId) return { ok: false, error: PESAN_BALIK.diriSendiri };
  if (input.catatan.trim().length < 5) return { ok: false, error: PESAN_BALIK.catatan };
  const u = await c.query(
    `UPDATE app.correction_request
        SET status = 'ditolak', decided_by_user_id = $2, decided_at = now(), catatan_keputusan = $3
      WHERE id = $1::uuid AND status = 'menunggu'
      RETURNING id`,
    [input.requestId, aktor.userId, input.catatan.trim()],
  );
  if (u.rowCount !== 1) return { ok: false, error: PESAN_BALIK.bukanMenunggu };
  await auditKeuangan(c, aktor, "correction_request.tolak", input.requestId, { unitId });
  return { ok: true, businessDate: q.businessDate, requestId: input.requestId };
}

/**
 * Setujui: tulis SATU `correction_entry` reversal (tujuh field audit 0021),
 * lalu tandai pengajuan disetujui dengan tautannya. Baris asli tak disentuh.
 * Fakta baris dibaca ulang di bawah kunci: bila sejak diajukan baris sudah
 * void/dibalik atau bulannya ditutup, persetujuan ditolak.
 */
export async function setujuiBalik(
  c: PoolClient,
  unitId: ScopedUnitId,
  aktor: Aktor,
  input: { requestId: string },
): Promise<HasilBalik> {
  const q = await kunciPengajuan(c, unitId, input.requestId);
  if (!q) return { ok: false, error: "Pengajuan tak ditemukan di unit ini — muat ulang halaman." };
  if (q.status !== "menunggu") return { ok: false, error: PESAN_BALIK.bukanMenunggu };
  if (q.requestedBy === aktor.userId) return { ok: false, error: PESAN_BALIK.diriSendiri };
  const b = await faktaBalik(c, unitId, q.entryId);
  if (!b) return { ok: false, error: "Baris tak ditemukan di unit ini — muat ulang halaman." };
  if (b.void) return { ok: false, error: PESAN_BALIK.sudahBatal };
  if (b.dibalik) return { ok: false, error: PESAN_BALIK.sudahDibalik };
  if (b.bulanTutup) return { ok: false, error: PESAN_BALIK.bulanTutup };
  if (!b.hariTutup) return { ok: false, error: PESAN_BALIK.hariTerbuka };

  const ce = await c.query<{ id: string }>(
    `INSERT INTO app.correction_entry
       (unit_id, source_kind, original_txn_id, reason_code, value_before, value_after,
        submitted_by_user_id, approved_by_user_id, approved_at, evidence_ref, kind)
     VALUES ($1, 'manual_entry', $2::uuid, $3, $4::numeric, 0, $5, $6, now(), $7, 'reversal')
     RETURNING id::text`,
    [unitId, q.entryId, q.reasonCode, q.valueBefore, q.requestedBy, aktor.userId, `correction_request:${input.requestId}`],
  );
  const ceId = ce.rows[0]!.id;
  const u = await c.query(
    `UPDATE app.correction_request
        SET status = 'disetujui', decided_by_user_id = $2, decided_at = now(), correction_entry_id = $3::uuid
      WHERE id = $1::uuid AND status = 'menunggu'
      RETURNING id`,
    [input.requestId, aktor.userId, ceId],
  );
  // Pengaman: FOR UPDATE di atas membuat ini mustahil; bila terjadi juga,
  // LEMPAR supaya pemanggil me-ROLLBACK reversal yang baru ditulis.
  if (u.rowCount !== 1) throw new Error(PESAN_BALIK.bukanMenunggu);
  await auditKeuangan(c, aktor, "correction_request.setujui", input.requestId, {
    unitId,
    entryId: q.entryId,
    correctionEntryId: ceId,
    businessDate: b.businessDate,
  });
  return { ok: true, businessDate: b.businessDate, requestId: input.requestId };
}
