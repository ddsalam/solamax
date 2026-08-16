"use server";

import { revalidatePath } from "next/cache";
import { pool } from "./db";
import { kategoriCocok, tandaCocok, type JenisMutasi, type SisiKategori } from "./keuangan-kas";
import { alasanTakBolehInput, PESAN_TAK_BOLEH_INPUT } from "./keuangan-wewenang";
import { getDataScope, type DataScope, type ScopedUnit } from "./scope";

/**
 * Server action buku kas & buku bank (Layar 3 blok 2).
 *
 * Pola SAMA dengan `harga-beli-actions.ts` — `requireUnit` → `canInputKeuangan`
 * → `set_config` transaction-local → DML. Tak ada pola baru.
 *
 * ⛔ EMPAT HAL YANG MENGIKAT:
 *
 * 1. **SALDO TIDAK PERNAH DITULIS.** Tak ada kolom saldo di `app.cash_ledger`
 *    (0029) dan tak ada satu pun `INSERT` di sini yang menyebutnya. Saldo
 *    dihitung dari mutasi setiap kali dibaca.
 * 2. **Nominal BERTANDA** — debet > 0, kredit < 0 — sehingga saldo = `Σ amount`.
 *    Diperiksa di sini DAN oleh CHECK `cash_ledger_tanda` di DB.
 * 3. **Setoran pengawas DITAWARKAN, bukan diposting** (§1.4). Barisnya baru
 *    lahir saat ada yang MENYETUJUI, dan `created_by_user_id` pada baris itu
 *    adalah jejak persetujuannya.
 * 4. **Nominal tawaran tidak diterima dari client.** Ia dibaca ulang di server
 *    dari `app.manual_entry`. Kalau angkanya datang dari browser, "disetujui"
 *    berhenti berarti apa pun — yang menyetujui bisa menyetujui angka lain.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type KasResult = { ok: true; n?: number } | { ok: false; error: string };

/**
 * Gerbang bersama ketiga aksi: unit ter-scope + wewenang tulis. Mengembalikan
 * ALASAN penolakan, bukan sekadar `null` — pesan "Anda tidak berwenang" yang
 * tidak menyebut sebabnya membuat HoF mengira sistemnya rusak.
 */
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

export interface MutasiInput {
  code: string;
  date: string;
  accountId: string;
  keterangan: string;
  jenis: JenisMutasi;
  categorySide: SisiKategori | null;
  categoryLabel: string | null;
  /** BERTANDA: debet > 0, kredit < 0. */
  amount: number;
}

export async function simpanMutasiKas(input: MutasiInput): Promise<KasResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;

  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };
  if (input.keterangan.trim() === "") return { ok: false, error: "Keterangan wajib diisi." };
  if (!Number.isFinite(input.amount)) return { ok: false, error: "Nominal tak valid." };
  if (!tandaCocok(input.jenis, input.amount)) {
    return {
      ok: false,
      error: "Tanda nominal harus mengikuti jenis: debet positif, kredit negatif, dan bukan nol.",
    };
  }
  if (!kategoriCocok(input.jenis, input.categorySide)) {
    return { ok: false, error: "Kategori harus sesisi dengan jenis mutasinya." };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    await client.query(
      `INSERT INTO app.cash_ledger
         (unit_id, account_id, business_date, keterangan, jenis,
          category_side, category_label, amount, created_by_user_id)
       VALUES ($1,$2::uuid,$3::date,$4,$5::app.cash_mutation_jenis,
               $6::app.cash_mutation_side,$7,$8,$9)`,
      [
        unit.unit_id,
        input.accountId,
        input.date,
        input.keterangan.trim(),
        input.jenis,
        input.categorySide,
        input.categoryLabel,
        input.amount,
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
 * Setujui tawaran setoran — INILAH yang mengubah "ditawarkan" jadi "dibukukan".
 *
 * Nominal & keterangan diambil dari `app.manual_entry` DI SERVER (butir 4 di
 * kepala berkas). Yang datang dari client hanyalah daftar **id** setoran mana
 * yang disetujui.
 *
 * Kategori dikunci `Setoran Hasil Penjualan` (sisi debet) — bukan pilihan
 * pengguna: baris ini lahir dari setoran hasil penjualan, dan membiarkan
 * kategorinya bebas membuat asal-usulnya bisa dikaburkan pada saat persetujuan.
 */
export async function setujuiSetoran(input: {
  code: string;
  date: string;
  accountId: string;
  manualEntryIds: string[];
}): Promise<KasResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;

  if (!DATE_RE.test(input.date)) return { ok: false, error: "Tanggal tak valid." };
  if (input.manualEntryIds.length === 0) {
    return { ok: false, error: "Tak ada setoran yang dipilih." };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);

    // Baca ulang di server: nominal & keterangan TIDAK diterima dari client.
    // RLS + unit_id di WHERE memastikan setoran unit lain tak pernah terjaring.
    const src = await client.query<{ id: string; keterangan: string; amount: string }>(
      `SELECT id::text AS id, keterangan, amount::text AS amount
         FROM app.manual_entry
        WHERE unit_id = $1 AND business_date = $2::date
          AND section = 'setoran_tunai'::app.manual_entry_section
          AND NOT void AND id = ANY($3::uuid[])`,
      [unit.unit_id, input.date, input.manualEntryIds],
    );
    if (src.rowCount !== input.manualEntryIds.length) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error: "Sebagian setoran tak ditemukan lagi — muat ulang halaman sebelum menyetujui.",
      };
    }

    for (const r of src.rows) {
      // ON CONFLICT pada indeks unik parsial 0033: menyetujui dua kali tidak
      // melahirkan baris kedua. Diam-diam mengabaikan lebih baik daripada gagal
      // total — dua penyetuju yang menekan bersamaan adalah kejadian biasa.
      await client.query(
        `INSERT INTO app.cash_ledger
           (unit_id, account_id, business_date, keterangan, jenis,
            category_side, category_label, amount, created_by_user_id,
            source_manual_entry_id)
         VALUES ($1,$2::uuid,$3::date,$4,'debet','debet','Setoran Hasil Penjualan',$5,$6,$7::uuid)
         ON CONFLICT ("source_manual_entry_id") WHERE "source_manual_entry_id" IS NOT NULL AND NOT "void"
         DO NOTHING`,
        [
          unit.unit_id,
          input.accountId,
          input.date,
          r.keterangan,
          r.amount,
          scope.userId,
          r.id,
        ],
      );
    }
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/${input.date}/input`);
    return { ok: true, n: src.rowCount ?? 0 };
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

/**
 * Batalkan satu baris buku. VOID, tak pernah DELETE — dan `voided_by_user_id`
 * membuat "siapa membatalkan" punya jawaban. CHECK `cash_ledger_void_audit`
 * (0029) menolak pembatalan tanpa jejak.
 */
export async function voidMutasiKas(input: {
  code: string;
  date: string;
  id: string;
}): Promise<KasResult> {
  const ctx = await buka(input.code);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const res = await client.query(
      `UPDATE app.cash_ledger
          SET void=true, voided_by_user_id=$1, voided_at=now()
        WHERE id=$2::uuid AND unit_id=$3 AND NOT void`,
      [scope.userId, input.id, unit.unit_id],
    );
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/${input.date}/input`);
    if (res.rowCount === 0) return { ok: false, error: "Baris sudah dibatalkan atau tak ditemukan." };
    return { ok: true };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal membatalkan." };
  } finally {
    client.release();
  }
}
