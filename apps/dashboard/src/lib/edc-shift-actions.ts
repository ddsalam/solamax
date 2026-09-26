"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { SQL_EDC_PER_SHIFT } from "./edc-shift-queries";
import { keteranganBuku, statusBaris, type CekSlip } from "./edc-shift-model";
import {
  alasanTakBolehInput,
  canCekSlipEdc,
  canPetakanKartuEdc,
  PESAN_TAK_BOLEH_INPUT,
} from "./keuangan-wewenang";
import { getDataScope, type ScopedUnit } from "./scope";

/**
 * Server action alur EDC per shift → EDC Penampungan (KEUANGAN-HARIAN §10.25).
 *
 * ⛔ Yang TIDAK pernah dipercaya dari browser: bruto EasyMax, acquirer sebuah
 * kode kartu, dan status cek. Semuanya dihitung ulang DI DALAM transaksi yang
 * menulis — nominal yang dibukukan adalah angka yang dibaca server saat itu,
 * bukan angka yang tampil di layar beberapa menit sebelumnya.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type EdcShiftResult = { ok: true; n?: number } | { ok: false; error: string };

async function mulai(client: PoolClient, unit: ScopedUnit): Promise<void> {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
}

async function gagal(client: PoolClient, e: unknown, pesan: string): Promise<EdcShiftResult> {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* abaikan */
  }
  return { ok: false, error: e instanceof Error ? e.message : pesan };
}

/** Bruto EasyMax SEKARANG untuk (tanggal, shift, acquirer) — lewat peta kartu. */
async function brutoSekarang(
  client: PoolClient,
  unit: ScopedUnit,
  date: string,
  cshift: string,
  acquirer: string,
): Promise<number> {
  const [rows, peta] = await Promise.all([
    client.query<{ cshift: string; ckdkartu: string; rp: number }>(SQL_EDC_PER_SHIFT, [unit.unit_id, date]),
    client.query<{ ckdkartu: string; acquirer: string }>(
      `SELECT ckdkartu, acquirer FROM app.edc_kartu_acquirer WHERE unit_id = $1`,
      [unit.unit_id],
    ),
  ]);
  const acq = new Map(peta.rows.map((p) => [p.ckdkartu, p.acquirer]));
  return rows.rows
    .filter((r) => r.cshift === cshift && acq.get(r.ckdkartu) === acquirer)
    .reduce((s, r) => s + Number(r.rp), 0);
}

// ---------------------------------------------------------------------------
// 1 · Peta kode kartu → bank
// ---------------------------------------------------------------------------

export async function simpanPetaKartu(input: {
  code: string;
  date: string;
  ckdkartu: string;
  acquirer: string;
}): Promise<EdcShiftResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  if (!canPetakanKartuEdc({ role: scope.role, email: scope.email })) {
    return {
      ok: false,
      error: "Peta kartu hanya bisa diisi Head of Finance, Direksi, super admin, atau pengawas unit ini.",
    };
  }
  const kode = input.ckdkartu.trim();
  const acquirer = input.acquirer.trim().replace(/\s+/g, " ").toUpperCase();
  if (kode === "") return { ok: false, error: "Kode kartu kosong." };
  if (acquirer === "") return { ok: false, error: "Nama bank wajib diisi, contoh BCA atau MANDIRI." };

  const client = await pool.connect();
  try {
    await mulai(client, unit);
    // Peta yang SUDAH dipakai cek aktif tidak boleh diganti diam-diam: cek itu
    // akan jadi basi, dan penggantian peta harus disadari, bukan kebetulan.
    const lama = await client.query<{ acquirer: string }>(
      `SELECT acquirer FROM app.edc_kartu_acquirer WHERE unit_id = $1 AND ckdkartu = $2 FOR UPDATE`,
      [unit.unit_id, kode],
    );
    await client.query(
      `INSERT INTO app.edc_kartu_acquirer (unit_id, ckdkartu, acquirer, updated_by_user_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (unit_id, ckdkartu)
       DO UPDATE SET acquirer = EXCLUDED.acquirer,
                     updated_by_user_id = EXCLUDED.updated_by_user_id,
                     updated_at = now()`,
      [unit.unit_id, kode, acquirer, scope.userId],
    );
    await client.query(
      `INSERT INTO app.audit_log (actor_user_id, action, target, detail) VALUES ($1, $2, $3, $4)`,
      [
        scope.userId,
        lama.rows[0] ? "edc_kartu.ganti" : "edc_kartu.tetapkan",
        `${unit.code}/${kode}`,
        JSON.stringify({ acquirer, sebelumnya: lama.rows[0]?.acquirer ?? null }),
      ],
    );
    await client.query("COMMIT");
    revalidatePath(`/unit/${unit.code}/rincian/${input.date}`);
    revalidatePath(`/keuangan/unit/${unit.code}/${input.date}/input`);
    return { ok: true };
  } catch (e) {
    return gagal(client, e, "Gagal menyimpan peta kartu.");
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// 2 · Cek slip oleh pengawas
// ---------------------------------------------------------------------------

export async function cekSlipEdc(input: {
  code: string;
  date: string;
  cshift: string;
  acquirer: string;
  slipRp: number;
  catatan?: string;
}): Promise<EdcShiftResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  if (!canCekSlipEdc({ role: scope.role, email: scope.email })) {
    return { ok: false, error: "Slip EDC dicocokkan oleh pengawas SPBU yang memegang slipnya." };
  }
  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };
  if (!Number.isFinite(input.slipRp) || input.slipRp < 0) {
    return { ok: false, error: "Total slip harus angka rupiah, nol atau lebih." };
  }

  const client = await pool.connect();
  try {
    await mulai(client, unit);
    const bruto = await brutoSekarang(client, unit, input.date, input.cshift, input.acquirer);
    if (bruto <= 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Tidak ada penjualan EDC untuk shift & bank ini di EasyMax." };
    }
    const aktif = await client.query<{ id: string; dibukukan: boolean }>(
      `SELECT k.id::text AS id,
              EXISTS (SELECT 1 FROM app.cash_ledger l WHERE l.edc_shift_cek_id = k.id AND NOT l.void) AS dibukukan
         FROM app.edc_shift_cek k
        WHERE k.unit_id = $1 AND k.business_date = $2::date AND k.cshift = $3 AND k.acquirer = $4
          AND NOT k.void
        FOR UPDATE`,
      [unit.unit_id, input.date, input.cshift, input.acquirer],
    );
    if (aktif.rows[0]?.dibukukan) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error: "Shift ini sudah dibukukan Keuangan. Minta Keuangan membatalkan barisnya dulu bila perlu dicocokkan ulang.",
      };
    }
    // Mencocokkan ulang = batalkan cek lama, tulis yang baru. Riwayat tetap utuh.
    if (aktif.rows[0]) {
      await client.query(
        `UPDATE app.edc_shift_cek SET void = true, voided_by_user_id = $1, voided_at = now()
          WHERE id = $2::uuid AND unit_id = $3 AND NOT void`,
        [scope.userId, aktif.rows[0].id, unit.unit_id],
      );
    }
    await client.query(
      `INSERT INTO app.edc_shift_cek
         (unit_id, business_date, cshift, acquirer, easymax_rp, slip_rp, catatan, checked_by_user_id)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8)`,
      [
        unit.unit_id,
        input.date,
        input.cshift,
        input.acquirer,
        bruto,
        input.slipRp,
        input.catatan?.trim() || null,
        scope.userId,
      ],
    );
    await client.query("COMMIT");
    revalidatePath(`/unit/${unit.code}/rincian/${input.date}`);
    return { ok: true };
  } catch (e) {
    return gagal(client, e, "Gagal menyimpan cek slip.");
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// 3 · Persetujuan Keuangan → Debet EDC Penampungan
// ---------------------------------------------------------------------------

export async function setujuiPenjualanEdc(input: {
  code: string;
  date: string;
  /** id cek → kode alasan (wajib untuk cek berselisih, abaikan untuk yang cocok). */
  pilihan: { cekId: string; reasonCode: string | null }[];
}): Promise<EdcShiftResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  const alasan = alasanTakBolehInput({ role: scope.role, email: scope.email });
  if (alasan !== null) return { ok: false, error: PESAN_TAK_BOLEH_INPUT[alasan] };
  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };
  if (input.pilihan.length === 0) return { ok: false, error: "Pilih sedikitnya satu shift." };

  const client = await pool.connect();
  try {
    await mulai(client, unit);

    const akun = await client.query<{ id: string; cutOver: string | null }>(
      `SELECT a.id::text AS id,
              (SELECT to_char(l.business_date,'YYYY-MM-DD') FROM app.cash_ledger l
                WHERE l.account_id = a.id AND l.saldo_awal AND NOT l.void) AS "cutOver"
         FROM app.cash_account a
        WHERE a.unit_id = $1 AND a.kind = 'edc_penampungan' AND a.active
        ORDER BY a.created_at
        LIMIT 1`,
      [unit.unit_id],
    );
    const tujuan = akun.rows[0];
    if (!tujuan) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error: "Unit ini belum punya akun EDC Penampungan aktif — daftarkan di Kelola akun kas.",
      };
    }
    if (tujuan.cutOver !== null && input.date < tujuan.cutOver) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error: `Tanggal ini mendahului saldo pembuka EDC Penampungan (${tujuan.cutOver}).`,
      };
    }

    const kode = await client.query<{ code: string }>(
      `SELECT code FROM app.reason_code WHERE applies_to = 'closing'`,
    );
    const kodeSah = new Set(kode.rows.map((r) => r.code));

    let n = 0;
    for (const p of input.pilihan) {
      const r = await client.query<{
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
        [p.cekId, unit.unit_id, input.date],
      );
      const k = r.rows[0];
      if (!k) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Sebagian cek tak ditemukan lagi — muat ulang halaman." };
      }
      // ⛔ Yang mencocokkan tidak menyetujui cek yang sama (§10.25).
      if (k.checkedByUserId === scope.userId) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          error: `Shift ${k.cshift} ${k.acquirer} dicocokkan oleh akun Anda sendiri — persetujuannya harus orang lain.`,
        };
      }
      const bruto = await brutoSekarang(client, unit, input.date, k.cshift, k.acquirer);
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
      if (status === "dibukukan") continue; // idempoten: dua klik tidak membukukan dua kali
      if (status === "berubah_sesudah_dicek") {
        await client.query("ROLLBACK");
        return {
          ok: false,
          error: `Data EasyMax shift ${k.cshift} ${k.acquirer} berubah sesudah dicocokkan pengawas — minta pengawas mencocokkan ulang.`,
        };
      }
      let reason: string | null = null;
      if (status === "selisih") {
        reason = p.reasonCode;
        if (reason === null || !kodeSah.has(reason)) {
          await client.query("ROLLBACK");
          return {
            ok: false,
            error: `Shift ${k.cshift} ${k.acquirer} berselisih dengan slip — pilih kode alasannya.`,
          };
        }
        await client.query(
          `UPDATE app.edc_shift_cek SET reason_code = $1, reason_applies_to = 'closing'
            WHERE id = $2::uuid AND unit_id = $3`,
          [reason, k.id, unit.unit_id],
        );
      }
      await client.query(
        `INSERT INTO app.cash_ledger
           (unit_id, account_id, business_date, keterangan, jenis,
            category_side, category_label, amount, created_by_user_id, edc_shift_cek_id)
         VALUES ($1, $2::uuid, $3::date, $4, 'debet', 'debet', 'Penjualan EDC', $5, $6, $7::uuid)`,
        [
          unit.unit_id,
          tujuan.id,
          input.date,
          keteranganBuku(input.date, k.cshift, k.acquirer),
          cek.easymaxRp,
          scope.userId,
          k.id,
        ],
      );
      n += 1;
    }
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/${input.date}/input`);
    revalidatePath(`/unit/${unit.code}/rincian/${input.date}`);
    return { ok: true, n };
  } catch (e) {
    return gagal(client, e, "Gagal menyetujui.");
  } finally {
    client.release();
  }
}
