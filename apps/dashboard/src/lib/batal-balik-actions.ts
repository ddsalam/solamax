"use server";

import { revalidatePath } from "next/cache";
import { ajukanBalik, batalkanBarisFinance, setujuiBalik, tarikBalik, tolakBalik, type HasilBalik } from "./batal-balik-tulis";
import { bentukJurnalSesudahTulis } from "./buku-besar-tulis";
import { pool } from "./db";
import { canAjukanBalikBaris, canBatalkanBarisFinance, canSetujuiBalikBaris } from "./keuangan-wewenang";
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

// ---------------------------------------------------------------------------
// Balik hari tertutup (rencana 2026-11-07 U5; R8–R12)
// ---------------------------------------------------------------------------

type Pelaku = (
  c: import("pg").PoolClient,
  unitId: import("./scope").ScopedUnitId,
  aktor: { userId: number; email: string | null },
) => Promise<HasilBalik>;

/**
 * Satu transaksi Balik — dipanggil SESUDAH gerbang unit & wewenang lolos di aksi
 * pemanggil. Reversal yang disetujui memicu pembentukan ulang jurnal hari itu.
 */
async function jalankanBalik(
  unit: { unit_id: import("./scope").ScopedUnitId; code: string },
  date: string,
  aktor: { userId: number; email: string | null },
  pelaku: Pelaku,
): Promise<BatalResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const r = await pelaku(client, unit.unit_id, aktor);
    if (!r.ok) {
      await client.query("ROLLBACK");
      return r;
    }
    await bentukJurnalSesudahTulis(client, unit.unit_id, aktor);
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/${date}/input`);
    revalidatePath(`/keuangan/unit/${unit.code}/${r.businessDate}`);
    revalidatePath(`/keuangan/unit/${unit.code}/${r.businessDate}/tutup-hari`);
    revalidatePath("/keuangan/pemantauan");
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

const PESAN_AJU = "Pengajuan balik dilakukan tim Finance — staf Keuangan atau Head of Finance.";
const PESAN_PUTUS = "Balik disetujui/ditolak oleh Head of Finance, Direksi, atau super admin.";

export async function ajukanBalikBiaya(input: {
  code: string;
  date: string;
  entryId: string;
  reasonCode: string;
  alasan: string;
}): Promise<BatalResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  if (!canAjukanBalikBaris({ role: scope.role, email: scope.email })) return { ok: false, error: PESAN_AJU };
  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };
  return jalankanBalik(unit, input.date, { userId: scope.userId, email: scope.email }, (c, u, a) =>
    ajukanBalik(c, u, a, { entryId: input.entryId, reasonCode: input.reasonCode, alasan: input.alasan }),
  );
}

export async function tarikBalikBiaya(input: { code: string; date: string; requestId: string }): Promise<BatalResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  if (!canAjukanBalikBaris({ role: scope.role, email: scope.email })) return { ok: false, error: PESAN_AJU };
  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };
  return jalankanBalik(unit, input.date, { userId: scope.userId, email: scope.email }, (c, u, a) =>
    tarikBalik(c, u, a, { requestId: input.requestId }),
  );
}

export async function tolakBalikBiaya(input: {
  code: string;
  date: string;
  requestId: string;
  catatan: string;
}): Promise<BatalResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  if (!canSetujuiBalikBaris({ role: scope.role, email: scope.email })) return { ok: false, error: PESAN_PUTUS };
  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };
  return jalankanBalik(unit, input.date, { userId: scope.userId, email: scope.email }, (c, u, a) =>
    tolakBalik(c, u, a, { requestId: input.requestId, catatan: input.catatan }),
  );
}

export async function setujuiBalikBiaya(input: { code: string; date: string; requestId: string }): Promise<BatalResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  if (!canSetujuiBalikBaris({ role: scope.role, email: scope.email })) return { ok: false, error: PESAN_PUTUS };
  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };
  return jalankanBalik(unit, input.date, { userId: scope.userId, email: scope.email }, (c, u, a) =>
    setujuiBalik(c, u, a, { requestId: input.requestId }),
  );
}
