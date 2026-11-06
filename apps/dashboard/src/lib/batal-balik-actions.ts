"use server";

import { revalidatePath } from "next/cache";
import { batalkanBarisFinance } from "./batal-balik-tulis";
import { bentukJurnalSesudahTulis } from "./buku-besar-tulis";
import { pool } from "./db";
import { canBatalkanBarisFinance } from "./keuangan-wewenang";
import { getDataScope } from "./scope";

/**
 * Server action Batalkan baris biaya/pendapatan lain-lain pintu Finance
 * (rencana 2026-11-07 U3; R1–R4).
 *
 * ⛔ Gerbang di SERVER, bukan tombol yang disembunyikan: unit (`requireUnit`)
 * dan wewenang (`canBatalkanBarisFinance`) diperiksa SEBELUM koneksi dibuka;
 * asal-usul baris, tautan kas, hari & bulan tertutup diperiksa ulang di dalam
 * transaksi oleh `batalkanBarisFinance`. Tetap tak ada Edit (§2.3): Batalkan
 * hanya mem-void, dan baris yang di-void tetap terlihat beserta alasannya.
 */

export type BatalResult = { ok: true } | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function batalkanBiayaFinance(input: {
  code: string;
  /** Tanggal halaman — untuk revalidate. */
  date: string;
  entryId: string;
  reasonCode: string;
  alasan: string;
}): Promise<BatalResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code); // di luar scope → notFound(), tak menulis
  if (!canBatalkanBarisFinance({ role: scope.role, email: scope.email })) {
    return { ok: false, error: "Pembatalan dilakukan tim Finance — staf Keuangan atau Head of Finance." };
  }
  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };

  const aktor = { userId: scope.userId, email: scope.email };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const r = await batalkanBarisFinance(client, unit.unit_id, aktor, {
      entryId: input.entryId,
      reasonCode: input.reasonCode,
      alasan: input.alasan,
    });
    if (!r.ok) {
      await client.query("ROLLBACK");
      return r;
    }
    // KTD3 pemicu 1 — jurnal baris yang baru di-void terhapus (xmin baris ini).
    await bentukJurnalSesudahTulis(client, unit.unit_id, aktor);
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/${input.date}/input`);
    revalidatePath(`/keuangan/unit/${unit.code}/${input.date}`);
    revalidatePath("/keuangan/pemantauan");
    return { ok: true };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal membatalkan baris." };
  } finally {
    client.release();
  }
}
