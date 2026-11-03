"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { auditKeuangan, batal } from "./keuangan-tx";
import { canKelolaPos, PESAN_TAK_BOLEH_POS } from "./keuangan-wewenang";
import { todayWib } from "./periods";
import { periksaHapusPos, periksaPetaBaru, periksaSubPosBaru, type Pos, type RujukanPos } from "./pos-model";
import { barisKePos, SQL_DAFTAR_POS, SQL_RUJUKAN_POS } from "./pos-queries";
import { getDataScope, type DataScope, type ScopedUnit } from "./scope";
import { UUID_RE } from "./validasi";

/**
 * Server action daftar pos (rencana 2026-11-02 K6 U1; R4, R5). Tindakan
 * BERNAMA, seluruhnya milik **Head of Finance** (`canKelolaPos`):
 *
 *   · tambah sub-pos       → di bawah pos induk resmi (bukan 1110: sub-pos
 *                            bank lahir dari rekening, trigger 0056)
 *   · hapus sub-pos        → hanya sub-pos HoF tanpa rujukan
 *   · ubah peta kategori   → baris baru `category_account_map` berlaku mulai
 *                            HARI INI untuk SEMUA unit (bagan seragam B1);
 *                            baris lama tetap sebagai riwayat
 *
 * Kerangka sama dengan `pihak-lawan-actions.ts`: `requireUnit → wewenang →
 * validasi bentuk → BEGIN → set_config → baca ulang daftar di transaksi →
 * validasi murni → DML → audit_log → COMMIT → revalidatePath`.
 */

export type PosResult = { ok: true; pesan?: string } | { ok: false; error: string };

/** Semua halaman Daftar Pos — peta kategori berlaku lintas unit. */
const semuaHalamanPos = (): void => revalidatePath("/keuangan/unit/[code]/pos", "page");

type Buka = { boleh: false; error: string } | { boleh: true; scope: DataScope; unit: ScopedUnit };

/** requireUnit + `canKelolaPos` — sebelum koneksi apa pun. */
async function buka(code: string): Promise<Buka> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(code); // di luar scope → notFound(), tak menulis
  if (!canKelolaPos({ role: scope.role, email: scope.email })) return { boleh: false, error: PESAN_TAK_BOLEH_POS };
  return { boleh: true, scope, unit };
}

async function daftarDiTransaksi(c: PoolClient, unitId: number): Promise<Pos[]> {
  const r = await c.query(SQL_DAFTAR_POS, [unitId]);
  return (r.rows as Parameters<typeof barisKePos>[0][]).map(barisKePos);
}

function pesanGalat(e: unknown, cadangan: string): string {
  const code = (e as { code?: string }).code;
  if (code === "23505") return "Kode itu baru saja dipakai — muat ulang halaman.";
  // check_violation dari trigger/CHECK 0056 membawa kalimat yang terbaca.
  if (code === "23514" && e instanceof Error) return e.message;
  return e instanceof Error ? e.message : cadangan;
}

// ---------------------------------------------------------------------------
// Tambah sub-pos (R4)
// ---------------------------------------------------------------------------

export async function tambahSubPos(input: {
  code: string;
  kodeInduk: string;
  kode: string;
  nama: string;
}): Promise<PosResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;
  const kode = input.kode.trim();
  const nama = input.nama.trim();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const daftar = await daftarDiTransaksi(client, unit.unit_id);
    const salah = periksaSubPosBaru({ kodeInduk: input.kodeInduk, kode, nama }, daftar);
    if (salah !== null) {
      await client.query("ROLLBACK");
      return { ok: false, error: salah };
    }
    const r = await client.query<{ id: string }>(
      `INSERT INTO app.pos_unit (unit_id, kode, nama, kode_induk, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id::text AS id`,
      [unit.unit_id, kode, nama, input.kodeInduk, scope.userId],
    );
    await auditKeuangan(client, scope, "pos.sub_tambah", `${unit.code}/${kode}`, {
      unit: unit.code,
      id: r.rows[0]?.id ?? null,
      kode,
      nama,
      kodeInduk: input.kodeInduk,
    });
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/pos`);
    return { ok: true, pesan: `Sub-pos ${kode} ${nama} ditambahkan.` };
  } catch (e) {
    await batal(client);
    return { ok: false, error: pesanGalat(e, "Gagal menambah sub-pos.") };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Hapus sub-pos (R4: pos yang dirujuk tidak bisa dihapus)
// ---------------------------------------------------------------------------

export async function hapusSubPos(input: { code: string; id: string }): Promise<PosResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;
  if (!UUID_RE.test(input.id)) return { ok: false, error: "Sub-pos tak dikenali — muat ulang halaman." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    // Kunci barisnya dulu: rujukan dihitung terhadap sub-pos yang tak bisa
    // berubah sampai transaksi ini selesai.
    const kunci = await client.query<{ kode: string }>(
      `SELECT kode FROM app.pos_unit WHERE id = $1::uuid AND unit_id = $2 FOR UPDATE`,
      [input.id, unit.unit_id],
    );
    const kode = kunci.rows[0]?.kode;
    const pos = kode === undefined ? undefined : (await daftarDiTransaksi(client, unit.unit_id)).find((p) => p.id === input.id);
    if (kode === undefined || pos === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Sub-pos tidak ditemukan — mungkin sudah dihapus." };
    }
    const rujukan = (await client.query<RujukanPos>(SQL_RUJUKAN_POS, [unit.unit_id, kode])).rows[0]!;
    const salah = periksaHapusPos(pos, rujukan);
    if (salah !== null) {
      await client.query("ROLLBACK");
      return { ok: false, error: salah };
    }
    // Penjaga di WHERE juga: hanya sub-pos HoF (tanpa rekening) yang terhapus.
    const d = await client.query(
      `DELETE FROM app.pos_unit WHERE id = $1::uuid AND unit_id = $2 AND cash_account_id IS NULL`,
      [input.id, unit.unit_id],
    );
    if (d.rowCount !== 1) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Sub-pos ini tidak bisa dihapus." };
    }
    await auditKeuangan(client, scope, "pos.sub_hapus", `${unit.code}/${kode}`, {
      unit: unit.code,
      id: input.id,
      kode,
      nama: pos.nama,
    });
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/pos`);
    return { ok: true, pesan: `Sub-pos ${kode} dihapus.` };
  } catch (e) {
    await batal(client);
    return { ok: false, error: pesanGalat(e, "Gagal menghapus sub-pos.") };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Ubah peta kategori operasional → pos (R3, R4)
// ---------------------------------------------------------------------------

export async function ubahPetaKategori(input: {
  code: string;
  kategori: string;
  kodePos: string;
}): Promise<PosResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;
  const hariIni = todayWib();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const daftar = await daftarDiTransaksi(client, unit.unit_id);
    const kat = await client.query<{ kategori: string }>(
      `SELECT DISTINCT operational_category AS kategori FROM app.category_account_map`,
    );
    const salah = periksaPetaBaru(
      { kategori: input.kategori, kodePos: input.kodePos },
      daftar,
      kat.rows.map((r) => r.kategori),
    );
    if (salah !== null) {
      await client.query("ROLLBACK");
      return { ok: false, error: salah };
    }
    // Peta global yang berlaku hari ini — rumus pemilih yang sama dengan
    // penulis biaya (biaya-actions, klasifikasi-tulis), dibatasi ke baris global.
    const kini = await client.query<{ akun: string }>(
      `SELECT accounting_account AS akun
         FROM app.category_account_map
        WHERE unit_id IS NULL AND operational_category = $1 AND effective_from <= $2::date
        ORDER BY effective_from DESC
        LIMIT 1`,
      [input.kategori, hariIni],
    );
    const sebelum = kini.rows[0]?.akun ?? null;
    if (sebelum === input.kodePos) {
      await client.query("ROLLBACK");
      return { ok: false, error: `“${input.kategori}” sudah dipetakan ke pos ${input.kodePos}.` };
    }
    // Append-only: baris baru berlaku mulai hari ini. Perubahan kedua pada hari
    // yang sama menimpa baris hari ini saja (0056 Keputusan 6) — baris hari
    // sebelumnya tak tersentuh.
    await client.query(
      `INSERT INTO app.category_account_map
         (unit_id, operational_category, accounting_account, effective_from, created_by_user_id)
       VALUES (NULL, $1, $2, $3::date, $4)
       ON CONFLICT (COALESCE(unit_id, -1), operational_category, effective_from)
       DO UPDATE SET accounting_account = EXCLUDED.accounting_account,
                     created_by_user_id = EXCLUDED.created_by_user_id,
                     created_at = CURRENT_TIMESTAMP`,
      [input.kategori, input.kodePos, hariIni, scope.userId],
    );
    await auditKeuangan(client, scope, "pos.peta_ubah", input.kategori, {
      unit: unit.code,
      kategori: input.kategori,
      dari: sebelum,
      ke: input.kodePos,
      berlakuSejak: hariIni,
      cakupan: "semua unit",
    });
    await client.query("COMMIT");
    semuaHalamanPos();
    return {
      ok: true,
      pesan: `“${input.kategori}” kini dipetakan ke pos ${input.kodePos} untuk semua unit, mulai ${hariIni}.`,
    };
  } catch (e) {
    await batal(client);
    return { ok: false, error: pesanGalat(e, "Gagal mengubah peta kategori.") };
  } finally {
    client.release();
  }
}
