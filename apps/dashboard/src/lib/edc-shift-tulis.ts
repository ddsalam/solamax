import type { PoolClient } from "pg";
import { SQL_EDC_PER_SHIFT } from "./edc-shift-queries";
import { keteranganBuku, statusBaris, type CekSlip } from "./edc-shift-model";
import { hariBukuTerkunci } from "./hari-buku-queries";
import type { ScopedUnitId } from "./scope";

/**
 * Inti TULIS posting penjualan EDC per shift → Debet EDC Penampungan (§10.25;
 * rencana K6 U6 — R15, R16, KTD6, KTD7). Dipanggil DI DALAM transaksi
 * pemanggil, sesudah `set_config('app.unit_ids', …, true)`. Dua pemanggil:
 * `cekSlipEdc` (posting otomatis saat slip = EasyMax) dan `setujuiPenjualanEdc`
 * (keputusan Finance untuk cek yang ditahan). Tanpa gerbang wewenang —
 * gerbangnya milik server action dan dijalankan SEBELUM BEGIN.
 *
 * ⚠️ Sengaja BUKAN berkas "use server" (pola `klasifikasi-tulis.ts`): setiap
 * ekspor berkas seperti itu menjadi endpoint peramban — termasuk fungsi tanpa
 * gerbang di bawah.
 *
 * ⛔ Yang dijaga di sini, untuk KEDUA jalur:
 *   1. Nominal = bruto EasyMax yang tersimpan di cek, dan bruto itu dihitung
 *      ULANG — cek yang basi ditolak.
 *   2. Idempoten: cek yang sudah punya baris buku aktif tidak dibukukan lagi
 *      (indeks unik 0043 menjadi pengaman kedua).
 *   3. Selalu lewat `hariBukuTerkunci` (KTD6). Hari yang sudah ditutup TIDAK
 *      didorong maju: belum ada kode `ADJ-FWD-*` untuk penjualan EDC, dan
 *      memakai kode jalur lain akan menyesatkan audit.
 */

/** Bruto EasyMax SEKARANG untuk (tanggal, shift, acquirer) — lewat peta kartu. */
export async function brutoSekarang(
  c: PoolClient,
  unitId: ScopedUnitId,
  date: string,
  cshift: string,
  acquirer: string,
): Promise<number> {
  const [rows, peta] = await Promise.all([
    c.query<{ cshift: string; ckdkartu: string; rp: number }>(SQL_EDC_PER_SHIFT, [unitId, date]),
    c.query<{ ckdkartu: string; acquirer: string }>(
      `SELECT ckdkartu, acquirer FROM app.edc_kartu_acquirer WHERE unit_id = $1`,
      [unitId],
    ),
  ]);
  const acq = new Map(peta.rows.map((p) => [p.ckdkartu, p.acquirer]));
  return rows.rows
    .filter((r) => r.cshift === cshift && acq.get(r.ckdkartu) === acquirer)
    .reduce((s, r) => s + Number(r.rp), 0);
}

export type HasilPostingEdc =
  | { ok: true; posting: "baru"; ledgerId: string }
  /** Sudah ada baris buku aktif untuk cek ini — tak ada yang ditulis. */
  | { ok: true; posting: "sudah_ada" }
  | { ok: false; error: string };

export async function postingPenjualanEdc(
  c: PoolClient,
  m: {
    unitId: ScopedUnitId;
    date: string;
    cekId: string;
    aktorId: number;
    /** Wajib (kode `closing`) bila slip ≠ EasyMax; diabaikan bila cocok. */
    reasonCode: string | null;
  },
): Promise<HasilPostingEdc> {
  const akun = await c.query<{ id: string }>(
    `SELECT a.id::text AS id
       FROM app.cash_account a
      WHERE a.unit_id = $1 AND a.kind = 'edc_penampungan' AND a.active
      ORDER BY a.created_at
      LIMIT 1`,
    [m.unitId],
  );
  const tujuan = akun.rows[0];
  if (!tujuan) {
    return { ok: false, error: "Unit ini belum punya akun EDC Penampungan aktif — daftarkan di Kelola akun kas." };
  }

  const r = await c.query<{
    id: string;
    cshift: string;
    acquirer: string;
    easymaxRp: string;
    slipRp: string;
    checkedByUserId: number;
    dibukukan: boolean;
  }>(
    `SELECT k.id::text AS id, k.cshift, k.acquirer,
            k.easymax_rp::text AS "easymaxRp", k.slip_rp::text AS "slipRp",
            k.checked_by_user_id AS "checkedByUserId",
            EXISTS (SELECT 1 FROM app.cash_ledger l WHERE l.edc_shift_cek_id = k.id AND NOT l.void) AS dibukukan
       FROM app.edc_shift_cek k
      WHERE k.id = $1::uuid AND k.unit_id = $2 AND k.business_date = $3::date AND NOT k.void
      FOR UPDATE`,
    [m.cekId, m.unitId, m.date],
  );
  const k = r.rows[0];
  if (!k) return { ok: false, error: "Sebagian cek tak ditemukan lagi — muat ulang halaman." };

  const bruto = await brutoSekarang(c, m.unitId, m.date, k.cshift, k.acquirer);
  const cek: CekSlip = {
    id: k.id,
    cshift: k.cshift,
    acquirer: k.acquirer,
    easymaxRp: Number(k.easymaxRp),
    slipRp: Number(k.slipRp),
    checkedByUserId: k.checkedByUserId,
    checkedByEmail: null,
    checkedAt: "",
    reasonCode: null,
    dibukukan: k.dibukukan,
    adaFoto: false,
  };
  const status = statusBaris(bruto, cek);
  if (status === "dibukukan") return { ok: true, posting: "sudah_ada" }; // dua klik / dua jalur: sekali saja
  if (status === "berubah_sesudah_dicek") {
    return {
      ok: false,
      error: `Data EasyMax shift ${k.cshift} ${k.acquirer} berubah sesudah dicocokkan pengawas — minta pengawas mencocokkan ulang.`,
    };
  }
  let reason: string | null = null;
  if (status === "selisih") {
    reason = m.reasonCode;
    const sah =
      reason !== null &&
      (await c.query(`SELECT code FROM app.reason_code WHERE applies_to = 'closing' AND code = $1`, [reason])).rows
        .length > 0;
    if (!sah) {
      return { ok: false, error: `Shift ${k.cshift} ${k.acquirer} berselisih dengan slip — pilih kode alasannya.` };
    }
  }

  const hari = await hariBukuTerkunci(c, m.unitId, m.date, { accountId: tujuan.id });
  if (hari.status === "pra-cut-over") {
    return { ok: false, error: `Tanggal ini mendahului saldo pembuka EDC Penampungan (${hari.cutOver}).` };
  }
  if (hari.perluKodeAlasan) {
    return {
      ok: false,
      error: `Hari ${m.date} sudah ditutup — penjualan EDC shift ${k.cshift} ${k.acquirer} tidak dibukukan ke hari lain. Hubungi Head of Finance.`,
    };
  }

  if (reason !== null) {
    await c.query(
      `UPDATE app.edc_shift_cek SET reason_code = $1, reason_applies_to = 'closing'
        WHERE id = $2::uuid AND unit_id = $3`,
      [reason, k.id, m.unitId],
    );
  }
  const ins = await c.query<{ id: string }>(
    `INSERT INTO app.cash_ledger
       (unit_id, account_id, business_date, keterangan, jenis,
        category_side, category_label, amount, created_by_user_id, edc_shift_cek_id)
     VALUES ($1, $2::uuid, $3::date, $4, 'debet', 'debet', 'Penjualan EDC', $5, $6, $7::uuid)
     RETURNING id::text AS id`,
    [
      m.unitId,
      tujuan.id,
      hari.hariBuku,
      keteranganBuku(m.date, k.cshift, k.acquirer),
      cek.easymaxRp,
      m.aktorId,
      k.id,
    ],
  );
  return { ok: true, posting: "baru", ledgerId: ins.rows[0]?.id ?? "?" };
}
