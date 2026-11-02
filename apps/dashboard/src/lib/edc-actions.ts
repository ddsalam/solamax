"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { normalisasiEdc } from "./edc-rekening-model";
import { hariBukuTerkunci } from "./hari-buku-queries";
import { validasiSettlement } from "./keuangan-edc";
import { auditKeuangan, batal } from "./keuangan-tx";
import { canKelolaSettlementEdc, PESAN_TAK_BOLEH_SETTLEMENT } from "./keuangan-wewenang";
import { getDataScope, type DataScope, type ScopedUnit } from "./scope";
import { UUID_RE } from "./validasi";

/**
 * Server action settlement EDC (Layar 3 blok 3).
 *
 * ⛔ EMPAT HAL YANG MENGIKAT (§10.5):
 *
 * 1. **MDR TIDAK DIKETIK.** Ia kolom `GENERATED ALWAYS AS (gross − net) STORED`
 *    di 0030 — Postgres yang menghitungnya. Tak ada satu pun parameter MDR di
 *    berkas ini, dan tak bisa ada.
 * 2. **Jurnal pencairan DITAWARKAN, bukan diposting** (§1.4). `setujuiPencairan`
 *    adalah satu-satunya jalan barisnya lahir, dan `posted_by/at` adalah jejak
 *    persetujuan itu — bukan penanda otomatis.
 * 3. **Nominalnya dibaca ulang di server** saat menyetujui, sama seperti tawaran
 *    setoran. Yang datang dari client hanyalah id batch.
 * 4. **Kaki ketiga (Beban MDR) mendarat di `app.noncash_expense`**, bukan
 *    `cash_ledger` dan bukan `manual_entry` — ia bukan akun kas, dan bukan
 *    sesuatu yang diketik manusia (§2.5). Ketiga kaki lahir dalam SATU
 *    transaksi: jurnal yang separuh mendarat lebih buruk daripada yang gagal.
 *
 * ⚖️ Keputusan owner 2 Nov 2026 (rencana 2026-11-02): siklus ini — simpan,
 * setujui, ubah, batalkan batch, batalkan pencairan — milik SELURUH tim
 * Finance, termasuk Head of Finance (`canKelolaSettlementEdc`). Membatalkan
 * pencairan membatalkan KETIGA kakinya sekaligus; tak ada jalan yang membatalkan
 * satu kaki saja (`voidMutasiKas` tetap menolak baris pencairan).
 */

export type EdcResult = { ok: true } | { ok: false; error: string };

/** Indeks unik 0030 `(unit, acquirer, nomor)` untuk batch aktif. */
function nomorDipakai(e: unknown): boolean {
  const g = e as { code?: string; constraint?: string } | null;
  return g?.code === "23505" && g.constraint === "edc_settlement_no_uq";
}
const PESAN_NOMOR_DIPAKAI = "Nomor settlement itu sudah dipakai batch lain untuk EDC yang sama.";

/** Hari buku tanggal settlement masih terbuka untuk kedua rekening kaki pencairan? */
async function hariTerbuka(
  client: PoolClient,
  unit: ScopedUnit,
  tanggal: string,
  akun: readonly string[],
): Promise<boolean> {
  for (const accountId of akun) {
    const h = await hariBukuTerkunci(client, unit.unit_id, tanggal, { accountId });
    // Pra-cut-over tak dinilai di sini: perilaku persetujuan lama dipertahankan.
    if (h.status === "dibukukan" && h.hariBuku !== tanggal) return false;
  }
  return true;
}

const pesanHariTertutup = (tanggal: string): string =>
  `Hari buku ${tanggal} sudah ditutup — pencairan pada tanggal itu tidak bisa diubah langsung. ` +
  "Koreksi untuk hari tertutup belum tersedia; hubungi Head of Finance.";

type Buka =
  | { boleh: false; error: string }
  | { boleh: true; scope: DataScope; unit: ScopedUnit };

async function buka(code: string): Promise<Buka> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(code); // di luar scope → notFound(), tak menulis
  if (!canKelolaSettlementEdc({ role: scope.role, email: scope.email })) return { boleh: false, error: PESAN_TAK_BOLEH_SETTLEMENT };
  return { boleh: true, scope, unit };
}

export interface SettlementInput {
  code: string;
  /** Tanggal halaman — untuk revalidate. */
  date: string;
  acquirer: string;
  settlementNo: string;
  /** Tanggal uang MASUK rekening (H+1). */
  settlementDate: string;
  /** Hari penjualan yang di-settle (H). */
  businessDate: string;
  toAccountId: string;
  grossRp: number;
  netRp: number;
  /** Total transaksi menurut `public.edc`; `null` = belum direkonsiliasi. */
  txnTotalRp: number | null;
  /** Wajib bila ada selisih transaksi vs bruto. */
  reasonCode: string | null;
}

export async function simpanSettlement(input: SettlementInput): Promise<EdcResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;

  const v = validasiSettlement(input);
  if (!v.ok) return { ok: false, error: v.error };
  const adaSelisih = v.adaSelisih;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    // ⛔ Tidak ada kolom mdr_rp di sini — ia GENERATED (0030).
    await client.query(
      `INSERT INTO app.edc_settlement
         (unit_id, acquirer, settlement_no, settlement_date, business_date,
          to_account_id, gross_rp, net_rp, txn_total_rp, reason_code, reason_applies_to,
          created_by_user_id)
       VALUES ($1,$2,$3,$4::date,$5::date,$6::uuid,$7,$8,$9,$10,$11,$12)`,
      [
        unit.unit_id,
        // §10.28 — ejaan tunggal nama EDC, sama dengan peta kartu & Pengaturan
        // EDC; tanpa ini "bca" dan "BCA" menjadi dua EDC di kontrol MDR%.
        normalisasiEdc(input.acquirer),
        input.settlementNo.trim(),
        input.settlementDate,
        input.businessDate,
        input.toAccountId,
        input.grossRp,
        input.netRp,
        input.txnTotalRp,
        adaSelisih ? input.reasonCode : null,
        adaSelisih ? "closing" : null,
        scope.userId,
      ],
    );
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/${input.date}/input`);
    return { ok: true };
  } catch (e) {
    await batal(client);
    if (nomorDipakai(e)) return { ok: false, error: PESAN_NOMOR_DIPAKAI };
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menyimpan." };
  } finally {
    client.release();
  }
}

/**
 * Setujui jurnal pencairan H+1 — tiga kaki, SATU transaksi:
 *
 * ```
 * Kas Bank (neto)              D  → app.cash_ledger
 * Beban MDR 7-1200             D  → app.noncash_expense   (bukan akun kas)
 *     EDC Penampungan (bruto)  K  → app.cash_ledger
 * ```
 *
 * Seluruh nominal dibaca ULANG dari `app.edc_settlement` di sini; yang datang
 * dari client hanyalah `settlementId`. MDR diambil dari kolom GENERATED, jadi
 * bahkan server pun tidak menghitungnya sendiri.
 */
export async function setujuiPencairan(input: {
  code: string;
  date: string;
  settlementId: string;
}): Promise<EdcResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    // FOR UPDATE: dua penyetuju yang menekan bersamaan tidak melahirkan dua
    // jurnal. `posted_at IS NULL` di WHERE membuat yang kedua tak menemukan apa
    // pun, bukan menimpa yang pertama.
    const s = await client.query<{
      id: string;
      acquirer: string;
      settlementDate: string;
      toAccountId: string;
      grossRp: string;
      netRp: string;
      mdrRp: string;
    }>(
      `SELECT id::text                              AS id,
              acquirer,
              to_char(settlement_date,'YYYY-MM-DD') AS "settlementDate",
              to_account_id::text                   AS "toAccountId",
              gross_rp::text                        AS "grossRp",
              net_rp::text                          AS "netRp",
              mdr_rp::text                          AS "mdrRp"
         FROM app.edc_settlement
        WHERE id = $1::uuid AND unit_id = $2 AND NOT void AND posted_at IS NULL
        FOR UPDATE`,
      [input.settlementId, unit.unit_id],
    );
    const row = s.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Batch sudah disetujui, dibatalkan, atau tak ditemukan." };
    }

    const akunPenampungan = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM app.cash_account
        WHERE unit_id = $1 AND kind = 'edc_penampungan' AND active
        LIMIT 1`,
      [unit.unit_id],
    );
    const penampungan = akunPenampungan.rows[0]?.id;
    if (!penampungan) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error: "Unit ini belum punya akun EDC Penampungan — daftarkan dulu rekeningnya.",
      };
    }

    // Rencana 2026-11-02 R6 — batal → ubah tanggal → setujui ulang tidak boleh
    // menulis jurnal ke buku yang sudah ditutup. Hari dikunci bersama sampai
    // COMMIT, jadi penutupan yang bersamaan menunggu.
    if (!(await hariTerbuka(client, unit, row.settlementDate, [row.toAccountId, penampungan]))) {
      await client.query("ROLLBACK");
      return { ok: false, error: pesanHariTertutup(row.settlementDate) };
    }

    const ket = `Pencairan EDC ${row.acquirer} ${row.settlementDate}`;

    // Kaki 1 — Kas Bank, neto masuk.
    await client.query(
      `INSERT INTO app.cash_ledger
         (unit_id, account_id, business_date, keterangan, jenis,
          category_side, category_label, amount, created_by_user_id, edc_settlement_id)
       VALUES ($1,$2::uuid,$3::date,$4,'debet','debet','Pindah Buku',$5,$6,$7::uuid)`,
      [unit.unit_id, row.toAccountId, row.settlementDate, ket, row.netRp, scope.userId, row.id],
    );
    // Kaki 3 — EDC Penampungan, bruto keluar.
    await client.query(
      `INSERT INTO app.cash_ledger
         (unit_id, account_id, business_date, keterangan, jenis,
          category_side, category_label, amount, created_by_user_id, edc_settlement_id)
       VALUES ($1,$2::uuid,$3::date,$4,'kredit','kredit','Pindah Buku',$5,$6,$7::uuid)`,
      [
        unit.unit_id,
        penampungan,
        row.settlementDate,
        ket,
        `-${row.grossRp}`,
        scope.userId,
        row.id,
      ],
    );
    // Kaki 2 — Beban MDR. BUKAN akun kas ⇒ rumahnya app.noncash_expense (§2.5).
    // MDR nol = tak ada potongan; baris beban nol bukan baris.
    if (Number(row.mdrRp) !== 0) {
      await client.query(
        `INSERT INTO app.noncash_expense
           (unit_id, business_date, accounting_account, amount_rp, keterangan,
            edc_settlement_id, posted_by_user_id)
         VALUES ($1,$2::date,'7-1200',$3,$4,$5::uuid,$6)`,
        [
          unit.unit_id,
          row.settlementDate,
          row.mdrRp,
          `${ket} — potongan MDR`,
          row.id,
          scope.userId,
        ],
      );
    }

    await client.query(
      `UPDATE app.edc_settlement
          SET posted_by_user_id=$1, posted_at=now()
        WHERE id=$2::uuid AND unit_id=$3`,
      [scope.userId, row.id, unit.unit_id],
    );
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/${input.date}/input`);
    return { ok: true };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menyetujui." };
  } finally {
    client.release();
  }
}

const revalidasi = (code: string, ...tanggal: string[]): void => {
  for (const t of new Set(tanggal)) revalidatePath(`/keuangan/unit/${code}/${t}/input`);
};

/**
 * UBAH batch yang BELUM dicairkan (rencana 2026-11-02 R7, KTD4). Batch yang
 * sudah dicairkan ditolak (R8): jurnalnya harus dibatalkan dulu, supaya angka
 * batch tidak pernah berbeda dari kaki-kaki yang sudah ada di buku.
 */
export async function ubahSettlement(input: SettlementInput & { id: string }): Promise<EdcResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;
  if (!UUID_RE.test(input.id)) return { ok: false, error: "Batch tak valid — muat ulang halaman." };

  const v = validasiSettlement(input);
  if (!v.ok) return { ok: false, error: v.error };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const lama = await client.query<{
      acquirer: string;
      settlementNo: string;
      settlementDate: string;
      businessDate: string;
      toAccountId: string;
      grossRp: string;
      netRp: string;
      txnTotalRp: string | null;
      reasonCode: string | null;
      posted: boolean;
    }>(
      `SELECT acquirer, settlement_no AS "settlementNo",
              to_char(settlement_date,'YYYY-MM-DD') AS "settlementDate",
              to_char(business_date,'YYYY-MM-DD')   AS "businessDate",
              to_account_id::text AS "toAccountId", gross_rp::text AS "grossRp",
              net_rp::text AS "netRp", txn_total_rp::text AS "txnTotalRp",
              reason_code AS "reasonCode", (posted_at IS NOT NULL) AS posted
         FROM app.edc_settlement
        WHERE id = $1::uuid AND unit_id = $2 AND NOT void
        FOR UPDATE`,
      [input.id, unit.unit_id],
    );
    const sebelum = lama.rows[0];
    if (!sebelum) {
      await batal(client);
      return { ok: false, error: "Batch sudah dibatalkan atau tak ditemukan — muat ulang halaman." };
    }
    if (sebelum.posted) {
      await batal(client);
      return {
        ok: false,
        error: "Batch ini sudah dicairkan. Batalkan pencairannya dulu, baru batch bisa diubah.",
      };
    }
    const sesudah = {
      acquirer: normalisasiEdc(input.acquirer),
      settlementNo: input.settlementNo.trim(),
      settlementDate: input.settlementDate,
      businessDate: input.businessDate,
      toAccountId: input.toAccountId,
      grossRp: input.grossRp,
      netRp: input.netRp,
      txnTotalRp: input.txnTotalRp,
      reasonCode: v.adaSelisih ? input.reasonCode : null,
    };
    // ⛔ Tidak ada kolom mdr_rp di sini — ia GENERATED (0030).
    await client.query(
      `UPDATE app.edc_settlement
          SET acquirer=$1, settlement_no=$2, settlement_date=$3::date, business_date=$4::date,
              to_account_id=$5::uuid, gross_rp=$6, net_rp=$7, txn_total_rp=$8,
              reason_code=$9, reason_applies_to=$10
        WHERE id=$11::uuid AND unit_id=$12 AND NOT void AND posted_at IS NULL`,
      [
        sesudah.acquirer,
        sesudah.settlementNo,
        sesudah.settlementDate,
        sesudah.businessDate,
        sesudah.toAccountId,
        sesudah.grossRp,
        sesudah.netRp,
        sesudah.txnTotalRp,
        sesudah.reasonCode,
        sesudah.reasonCode === null ? null : "closing",
        input.id,
        unit.unit_id,
      ],
    );
    await auditKeuangan(client, scope, "edc_settlement.ubah", `${unit.code}/${input.id}`, { sebelum, sesudah });
    await client.query("COMMIT");
    revalidasi(unit.code, input.date, sebelum.settlementDate, sesudah.settlementDate);
    return { ok: true };
  } catch (e) {
    await batal(client);
    if (nomorDipakai(e)) return { ok: false, error: PESAN_NOMOR_DIPAKAI };
    return { ok: false, error: e instanceof Error ? e.message : "Gagal mengubah batch." };
  } finally {
    client.release();
  }
}

/**
 * BATALKAN batch yang BELUM dicairkan (rencana 2026-11-02 R9, KTD5). Void,
 * bukan DELETE. Batch yang sudah dicairkan ditolak: pencairannya dibatalkan
 * dulu, sehingga pelaku melihat jurnalnya kembali menjadi usulan sebelum batch
 * hilang dari daftar.
 */
export async function batalkanSettlement(input: { code: string; date: string; id: string }): Promise<EdcResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;
  if (!UUID_RE.test(input.id)) return { ok: false, error: "Batch tak valid — muat ulang halaman." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const r = await client.query<{ posted: boolean; acquirer: string; settlementNo: string; settlementDate: string; grossRp: string }>(
      `SELECT (posted_at IS NOT NULL) AS posted, acquirer, settlement_no AS "settlementNo",
              to_char(settlement_date,'YYYY-MM-DD') AS "settlementDate", gross_rp::text AS "grossRp"
         FROM app.edc_settlement
        WHERE id = $1::uuid AND unit_id = $2 AND NOT void
        FOR UPDATE`,
      [input.id, unit.unit_id],
    );
    const b = r.rows[0];
    if (!b) {
      await batal(client);
      return { ok: false, error: "Batch sudah dibatalkan atau tak ditemukan — muat ulang halaman." };
    }
    if (b.posted) {
      await batal(client);
      return { ok: false, error: "Batch ini sudah dicairkan. Batalkan pencairannya dulu, baru batch bisa dibatalkan." };
    }
    await client.query(
      `UPDATE app.edc_settlement
          SET void=true, voided_by_user_id=$1, voided_at=now()
        WHERE id=$2::uuid AND unit_id=$3 AND NOT void AND posted_at IS NULL`,
      [scope.userId, input.id, unit.unit_id],
    );
    await auditKeuangan(client, scope, "edc_settlement.batal", `${unit.code}/${input.id}`, b);
    await client.query("COMMIT");
    revalidasi(unit.code, input.date, b.settlementDate);
    return { ok: true };
  } catch (e) {
    await batal(client);
    return { ok: false, error: e instanceof Error ? e.message : "Gagal membatalkan batch." };
  } finally {
    client.release();
  }
}

/**
 * BATALKAN PENCAIRAN (rencana 2026-11-02 R3, R5, R6, KTD2, KTD3) — kebalikan
 * `setujuiPencairan`, utuh dalam SATU transaksi:
 *
 *   kedua kaki `cash_ledger` + kaki MDR `noncash_expense` → void (bukan DELETE),
 *   lalu `posted_by/at` dikosongkan ⇒ batch kembali "menunggu persetujuan".
 *
 * Ketiga kaki di-void dengan `now()` transaksi yang sama — Pemantauan memakai
 * kesamaan `voided_at` itu untuk membaca pembatalan utuh sebagai SATU kejadian.
 *
 * ⛔ Ditolak bila sebuah kaki ada di kelompok cocok rekening koran yang aktif
 * (pembatalan cocok tetap milik HoF, R31) atau bila hari bukunya sudah ditutup
 * (koreksi maju belum dibangun). Persetujuan lama yang tertimpa saat batch
 * disetujui ulang disimpan di `audit_log.detail`.
 */
export async function batalkanPencairan(input: {
  code: string;
  date: string;
  settlementId: string;
}): Promise<EdcResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;
  if (!UUID_RE.test(input.settlementId)) return { ok: false, error: "Batch tak valid — muat ulang halaman." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const s = await client.query<{
      settlementDate: string;
      postedBy: number;
      postedAt: string;
      acquirer: string;
      settlementNo: string;
      grossRp: string;
      netRp: string;
      mdrRp: string;
    }>(
      `SELECT to_char(settlement_date,'YYYY-MM-DD') AS "settlementDate",
              posted_by_user_id AS "postedBy", posted_at::text AS "postedAt",
              acquirer, settlement_no AS "settlementNo",
              gross_rp::text AS "grossRp", net_rp::text AS "netRp", mdr_rp::text AS "mdrRp"
         FROM app.edc_settlement
        WHERE id = $1::uuid AND unit_id = $2 AND NOT void AND posted_at IS NOT NULL
        FOR UPDATE`,
      [input.settlementId, unit.unit_id],
    );
    const row = s.rows[0];
    if (!row) {
      await batal(client);
      return { ok: false, error: "Pencairan sudah dibatalkan, belum disetujui, atau tak ditemukan — muat ulang halaman." };
    }
    const kaki = await client.query<{ id: string; accountId: string; businessDate: string }>(
      `SELECT id::text AS id, account_id::text AS "accountId",
              to_char(business_date,'YYYY-MM-DD') AS "businessDate"
         FROM app.cash_ledger
        WHERE edc_settlement_id = $1::uuid AND unit_id = $2 AND NOT void
        FOR UPDATE`,
      [input.settlementId, unit.unit_id],
    );

    // R5 — kaki yang sudah dicocokkan dengan rekening koran tidak dibongkar dari
    // sini; pencocok mengunci baris kas yang sama, jadi cek ini tak bisa disalip.
    const cocok = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.cocok_bank_baris
        WHERE cash_ledger_id = ANY($1::uuid[]) AND unit_id = $2 AND aktif`,
      [kaki.rows.map((k) => k.id), unit.unit_id],
    );
    if ((cocok.rows[0]?.n ?? 0) > 0) {
      await batal(client);
      return {
        ok: false,
        error:
          "Baris pencairan ini sudah dicocokkan dengan rekening koran — minta Head of Finance membatalkan " +
          "cocoknya dulu (Impor rekening koran), baru pencairan bisa dibatalkan.",
      };
    }

    // R6 — hari buku tiap kaki harus masih terbuka; dikunci sampai COMMIT.
    for (const k of kaki.rows) {
      if (!(await hariTerbuka(client, unit, k.businessDate, [k.accountId]))) {
        await batal(client);
        return { ok: false, error: pesanHariTertutup(k.businessDate) };
      }
    }

    await client.query(
      `UPDATE app.cash_ledger
          SET void=true, voided_by_user_id=$1, voided_at=now()
        WHERE edc_settlement_id=$2::uuid AND unit_id=$3 AND NOT void`,
      [scope.userId, input.settlementId, unit.unit_id],
    );
    await client.query(
      `UPDATE app.noncash_expense
          SET void=true, voided_by_user_id=$1, voided_at=now()
        WHERE edc_settlement_id=$2::uuid AND unit_id=$3 AND NOT void`,
      [scope.userId, input.settlementId, unit.unit_id],
    );
    await client.query(
      `UPDATE app.edc_settlement
          SET posted_by_user_id=NULL, posted_at=NULL
        WHERE id=$1::uuid AND unit_id=$2 AND posted_at IS NOT NULL`,
      [input.settlementId, unit.unit_id],
    );
    await auditKeuangan(client, scope, "edc_settlement.batal_pencairan", `${unit.code}/${input.settlementId}`, {
      postedByLama: row.postedBy,
      postedAtLama: row.postedAt,
      kaki: kaki.rows.map((k) => k.id),
      acquirer: row.acquirer,
      settlementNo: row.settlementNo,
      grossRp: row.grossRp,
      netRp: row.netRp,
      mdrRp: row.mdrRp,
    });
    await client.query("COMMIT");
    revalidasi(unit.code, input.date, row.settlementDate);
    return { ok: true };
  } catch (e) {
    await batal(client);
    return { ok: false, error: e instanceof Error ? e.message : "Gagal membatalkan pencairan." };
  } finally {
    client.release();
  }
}
