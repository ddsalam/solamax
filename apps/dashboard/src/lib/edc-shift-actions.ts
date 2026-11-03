"use server";

import { bentukJurnalSesudahTulis } from "./buku-besar-tulis";
import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { vonisCekSlip, type VonisCekSlip } from "./edc-shift-model";
import { brutoSekarang, postingPenjualanEdc } from "./edc-shift-tulis";
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
 *
 * Rencana K6 U6 (R15, R16, KTD7): pembukuannya hidup di `edc-shift-tulis.ts`
 * dan dipanggil DUA jalur — `cekSlipEdc` (otomatis bila slip = EasyMax dan
 * kunci itu tak pernah tercatat beda) dan `setujuiPenjualanEdc` (Finance,
 * untuk yang ditahan).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type EdcShiftResult =
  | {
      ok: true;
      n?: number;
      /** Hanya `cekSlipEdc`: hasil yang dilihat pengawas (R15, R16). */
      posting?: VonisCekSlip;
      /** Ditahan karena penjaga inti tulis (hari tertutup, akun belum ada, …) — bukan karena slip. */
      alasanTahan?: string;
    }
  | { ok: false; error: string };

/**
 * KTD7 — SEMUA cek untuk kunci yang sama, TERMASUK yang sudah dibatalkan:
 * cek ulang tidak menghapus jejak bahwa kunci ini pernah tercatat beda.
 */
const SQL_RIWAYAT_CEK = `SELECT k.slip_rp::float8 AS "slipRp", k.easymax_rp::float8 AS "easymaxRp"
         FROM app.edc_shift_cek k
        WHERE k.unit_id = $1 AND k.business_date = $2::date AND k.cshift = $3 AND k.acquirer = $4`;

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
    revalidatePath(`/keuangan/unit/${unit.code}/edc`);
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
    const bruto = await brutoSekarang(client, unit.unit_id, input.date, input.cshift, input.acquirer);
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
        error:
          "Shift ini sudah terposting ke EDC Penampungan. Bila perlu dicocokkan ulang, minta Keuangan membatalkan " +
          "baris Penjualan EDC-nya di Buku Kas dulu.",
      };
    }
    const riwayat = await client.query<{ slipRp: number; easymaxRp: number }>(SQL_RIWAYAT_CEK, [
      unit.unit_id,
      input.date,
      input.cshift,
      input.acquirer,
    ]);
    // Mencocokkan ulang = batalkan cek lama, tulis yang baru. Riwayat tetap utuh.
    if (aktif.rows[0]) {
      await client.query(
        `UPDATE app.edc_shift_cek SET void = true, voided_by_user_id = $1, voided_at = now()
          WHERE id = $2::uuid AND unit_id = $3 AND NOT void`,
        [scope.userId, aktif.rows[0].id, unit.unit_id],
      );
    }
    const baru = await client.query<{ id: string }>(
      `INSERT INTO app.edc_shift_cek
         (unit_id, business_date, cshift, acquirer, easymax_rp, slip_rp, catatan, checked_by_user_id)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8)
       RETURNING id::text AS id`,
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
    // R15/R16/KTD7 — slip = EasyMax dan kunci ini tak pernah tercatat beda ⇒
    // langsung terposting, dalam transaksi yang sama dengan ceknya. Penjaga inti
    // tulis yang menolak (hari tertutup, akun belum ada) TIDAK membatalkan cek:
    // ceknya tersimpan dan shift itu ditahan untuk Finance, dengan alasannya.
    let posting: VonisCekSlip = vonisCekSlip({ slipRp: input.slipRp, easymaxRp: bruto, riwayat: riwayat.rows });
    let alasanTahan: string | undefined;
    if (posting === "terposting") {
      const p = await postingPenjualanEdc(client, {
        unitId: unit.unit_id,
        date: input.date,
        cekId: baru.rows[0]?.id ?? "",
        aktorId: scope.userId,
        reasonCode: null,
      });
      if (!p.ok) {
        posting = "ditahan";
        alasanTahan = p.error;
      }
    }
    await bentukJurnalSesudahTulis(client, unit.unit_id, { userId: scope.userId, email: scope.email });
    await client.query("COMMIT");
    revalidatePath(`/unit/${unit.code}/rincian/${input.date}`);
    revalidatePath(`/keuangan/unit/${unit.code}/${input.date}/input`);
    return alasanTahan === undefined ? { ok: true, posting } : { ok: true, posting, alasanTahan };
  } catch (e) {
    return gagal(client, e, "Gagal menyimpan cek slip.");
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// 3 · Keputusan Keuangan untuk yang DITAHAN → Debet EDC Penampungan
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

    let n = 0;
    for (const p of input.pilihan) {
      const r = await client.query<{ cshift: string; acquirer: string; checkedByUserId: number }>(
        `SELECT k.cshift, k.acquirer, k.checked_by_user_id AS "checkedByUserId"
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
      // ⛔ Yang mencocokkan tidak menyetujui cek yang sama (§10.25). Hanya di
      // jalur ini: posting otomatis bukan persetujuan siapa pun (R15).
      if (k.checkedByUserId === scope.userId) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          error: `Shift ${k.cshift} ${k.acquirer} dicocokkan oleh akun Anda sendiri — persetujuannya harus orang lain.`,
        };
      }
      const hasil = await postingPenjualanEdc(client, {
        unitId: unit.unit_id,
        date: input.date,
        cekId: p.cekId,
        aktorId: scope.userId,
        reasonCode: p.reasonCode,
        dorongMaju: true,
      });
      if (!hasil.ok) {
        await client.query("ROLLBACK");
        return { ok: false, error: hasil.error };
      }
      if (hasil.posting === "baru") n += 1; // idempoten: yang sudah terposting tidak dihitung
    }
    await bentukJurnalSesudahTulis(client, unit.unit_id, { userId: scope.userId, email: scope.email });
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
