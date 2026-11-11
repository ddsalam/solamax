"use server";

import { revalidatePath } from "next/cache";
import { bentukJurnalSesudahTulis } from "./buku-besar-tulis";
import { pool } from "./db";
import {
  PESAN_TAK_BOLEH_INPUT,
  alasanTakBolehInput,
  canJadikanTransfer,
  canJadikanTransferHariTutup,
  pesanTakBolehInput,
} from "./keuangan-wewenang";
import { batal } from "./keuangan-tx";
import { getDataScope, type DataScope, type ScopedUnit } from "./scope";
import { periksaMasukanTransfer } from "./transfer-kas-model";
import { galatKunciGanda, tulisBatalTransfer, tulisJadikanTransfer, tulisTransferKeBank } from "./transfer-kas-tulis";
import { UUID_RE } from "./validasi";

/**
 * Server action transfer Kas Besar → bank DUA KAKI (rencana 2026-11-11 U3/U6;
 * R1–R12, R16–R17; KTD3–KTD9). Tindakan BERNAMA:
 *
 *   · catat transfer      → mengetik: `canInputKeuangan` (lewat `alasanTakBolehInput`, §10.12)
 *   · batalkan transfer   → mengetik: `canInputKeuangan`
 *   · jadikan transfer    → klasifikasi: `canJadikanTransfer` (+ HoF/super admin
 *                           saja pada hari tertutup: `canJadikanTransferHariTutup`)
 *
 * Pola `kas-actions.ts`: gerbang → validasi → BEGIN → `set_config` transaction-
 * local → tulis (inti di `transfer-kas-tulis.ts`) → audit → pembentuk jurnal →
 * COMMIT. Kategori kedua kaki ditetapkan server (R4); dari klien hanya rekening
 * tujuan, nominal, keterangan, tanggal, dan kunci idempotensi.
 */

export type TransferResult =
  | { ok: true; pesan: string; sudahAda?: boolean; hariBuku?: string }
  | { ok: false; error: string };

type Buka = { boleh: false; error: string } | { boleh: true; scope: DataScope; unit: ScopedUnit };

/** Gerbang mengetik: unit ter-scope + `canInputKeuangan` (pola `kas-actions.ts`). */
async function buka(code: string): Promise<Buka> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  const alasan = alasanTakBolehInput({ role: scope.role, email: scope.email });
  if (alasan !== null) return { boleh: false, error: PESAN_TAK_BOLEH_INPUT[alasan] };
  return { boleh: true, scope, unit };
}

const halamanInput = (code: string, d: string): string => `/keuangan/unit/${code}/${d}/input`;
const halamanKoreksi = (code: string): string => `/keuangan/unit/${code}/koreksi-transfer`;
const rp = (sen: number): string =>
  (sen / 100).toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// Catat (R1–R9)
// ---------------------------------------------------------------------------

export interface TransferInput {
  code: string;
  /** Tanggal halaman. Hari bukunya ditentukan penjaga hari tertutup (KTD4). */
  date: string;
  bankAccountId: string;
  /** Rupiah POSITIF. Tandanya ditetapkan server per kaki. */
  amount: number;
  keterangan: string;
  /** UUID yang dibuat form saat dibuka — menjadi `transfer_uuid` (KTD5). */
  kunci: string;
}

export async function catatTransferKeBank(input: TransferInput): Promise<TransferResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;

  const cek = periksaMasukanTransfer({ amount: input.amount, keterangan: input.keterangan, tanggal: input.date, kunci: input.kunci });
  if (!cek.ok) return { ok: false, error: cek.error };
  if (!UUID_RE.test(input.bankAccountId)) return { ok: false, error: "Rekening tujuan tak valid." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const aktor = { userId: scope.userId, email: scope.email };
    const r = await tulisTransferKeBank(client, {
      unitId: unit.unit_id,
      unitCode: unit.code,
      aktor,
      tanggal: input.date,
      bankAccountId: input.bankAccountId,
      amount: input.amount,
      keterangan: input.keterangan,
      kunci: input.kunci,
    });
    if (!r.ok || r.sudahAda) {
      await batal(client);
      return r.ok ? { ok: true, sudahAda: true, pesan: "Transfer ini sudah tercatat — tidak ditulis dua kali." } : r;
    }
    await bentukJurnalSesudahTulis(client, unit.unit_id, aktor);
    await client.query("COMMIT");
    revalidatePath(halamanInput(unit.code, r.hariBuku));
    if (r.hariBuku !== input.date) revalidatePath(halamanInput(unit.code, input.date));
    return {
      ok: true,
      hariBuku: r.hariBuku,
      pesan:
        `Transfer tersimpan: Kas Besar −${rp(r.sen)}, ${r.namaBank} +${rp(r.sen)}.` +
        (r.hariBuku !== input.date ? ` Dibukukan di hari buku ${r.hariBuku} karena ${input.date} sudah tutup hari.` : ""),
    };
  } catch (e) {
    await batal(client);
    // Dua kiriman bersamaan dengan kunci sama: yang kedua menabrak indeks unik 0062.
    if (galatKunciGanda(e)) return { ok: true, sudahAda: true, pesan: "Transfer ini sudah tercatat — tidak ditulis dua kali." };
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menyimpan transfer." };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Batalkan (R10–R12, KTD6)
// ---------------------------------------------------------------------------

export async function batalkanTransfer(input: { code: string; date: string; transferUuid: string }): Promise<TransferResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;
  if (!UUID_RE.test(input.transferUuid)) return { ok: false, error: "Transfer tak valid — muat ulang halaman." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const aktor = { userId: scope.userId, email: scope.email };
    const r = await tulisBatalTransfer(client, { unitId: unit.unit_id, unitCode: unit.code, aktor, transferUuid: input.transferUuid });
    if (!r.ok) {
      await batal(client);
      return r;
    }
    await bentukJurnalSesudahTulis(client, unit.unit_id, aktor);
    await client.query("COMMIT");
    revalidatePath(halamanInput(unit.code, input.date));
    for (const h of r.hariBuku) if (h !== input.date) revalidatePath(halamanInput(unit.code, h));
    return { ok: true, pesan: "Kedua kaki transfer dibatalkan — tercatat, tidak dihapus." };
  } catch (e) {
    await batal(client);
    return { ok: false, error: e instanceof Error ? e.message : "Gagal membatalkan transfer." };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Jadikan transfer — koreksi baris lama (R15–R17, KTD7, KTD9)
// ---------------------------------------------------------------------------

export async function jadikanTransfer(input: {
  code: string;
  bankId: string;
  kasId: string;
  /** Wajib bila harinya sudah ditutup. */
  alasan?: string;
}): Promise<TransferResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  const ctx = { role: scope.role, email: scope.email };
  if (!canJadikanTransfer(ctx)) return { ok: false, error: pesanTakBolehInput(ctx) };
  if (!UUID_RE.test(input.bankId) || !UUID_RE.test(input.kasId)) {
    return { ok: false, error: "Baris tak valid — muat ulang halaman." };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const aktor = { userId: scope.userId, email: scope.email };
    const r = await tulisJadikanTransfer(client, {
      unitId: unit.unit_id,
      unitCode: unit.code,
      aktor,
      bankId: input.bankId,
      kasId: input.kasId,
      alasan: input.alasan ?? "",
      bolehHariTutup: canJadikanTransferHariTutup(ctx),
    });
    if (!r.ok) {
      await batal(client);
      return r;
    }
    await bentukJurnalSesudahTulis(client, unit.unit_id, aktor);
    await client.query("COMMIT");
    revalidatePath(halamanKoreksi(unit.code));
    revalidatePath(halamanInput(unit.code, r.tanggal));
    return { ok: true, pesan: `Baris ${r.tanggal} kini "Pindah Buku" dan bertaut dengan kaki Kas Besar-nya. Jurnal hari itu dibentuk ulang.` };
  } catch (e) {
    await batal(client);
    return { ok: false, error: e instanceof Error ? e.message : "Gagal mengoreksi baris." };
  } finally {
    client.release();
  }
}
