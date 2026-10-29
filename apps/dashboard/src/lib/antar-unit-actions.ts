"use server";

import { revalidatePath } from "next/cache";
import { pool, qScoped } from "./db";
import { KODE_MAJU_PEMBALIK, periksaAntarUnit, type MasukanAntarUnit } from "./antar-unit-model";
import { tulisBalikPasangan, tulisPasanganAntarUnit } from "./antar-unit-tulis";
import {
  pesanTakBolehInput,
  canBalikPasanganAntarUnit,
  canCatatAntarUnit,
} from "./keuangan-wewenang";
import { getDataScope, type ScopedUnit } from "./scope";
import { batal } from "./keuangan-tx";
import { PREFIKS_KODE_MAJU } from "./keuangan-kode-maju";
import { UUID_RE } from "./validasi";

/**
 * Server action pasangan antar unit (rencana 2026-10-29 U4; R3, R30, R31;
 * KTD4). Tindakan BERNAMA:
 *
 *   · catat pinjaman/pengembalian/titipan antar unit → Keuangan (`canCatatAntarUnit`)
 *   · balik pasangan                                 → HoF (`canBalikPasanganAntarUnit`)
 *   · baca rekening unit lawan (untuk formulir)      → Keuangan
 *
 * ⛔ GERBANG DUA UNIT (Implementation Constraints; Key Decision "Pencatat
 * pinjaman lintas PT wajib berperan Keuangan di kedua unit"). Peran bersifat
 * GLOBAL per orang; jangkauan unit datang dari penugasan. Maka: predikat peran
 * + `scope.requireUnit` untuk KEDUA unit lolos SEBELUM `pool.connect()`; bila
 * salah satu gagal, tindakan ditolak UTUH — tak ada jalan "tulis sisi saya
 * saja". Transaksinya menyetel `app.unit_ids` ke kedua unit (dan hanya itu).
 *
 * ⛔ VOID/append-only: tak ada DELETE. Pembalikan = void (hari terbuka) atau
 * baris pembalik maju (hari tertutup), keduanya beraudit.
 */

export type AntarUnitResult = { ok: true; pesan?: string } | { ok: false; error: string };

const halaman = (code: string): string => `/keuangan/unit/${code}/pihak-lawan`;

const PESAN_DUA_UNIT =
  "Pinjaman antar unit menulis buku KEDUA unit, dan akun ini tidak berperan Keuangan di kedua unit — " +
  "ditolak utuh, tak ada sisi yang tertulis. Minta pengguna yang memegang kedua unit (atau super admin).";

// ---------------------------------------------------------------------------
// Catat pasangan (R3, R30)
// ---------------------------------------------------------------------------

export async function catatAntarUnit(input: MasukanAntarUnit): Promise<AntarUnitResult> {
  const scope = await getDataScope();
  const ctx = { role: scope.role, email: scope.email };
  if (!canCatatAntarUnit(ctx)) return { ok: false, error: pesanTakBolehInput(ctx) };

  const cek = periksaAntarUnit(input);
  if (!cek.ok) return { ok: false, error: cek.error };

  // Kedua unit harus dalam jangkauan — ditanya dulu supaya penolakannya
  // berpesan (bukan 404), lalu `requireUnit` menerbitkan ScopedUnit-nya.
  const dipegang = (code: string): boolean => scope.units.some((u) => u.code === code);
  if (!dipegang(input.pemberiCode) || !dipegang(input.penerimaCode)) {
    return { ok: false, error: PESAN_DUA_UNIT };
  }
  const pemberi = scope.requireUnit(input.pemberiCode);
  const penerima = scope.requireUnit(input.penerimaCode);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [`${pemberi.unit_id},${penerima.unit_id}`]);
    const hasil = await tulisPasanganAntarUnit(client, {
      pemberi: { unitId: pemberi.unit_id, code: pemberi.code, name: pemberi.name },
      penerima: { unitId: penerima.unit_id, code: penerima.code, name: penerima.name },
      pemberiAccountId: input.pemberiAccountId,
      penerimaAccountId: input.penerimaAccountId,
      nominalSen: cek.nominalSen,
      tanggal: input.tanggal,
      jenis: cek.jenis,
      catatan: cek.catatan,
      aktor: { userId: scope.userId, email: scope.email },
    });
    if (!hasil.ok) {
      await batal(client);
      return { ok: false, error: hasil.error };
    }
    await client.query("COMMIT");
    for (const u of [pemberi, penerima]) revalidatePath(halaman(u.code));
    const maju = hasil.kaki.filter((k) => k.maju);
    return {
      ok: true,
      pesan:
        `Tercatat di kedua buku (${pemberi.name} → ${penerima.name}).` +
        (maju.length > 0
          ? ` Hari ${input.tanggal} sudah ditutup di ${maju.map((k) => k.unit).join(", ")} — kakinya dibukukan ${maju.map((k) => k.hariBuku).join(", ")} dengan tanggal asal ${input.tanggal}.`
          : ""),
    };
  } catch (e) {
    await batal(client);
    return { ok: false, error: e instanceof Error ? e.message : "Gagal mencatat pasangan antar unit." };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Balik pasangan (R31)
// ---------------------------------------------------------------------------

export interface BalikInput {
  code: string;
  pasanganUuid: string;
  reasonCode: string;
  catatan: string;
}

export async function balikPasanganAntarUnit(input: BalikInput): Promise<AntarUnitResult> {
  const scope = await getDataScope();
  if (!canBalikPasanganAntarUnit({ role: scope.role, email: scope.email })) {
    return { ok: false, error: "Hanya Head of Finance yang boleh membalik pasangan antar unit." };
  }
  const unit = scope.requireUnit(input.code);
  if (!UUID_RE.test(input.pasanganUuid)) return { ok: false, error: "Pasangan tak dikenali — muat ulang halaman." };
  const catatan = input.catatan.trim();
  if (catatan === "") return { ok: false, error: "Catatan wajib diisi — tuliskan apa yang salah dari pasangan ini." };
  const reasonCode = input.reasonCode.trim();
  if (reasonCode === "" || reasonCode === KODE_MAJU_PEMBALIK || reasonCode.startsWith(PREFIKS_KODE_MAJU)) {
    return { ok: false, error: "Pilih kode alasan koreksi dari daftar (kode pembukuan maju diisi sistem)." };
  }

  // Unit lawan dibaca dulu dari kaki di unit ini — gerbang unit kedua harus
  // lolos SEBELUM transaksi tulis dibuka. Dibaca ULANG & dikunci di dalam
  // transaksi oleh `tulisBalikPasangan` (`rencanaBalik` menuntut kedua kaki
  // berada tepat di dua unit yang lolos gerbang).
  const [kaki] = await qScoped<{ lawanUnitId: number | null }>(
    unit.unit_id,
    `SELECT p.lawan_unit_id AS "lawanUnitId"
       FROM app.cash_ledger l
       JOIN app.pihak_lawan p ON p.id = l.pihak_lawan_id AND p.unit_id = l.unit_id
      WHERE l.unit_id = $1 AND l.pasangan_uuid = $2::uuid
      LIMIT 1`,
    [unit.unit_id, input.pasanganUuid],
  );
  if (!kaki || kaki.lawanUnitId === null) return { ok: false, error: "Pasangan tak ditemukan di unit ini — muat ulang halaman." };
  const kodeLawan = scope.units.find((u) => u.unit_id === kaki.lawanUnitId)?.code ?? null;
  if (kodeLawan === null) {
    return {
      ok: false,
      error:
        "Membalik pasangan menulis buku KEDUA unit, dan akun ini tidak memegang unit lawannya — " +
        "ditolak utuh, tak ada kaki yang dibalik.",
    };
  }
  const lawan: ScopedUnit = scope.requireUnit(kodeLawan);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [`${unit.unit_id},${lawan.unit_id}`]);
    const hasil = await tulisBalikPasangan(client, {
      unit: { unitId: unit.unit_id, code: unit.code, name: unit.name },
      lawan: { unitId: lawan.unit_id, code: lawan.code, name: lawan.name },
      pasanganUuid: input.pasanganUuid,
      reasonCode,
      catatan,
      aktor: { userId: scope.userId, email: scope.email },
    });
    if (!hasil.ok) {
      await batal(client);
      return { ok: false, error: hasil.error };
    }
    await client.query("COMMIT");
    for (const u of [unit, lawan]) revalidatePath(halaman(u.code));
    const maju = hasil.kaki.filter((k) => k.tindakan === "pembalik");
    return {
      ok: true,
      pesan:
        "Pasangan dibalik di kedua buku." +
        (maju.length > 0
          ? ` Hari kaki di ${maju.map((k) => k.unit).join(", ")} sudah ditutup — pembaliknya dibukukan ${maju.map((k) => k.hariBuku).join(", ")}.`
          : ""),
    };
  } catch (e) {
    await batal(client);
    return { ok: false, error: e instanceof Error ? e.message : "Gagal membalik pasangan." };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Rekening unit lawan untuk formulir — dibaca server, hanya unit dalam jangkauan
// ---------------------------------------------------------------------------

export type RekeningResult = { ok: true; rekening: { id: string; nama: string }[] } | { ok: false; error: string };

export async function rekeningAntarUnit(input: { code: string }): Promise<RekeningResult> {
  const scope = await getDataScope();
  const ctx = { role: scope.role, email: scope.email };
  if (!canCatatAntarUnit(ctx)) return { ok: false, error: pesanTakBolehInput(ctx) };
  if (!scope.units.some((u) => u.code === input.code)) {
    return { ok: false, error: "Anda tidak berperan Keuangan di unit ini." };
  }
  const unit = scope.requireUnit(input.code);
  const rekening = await qScoped<{ id: string; nama: string }>(
    unit.unit_id,
    `SELECT id::text AS id, nama
       FROM app.cash_account
      WHERE unit_id = $1 AND active
      ORDER BY kind, nama`,
    [unit.unit_id],
  );
  return { ok: true, rekening };
}
