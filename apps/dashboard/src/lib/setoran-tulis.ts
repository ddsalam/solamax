import type { PoolClient } from "pg";
import { hariBukuTerkunci } from "./hari-buku-queries";
import { NAMA_BAKU } from "./keuangan-akun-model";
import type { ScopedUnitId } from "./scope";

/**
 * Inti TULIS setoran tunai pengawas → Debet Kas Besar (rencana K6 U5 — R14,
 * R17, AE1, AE4, F1, KTD6; Key Decision "setoran pengawas selalu masuk Kas
 * Besar"). Dipanggil DI DALAM transaksi pemanggil, sesudah
 * `set_config('app.unit_ids', …, true)`. Pemanggil: `addManualEntry` dan
 * `voidManualEntry` (seksi `setoran_tunai`). Tanpa gerbang wewenang —
 * gerbangnya (`requireUnit`) milik server action.
 *
 * ⚠️ Sengaja BUKAN berkas "use server" (pola `edc-shift-tulis.ts`,
 * `klasifikasi-tulis.ts`): setiap ekspor berkas seperti itu menjadi endpoint
 * peramban — termasuk fungsi tanpa gerbang di bawah.
 *
 * ⛔ Yang dijaga di sini:
 *   1. Tujuan SELALU satu-satunya akun aktif `kind='kas'` bernama "Kas Besar".
 *      Tak ada → tolak, tak ada yang ditulis (setoran pun tidak).
 *   2. Nominal baris kas = nominal setoran YANG TERSIMPAN (dibaca dari
 *      `RETURNING` / baca ulang), bukan angka kedua dari client.
 *   3. Selalu lewat `hariBukuTerkunci` (KTD6), SEBELUM setoran ditulis — kunci
 *      hari dipegang dulu supaya `tutupHari` yang bersamaan menunggu dan ikut
 *      menghitung setoran ini. Hari tertutup TIDAK didorong maju: belum ada kode
 *      `ADJ-FWD-*` untuk setoran, dan 0027 menolak setoran baru di hari itu.
 *      Pra-cut-over: setoran tersimpan, TIDAK dibukukan (R22 — sudah termuat di
 *      saldo pembuka).
 *   4. Idempoten lewat indeks unik parsial 0033 + `ON CONFLICT DO NOTHING`.
 */

export const PESAN_TANPA_KAS_BESAR =
  "Unit ini belum punya akun Kas Besar aktif, jadi setoran belum bisa disimpan. " +
  "Minta Keuangan mendaftarkan akun \"Kas Besar\" di Kelola akun kas.";

export const PESAN_SETORAN_DICOCOKKAN =
  "Setoran ini sudah dicocokkan dengan rekening koran — minta Head of Finance membatalkan cocoknya dulu " +
  "(Impor rekening koran), baru setoran bisa dibatalkan.";

const KATEGORI = "Setoran Hasil Penjualan";

type Siap =
  | { ok: true; akunId: string; hariBuku: string | null }
  | { ok: false; error: string };

/** Akun tujuan + hari buku terkunci. `hariBuku = null` ⇒ pra-cut-over (tak dibukukan). */
async function siapkan(c: PoolClient, unitId: ScopedUnitId, tanggal: string): Promise<Siap> {
  const akun = await c.query<{ id: string }>(
    `SELECT a.id::text AS id
       FROM app.cash_account a
      WHERE a.unit_id = $1 AND a.kind = 'kas' AND a.active AND a.nama = $2`,
    [unitId, NAMA_BAKU.kas],
  );
  const tujuan = akun.rows[0];
  if (!tujuan) return { ok: false, error: PESAN_TANPA_KAS_BESAR };

  const hari = await hariBukuTerkunci(c, unitId, tanggal, { accountId: tujuan.id });
  if (hari.status === "pra-cut-over") return { ok: true, akunId: tujuan.id, hariBuku: null };
  if (hari.perluKodeAlasan) {
    return {
      ok: false,
      error: `Hari ${tanggal} sudah ditutup — setoran tidak bisa ditambahkan ke hari itu. Hubungi Head of Finance.`,
    };
  }
  return { ok: true, akunId: tujuan.id, hariBuku: hari.hariBuku };
}

type HasilBaris = { ok: true; posting: "baru" | "sudah_ada" };

async function tulisBarisKas(
  c: PoolClient,
  m: { unitId: ScopedUnitId; akunId: string; hariBuku: string; entri: { id: string; keterangan: string; amount: string }; aktorId: number },
): Promise<HasilBaris> {
  // Bentuk INSERT sama dengan `setujuiSetoran` (kas-actions.ts): kategori
  // dikunci, sisi debet, tertaut lewat `source_manual_entry_id`.
  const ins = await c.query<{ id: string }>(
    `INSERT INTO app.cash_ledger
       (unit_id, account_id, business_date, keterangan, jenis,
        category_side, category_label, amount, created_by_user_id,
        source_manual_entry_id)
     VALUES ($1,$2::uuid,$3::date,$4,'debet','debet','${KATEGORI}',$5,$6,$7::uuid)
     ON CONFLICT ("source_manual_entry_id") WHERE "source_manual_entry_id" IS NOT NULL AND NOT "void"
     DO NOTHING
     RETURNING id::text AS id`,
    [m.unitId, m.akunId, m.hariBuku, m.entri.keterangan, m.entri.amount, m.aktorId, m.entri.id],
  );
  return { ok: true, posting: ins.rows.length > 0 ? "baru" : "sudah_ada" };
}

export type HasilSetoran =
  | { ok: true; posting: "baru" | "sudah_ada" | "pra_cut_over" }
  | { ok: false; error: string };

/**
 * Simpan SATU baris setoran tunai pengawas dan bukukan ke Kas Besar — satu
 * transaksi (milik pemanggil). Penolakan dikembalikan SEBELUM apa pun ditulis.
 */
export async function simpanSetoranTunai(
  c: PoolClient,
  m: { unitId: ScopedUnitId; date: string; keterangan: string; amount: number; aktorId: number },
): Promise<HasilSetoran> {
  const siap = await siapkan(c, m.unitId, m.date);
  if (!siap.ok) return siap;

  // `urut` = ordering berikutnya per (unit, tanggal, seksi) — sama dengan jalur
  // seksi lain di `addManualEntry`; BUKAN unique (input manusia, ADR-001).
  const ins = await c.query<{ id: string; keterangan: string; amount: string }>(
    `INSERT INTO app.manual_entry
       (unit_id, business_date, section, urut, keterangan, amount, created_by_user_id)
     VALUES ($1, $2::date, 'setoran_tunai'::app.manual_entry_section,
       (SELECT COALESCE(MAX(urut),-1)+1 FROM app.manual_entry
         WHERE unit_id=$1 AND business_date=$2::date AND section='setoran_tunai'::app.manual_entry_section),
       $3, $4, $5)
     RETURNING id::text AS id, keterangan, amount::text AS amount`,
    [m.unitId, m.date, m.keterangan, m.amount, m.aktorId],
  );
  const entri = ins.rows[0];
  if (!entri) throw new Error("simpanSetoranTunai: INSERT manual_entry tak mengembalikan baris.");
  if (siap.hariBuku === null) return { ok: true, posting: "pra_cut_over" };
  return tulisBarisKas(c, { unitId: m.unitId, akunId: siap.akunId, hariBuku: siap.hariBuku, entri, aktorId: m.aktorId });
}

/**
 * Bukukan setoran yang SUDAH tersimpan (baca ulang dari `manual_entry`).
 * Idempoten: setoran yang sudah punya baris kas aktif tidak dibukukan lagi.
 */
export async function postingSetoran(
  c: PoolClient,
  m: { unitId: ScopedUnitId; manualEntryId: string; aktorId: number },
): Promise<HasilSetoran> {
  const r = await c.query<{ id: string; tanggal: string; keterangan: string; amount: string }>(
    `SELECT id::text AS id, to_char(business_date, 'YYYY-MM-DD') AS tanggal, keterangan, amount::text AS amount
       FROM app.manual_entry
      WHERE id = $1::uuid AND unit_id = $2
        AND section = 'setoran_tunai'::app.manual_entry_section AND NOT void
      FOR UPDATE`,
    [m.manualEntryId, m.unitId],
  );
  const entri = r.rows[0];
  if (!entri) return { ok: false, error: "Setoran tak ditemukan lagi — muat ulang halaman." };
  const siap = await siapkan(c, m.unitId, entri.tanggal);
  if (!siap.ok) return siap;
  if (siap.hariBuku === null) return { ok: true, posting: "pra_cut_over" };
  return tulisBarisKas(c, { unitId: m.unitId, akunId: siap.akunId, hariBuku: siap.hariBuku, entri, aktorId: m.aktorId });
}

/**
 * R17 — pembatalan setoran ikut membatalkan baris kas aktif yang lahir
 * darinya (arah kebalikan cascade 0053 di `voidMutasiKas`). Baris kas di
 * kelompok cocok AKTIF menolak SELURUH pembatalan: Σ kelompoknya akan berhenti
 * Rp 0 sementara baris rekening korannya tetap tampak selesai — jalannya
 * "Batalkan cocok" (HoF, R31). Pemanggil wajib ROLLBACK bila `ok: false`.
 */
export async function batalkanKasSetoran(
  c: PoolClient,
  m: { unitId: ScopedUnitId; manualEntryId: string; aktorId: number },
): Promise<{ ok: true; n: number } | { ok: false; error: string }> {
  const cek = await c.query<{ id: string; dicocokkan: boolean }>(
    `SELECT l.id::text AS id,
            EXISTS (
              SELECT 1 FROM app.cocok_bank_baris b
               WHERE b.cash_ledger_id = l.id AND b.unit_id = l.unit_id AND b.aktif
            ) AS dicocokkan
       FROM app.cash_ledger l
      WHERE l.source_manual_entry_id = $1::uuid AND l.unit_id = $2 AND NOT l.void
      FOR UPDATE OF l`,
    [m.manualEntryId, m.unitId],
  );
  if (cek.rows.some((r) => r.dicocokkan)) return { ok: false, error: PESAN_SETORAN_DICOCOKKAN };
  if (cek.rows.length === 0) return { ok: true, n: 0 };
  const res = await c.query(
    `UPDATE app.cash_ledger
        SET void=true, voided_by_user_id=$1, voided_at=now()
      WHERE source_manual_entry_id=$2::uuid AND unit_id=$3 AND NOT void`,
    [m.aktorId, m.manualEntryId, m.unitId],
  );
  return { ok: true, n: res.rowCount ?? 0 };
}
