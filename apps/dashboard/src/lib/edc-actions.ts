"use server";

import { revalidatePath } from "next/cache";
import { pool } from "./db";
import { alasanTakBolehInput, PESAN_TAK_BOLEH_INPUT } from "./keuangan-wewenang";
import { getDataScope, type DataScope, type ScopedUnit } from "./scope";

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
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type EdcResult = { ok: true } | { ok: false; error: string };

type Buka =
  | { boleh: false; error: string }
  | { boleh: true; scope: DataScope; unit: ScopedUnit };

async function buka(code: string): Promise<Buka> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(code); // di luar scope → notFound(), tak menulis
  const alasan = alasanTakBolehInput({ role: scope.role, email: scope.email });
  if (alasan !== null) return { boleh: false, error: PESAN_TAK_BOLEH_INPUT[alasan] };
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

  if (!DATE_RE.test(input.settlementDate) || !DATE_RE.test(input.businessDate)) {
    return { ok: false, error: "Tanggal tak valid." };
  }
  if (input.settlementDate < input.businessDate) {
    return { ok: false, error: "Uang tak mungkin masuk sebelum hari penjualannya." };
  }
  if (input.acquirer.trim() === "" || input.settlementNo.trim() === "") {
    return { ok: false, error: "Acquirer dan nomor settlement wajib diisi." };
  }
  if (!(input.grossRp > 0)) return { ok: false, error: "Bruto harus lebih besar dari nol." };
  if (!(input.netRp > 0 && input.netRp <= input.grossRp)) {
    return { ok: false, error: "Neto harus lebih besar dari nol dan tidak melebihi bruto." };
  }
  // Selisih transaksi vs settlement BERDIRI sebagai selisih ber-reason_code —
  // tidak dibulatkan hilang, dan tidak boleh lewat tanpa nama (§10.5).
  const adaSelisih = input.txnTotalRp !== null && input.txnTotalRp !== input.grossRp;
  if (adaSelisih && (input.reasonCode ?? "") === "") {
    return {
      ok: false,
      error:
        "Total transaksi berbeda dari bruto settlement. Selisih itu harus punya nama — " +
        "pilih kode alasannya, jangan dibiarkan hilang.",
    };
  }

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
        input.acquirer.trim(),
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
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
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
