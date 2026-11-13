"use server";

import type { PoolClient } from "pg";
import { revalidatePath } from "next/cache";
import { pool } from "./db";
import { canAturTermin, pesanTakBolehAturTermin } from "./keuangan-wewenang";
import { batal, type Aktor } from "./keuangan-tx";
import { getDataScope, type DataScope, type ScopedUnit } from "./scope";
import {
  cabutTerminPelanggan,
  normalKodePelanggan,
  periksaTerminHari,
  tulisTerminPelanggan,
  tulisTerminUnit,
  type HasilTulisTermin,
} from "./termin-tulis";

/**
 * Server action termin pembayaran (rencana 2026-11-13 U4; R14–R16; KTD6, KTD7,
 * KTD9). Tindakan BERNAMA (§2.3) — tak ada tombol Edit generik:
 *
 *   · tetapkan/ganti termin bawaan unit        → tim Finance (`canAturTermin`)
 *   · tetapkan/ganti pengecualian pelanggan    → tim Finance (`canAturTermin`)
 *   · hapus pengecualian pelanggan             → tim Finance (`canAturTermin`)
 *
 * Kerangka sama dengan `pihak-lawan-actions.ts`: `requireUnit → wewenang →
 * validasi → BEGIN → set_config → DML → audit_log → COMMIT → revalidatePath`.
 * Setiap gerbang & validasi menolak SEBELUM `pool.connect()`.
 *
 * ⛔ VOID/append-only: tak ada DELETE (`dashboard_app` di-REVOKE, 0064).
 * Mengubah = void + insert; menghapus pengecualian = void tanpa pengganti.
 *
 * ⛔ Satu unit per aksi: `app.unit_ids` transaksi hanya memuat unit yang lolos
 * `requireUnit`. Pengguna yang ter-scope ke satu unit tak bisa menulis termin
 * unit lain — ditolak `requireUnit` (notFound), dan bila itu terlewati, RLS
 * `unit_scope` 0064 menolak barisnya.
 *
 * `audit_log` ditulis inti tulis (`termin-tulis.ts`) di transaksi yang sama —
 * tepat SATU baris per perubahan yang berefek, NOL untuk nilai yang sama.
 */

export type TerminResult = { ok: true; pesan?: string } | { ok: false; error: string };

/**
 * Halaman yang membaca termin. `"layout"` pada rute daftar ikut menyegarkan
 * semua yang bersarang di bawahnya (rincian faktur, Atur termin); ringkasan
 * lintas SPBU disegarkan terpisah.
 */
function segarkan(code: string): void {
  revalidatePath(`/keuangan/unit/${code}/tagihan`, "layout");
  revalidatePath("/keuangan/tagihan");
}

type Buka = { boleh: false; error: string } | { boleh: true; scope: DataScope; unit: ScopedUnit };

/** requireUnit + predikat aksi — sebelum koneksi apa pun. */
async function buka(code: string): Promise<Buka> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(code); // di luar scope → notFound(), tak menulis
  if (!canAturTermin({ role: scope.role, email: scope.email })) {
    return { boleh: false, error: pesanTakBolehAturTermin() };
  }
  return { boleh: true, scope, unit };
}

/** BEGIN → set_config (SATU unit) → inti tulis → COMMIT; gagal/ditolak = ROLLBACK. */
async function jalankan(
  ctx: { scope: DataScope; unit: ScopedUnit },
  tulis: (
    client: PoolClient,
    dasar: { unit: { unitId: ScopedUnit["unit_id"]; code: string }; aktor: Aktor },
  ) => Promise<HasilTulisTermin>,
  pesan: (hasil: Extract<HasilTulisTermin, { ok: true }>) => string,
  pesanGagal: string,
): Promise<TerminResult> {
  const { scope, unit } = ctx;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const hasil = await tulis(client, {
      unit: { unitId: unit.unit_id, code: unit.code },
      aktor: { userId: scope.userId, email: scope.email },
    });
    if (!hasil.ok) {
      await batal(client);
      return { ok: false, error: hasil.error };
    }
    await client.query("COMMIT");
    if (hasil.berubah) segarkan(unit.code);
    return { ok: true, pesan: pesan(hasil) };
  } catch (e) {
    await batal(client);
    // Indeks unik parsial 0064: dua penyimpan PERTAMA bersamaan — tak ada baris
    // aktif untuk dikunci, jadi yang kedua jatuh di sini.
    if ((e as { code?: string }).code === "23505") {
      return { ok: false, error: "Termin berubah bersamaan — muat ulang halaman." };
    }
    // Teks galat basis data (nama tabel, constraint, isi baris) TIDAK dikirim ke
    // peramban: sebab lengkapnya hanya ke log server, seperti `admin-actions.ts`.
    console.error("[termin] aksi gagal:", { unit: unit.code, pesan: pesanGagal }, e);
    return { ok: false, error: `${pesanGagal} Coba lagi; bila berulang, hubungi tim IT.` };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Termin bawaan unit
// ---------------------------------------------------------------------------

export async function tetapkanTerminUnit(input: { code: string; terminHari: number }): Promise<TerminResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const salah = periksaTerminHari(input.terminHari);
  if (salah !== null) return { ok: false, error: salah };

  return jalankan(
    ctx,
    (client, dasar) => tulisTerminUnit(client, { ...dasar, terminHari: input.terminHari }),
    (h) =>
      h.berubah
        ? `Termin bawaan ${ctx.unit.name} tersimpan: ${h.terminHari} hari.`
        : `Termin bawaan sudah ${h.terminHari} hari — tak ada yang diubah.`,
    "Gagal menyimpan termin bawaan unit.",
  );
}

// ---------------------------------------------------------------------------
// Pengecualian per pelanggan
// ---------------------------------------------------------------------------

export async function tetapkanTerminPelanggan(input: {
  code: string;
  kodePelanggan: string;
  terminHari: number;
}): Promise<TerminResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const salah = periksaTerminHari(input.terminHari);
  if (salah !== null) return { ok: false, error: salah };
  const kode = normalKodePelanggan(input.kodePelanggan);
  if (kode === null) return { ok: false, error: "Kode pelanggan tak dikenali — muat ulang halaman." };

  return jalankan(
    ctx,
    (client, dasar) => tulisTerminPelanggan(client, { ...dasar, kodePelanggan: kode, terminHari: input.terminHari }),
    (h) =>
      h.berubah
        ? `Termin pelanggan ${kode} tersimpan: ${h.terminHari} hari.`
        : `Termin pelanggan ${kode} sudah ${h.terminHari} hari — tak ada yang diubah.`,
    "Gagal menyimpan termin pelanggan.",
  );
}

/** "Hapus pengecualian" — pelanggan kembali memakai termin bawaan unit. */
export async function hapusTerminPelanggan(input: { code: string; kodePelanggan: string }): Promise<TerminResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const kode = normalKodePelanggan(input.kodePelanggan);
  if (kode === null) return { ok: false, error: "Kode pelanggan tak dikenali — muat ulang halaman." };

  return jalankan(
    ctx,
    (client, dasar) => cabutTerminPelanggan(client, { ...dasar, kodePelanggan: kode }),
    () => `Pengecualian termin pelanggan ${kode} dihapus — kembali memakai termin bawaan unit.`,
    "Gagal menghapus pengecualian termin.",
  );
}
