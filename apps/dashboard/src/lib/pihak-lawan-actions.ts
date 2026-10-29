"use server";

import { revalidatePath } from "next/cache";
import { pool, qScoped } from "./db";
import {
  PESAN_TAK_BOLEH_INPUT,
  alasanTakBolehInput,
  canNonaktifkanPihakLawan,
  canTambahPihakLawan,
  canTetapkanPihakLawanBaris,
  canTetapkanSaldoAwalPihakLawan,
  type WewenangCtx,
} from "./keuangan-wewenang";
import {
  JENIS_DIBUAT_KEUANGAN,
  LABEL_JENIS,
  jenisSah,
  periksaPihakLawanMutasi,
  periksaSaldoAwalPihakLawan,
  type JenisPihakLawan,
} from "./pihak-lawan-model";
import { UUID_RE, bacaPihakLawanTerkunci, tulisSaldoAwalPihakLawan } from "./pihak-lawan-tulis";
import { getDataScope, type DataScope, type ScopedUnit } from "./scope";

/**
 * Server action pihak lawan (rencana 2026-10-29 U3; R1, R2, R7, R26, R27;
 * KTD1–KTD3). Tindakan BERNAMA (§2.3) — tak ada tombol Edit generik:
 *
 *   · tambah pihak lawan            → Keuangan (`canTambahPihakLawan`)
 *   · nonaktifkan pihak lawan       → Keuangan (`canNonaktifkanPihakLawan`)
 *   · tetapkan/ganti saldo pembuka  → HoF (`canTetapkanSaldoAwalPihakLawan`)
 *   · tetapkan pihak lawan baris lama → Keuangan (`canTetapkanPihakLawanBaris`)
 *
 * Kerangka sama dengan `kas-actions.ts`: `requireUnit → wewenang → validasi →
 * BEGIN → set_config → DML → audit_log → COMMIT`. Setiap gerbang & validasi
 * menolak SEBELUM `pool.connect()`.
 *
 * ⛔ VOID/append-only: tak ada DELETE (`dashboard_app` di-REVOKE, 0049). Pihak
 * lawan dinonaktifkan, saldo pembuka di-void lalu diganti, baris kas lama
 * hanya diisi pihak lawannya sekali dari NULL.
 */

export type PihakLawanResult = { ok: true; pesan?: string } | { ok: false; error: string };

const halaman = (code: string): string => `/keuangan/unit/${code}/pihak-lawan`;

/** Pesan tolak untuk aksi berpola "mengetik" — satu sumber dengan Layar 3. */
function pesanTakBolehKetik(ctx: WewenangCtx): string {
  return PESAN_TAK_BOLEH_INPUT[alasanTakBolehInput(ctx) ?? "bukan_keuangan"];
}

type Buka = { boleh: false; error: string } | { boleh: true; scope: DataScope; unit: ScopedUnit };

/** requireUnit + predikat aksi — sebelum koneksi apa pun. */
async function buka(code: string, boleh: (ctx: WewenangCtx) => boolean): Promise<Buka> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(code); // di luar scope → notFound(), tak menulis
  const ctx = { role: scope.role, email: scope.email };
  if (!boleh(ctx)) return { boleh: false, error: pesanTakBolehKetik(ctx) };
  return { boleh: true, scope, unit };
}

async function audit(
  client: { query: (s: string, p: unknown[]) => Promise<unknown> },
  scope: DataScope,
  action: string,
  target: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO app.audit_log (actor_user_id, actor_email, action, target, detail)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [scope.userId, scope.email, action, target, JSON.stringify(detail)],
  );
}

async function batal(client: { query: (s: string) => Promise<unknown> }): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* abaikan */
  }
}

// ---------------------------------------------------------------------------
// Tambah pihak lawan
// ---------------------------------------------------------------------------

export async function tambahPihakLawan(input: {
  code: string;
  jenis: string;
  nama: string;
}): Promise<PihakLawanResult> {
  const ctx = await buka(input.code, canTambahPihakLawan);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;

  if (!jenisSah(input.jenis) || !JENIS_DIBUAT_KEUANGAN.includes(input.jenis)) {
    return {
      ok: false,
      error:
        "Jenis pihak lawan harus salah satu: " +
        JENIS_DIBUAT_KEUANGAN.map((j) => LABEL_JENIS[j]).join(", ") +
        ". Unit SolaMax sudah tersedia otomatis.",
    };
  }
  const jenis: JenisPihakLawan = input.jenis;
  const nama = input.nama.trim();
  if (nama === "") return { ok: false, error: "Nama pihak lawan wajib diisi." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const r = await client.query<{ id: string }>(
      `INSERT INTO app.pihak_lawan (unit_id, jenis, nama, created_by_user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id::text AS id`,
      [unit.unit_id, jenis, nama, scope.userId],
    );
    await audit(client, scope, "pihak_lawan.tambah", `${unit.code}/${r.rows[0]?.id ?? "?"}`, {
      unit: unit.code,
      jenis,
      nama,
    });
    await client.query("COMMIT");
    revalidatePath(halaman(unit.code));
    return { ok: true, pesan: `Pihak lawan “${nama}” ditambahkan.` };
  } catch (e) {
    await batal(client);
    // `pihak_lawan_nama_uq` (0049): dua "BPR" di satu unit membuat setiap mutasi ambigu.
    if ((e as { code?: string }).code === "23505") {
      return {
        ok: false,
        error: `Nama “${nama}” sudah dipakai pihak lawan lain di unit ini — pakai nama yang membedakannya.`,
      };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menambah pihak lawan." };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Nonaktifkan pihak lawan
// ---------------------------------------------------------------------------

/**
 * Nonaktif = tak bisa dipilih untuk mutasi BARU. Baris lama, saldo pembuka,
 * dan saldonya TETAP — dan tetap tampil di daftar (lihat predikatnya).
 */
export async function nonaktifkanPihakLawan(input: { code: string; id: string }): Promise<PihakLawanResult> {
  const ctx = await buka(input.code, canNonaktifkanPihakLawan);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;
  if (!UUID_RE.test(input.id)) return { ok: false, error: "Pihak lawan tak dikenali — muat ulang halaman." };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const r = await client.query<{ nama: string }>(
      `UPDATE app.pihak_lawan
          SET aktif = false
        WHERE id = $1::uuid AND unit_id = $2 AND aktif
        RETURNING nama`,
      [input.id, unit.unit_id],
    );
    const nama = r.rows[0]?.nama ?? null;
    if (nama === null) {
      await batal(client);
      return { ok: false, error: "Pihak lawan sudah nonaktif atau tak ditemukan — muat ulang halaman." };
    }
    await audit(client, scope, "pihak_lawan.nonaktifkan", `${unit.code}/${input.id}`, { unit: unit.code, nama });
    await client.query("COMMIT");
    revalidatePath(halaman(unit.code));
    return { ok: true, pesan: `“${nama}” dinonaktifkan — tak bisa dipilih untuk mutasi baru.` };
  } catch (e) {
    await batal(client);
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menonaktifkan." };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Saldo pembuka pihak lawan (R7)
// ---------------------------------------------------------------------------

export interface SaldoAwalPihakLawanInput {
  code: string;
  pihakLawanId: string;
  /** Tanggal cut-over — saldo berlaku pada AWAL hari ini. */
  tanggal: string;
  /** BERTANDA dari sisi unit `code`: positif = piutang, negatif = hutang. */
  amount: number;
  sementara?: boolean;
  alasan: string;
}

/**
 * TETAPKAN / GANTI saldo pembuka satu pihak lawan — pola `tetapkanSaldoAwal`
 * (§10.24): HoF, void + insert + `audit_log` `pihak_lawan.saldo_awal.*`.
 *
 * ⛔ GERBANG DUA UNIT (Implementation Constraints). Untuk pihak lawan berjenis
 * `unit`, satu pengisian menulis buku DUA unit (R7). Maka `requireUnit` untuk
 * KEDUA unit dan wewenangnya lolos SEBELUM BEGIN; pengguna yang tak memegang
 * unit lawan ditolak UTUH — tak ada jalan "tulis sisi saya saja".
 */
export async function tetapkanSaldoAwalPihakLawan(input: SaldoAwalPihakLawanInput): Promise<PihakLawanResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  if (!canTetapkanSaldoAwalPihakLawan({ role: scope.role, email: scope.email })) {
    return { ok: false, error: "Hanya Head of Finance yang boleh menetapkan saldo pembuka pihak lawan." };
  }
  const sementara = input.sementara === true;
  const salah = periksaSaldoAwalPihakLawan({
    tanggal: input.tanggal,
    amount: input.amount,
    sementara,
    alasan: input.alasan,
  });
  if (salah !== null) return { ok: false, error: salah };
  if (!UUID_RE.test(input.pihakLawanId)) return { ok: false, error: "Pihak lawan tak dikenali — muat ulang halaman." };

  // Baca dulu (di unit sendiri) untuk tahu apakah ini pasangan unit — gerbang
  // unit kedua harus lolos SEBELUM transaksi tulis dibuka. Dibaca ULANG di
  // dalam transaksi oleh `tulisSaldoAwalPihakLawan`.
  const [pl] = await qScoped<{ jenis: JenisPihakLawan; lawanUnitId: number | null }>(
    unit.unit_id,
    `SELECT jenis, lawan_unit_id AS "lawanUnitId"
       FROM app.pihak_lawan
      WHERE id = $1::uuid AND unit_id = $2`,
    [input.pihakLawanId, unit.unit_id],
  );
  if (!pl) return { ok: false, error: "Pihak lawan tak ditemukan di unit ini — muat ulang halaman." };

  let lawan: ScopedUnit | null = null;
  if (pl.jenis === "unit") {
    const kodeLawan = scope.units.find((u) => u.unit_id === pl.lawanUnitId)?.code ?? null;
    if (kodeLawan === null) {
      return {
        ok: false,
        error:
          "Saldo pembuka antar unit berlaku untuk KEDUA sisi, dan akun ini tidak memegang unit lawannya — " +
          "ditolak utuh, tak ada sisi yang tertulis. Minta pengguna yang memegang kedua unit (atau super admin).",
      };
    }
    lawan = scope.requireUnit(kodeLawan);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids = lawan === null ? String(unit.unit_id) : `${unit.unit_id},${lawan.unit_id}`;
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [ids]);
    const hasil = await tulisSaldoAwalPihakLawan(client, {
      unit: { unitId: unit.unit_id, code: unit.code },
      lawan: lawan === null ? null : { unitId: lawan.unit_id, code: lawan.code },
      pihakLawanId: input.pihakLawanId,
      tanggal: input.tanggal,
      amount: input.amount,
      sementara,
      alasan: input.alasan,
      aktor: { userId: scope.userId, email: scope.email },
    });
    if (!hasil.ok) {
      await batal(client);
      return { ok: false, error: hasil.error };
    }
    await client.query("COMMIT");
    revalidatePath(halaman(unit.code));
    if (lawan !== null) revalidatePath(halaman(lawan.code));
    return {
      ok: true,
      pesan: hasil.sisi === 2 ? `Saldo pembuka tersimpan di kedua sisi (${unit.name} & ${lawan?.name}).` : "Saldo pembuka tersimpan.",
    };
  } catch (e) {
    await batal(client);
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menetapkan saldo pembuka." };
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Tetapkan pihak lawan — baris Hutang Piutang lama (KTD3)
// ---------------------------------------------------------------------------

/**
 * Mengisi `pihak_lawan_id` baris kas LAMA **sekali**, dari NULL. Nominal,
 * tanggal, dan kategori tidak berubah — UPDATE-nya hanya menyebut satu kolom,
 * dan `WHERE pihak_lawan_id IS NULL` membuat pengisian kedua tak berefek
 * (bukan menimpa). Jejaknya di `audit_log`.
 */
export async function tetapkanPihakLawanBaris(input: {
  code: string;
  cashLedgerId: string;
  pihakLawanId: string;
}): Promise<PihakLawanResult> {
  const ctx = await buka(input.code, canTetapkanPihakLawanBaris);
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;
  if (!UUID_RE.test(input.cashLedgerId) || !UUID_RE.test(input.pihakLawanId)) {
    return { ok: false, error: "Baris atau pihak lawan tak dikenali — muat ulang halaman." };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const r = await client.query<{
      categoryLabel: string | null;
      pihakLawanId: string | null;
      void: boolean;
      amount: string;
      businessDate: string;
    }>(
      `SELECT category_label AS "categoryLabel", pihak_lawan_id::text AS "pihakLawanId", void,
              amount::text AS amount, to_char(business_date,'YYYY-MM-DD') AS "businessDate"
         FROM app.cash_ledger
        WHERE id = $1::uuid AND unit_id = $2
        FOR UPDATE`,
      [input.cashLedgerId, unit.unit_id],
    );
    const baris = r.rows[0];
    if (!baris || baris.void) {
      await batal(client);
      return { ok: false, error: "Baris tak ditemukan atau sudah dibatalkan — muat ulang halaman." };
    }
    if (baris.pihakLawanId !== null) {
      await batal(client);
      return { ok: false, error: "Baris ini sudah punya pihak lawan — penetapan hanya sekali." };
    }
    const pihak = await bacaPihakLawanTerkunci(client, unit.unit_id, input.pihakLawanId);
    const salah = periksaPihakLawanMutasi({
      categoryLabel: baris.categoryLabel,
      pihakLawanId: input.pihakLawanId,
      pihak,
    });
    if (salah !== null) {
      await batal(client);
      return { ok: false, error: salah };
    }
    const upd = await client.query(
      `UPDATE app.cash_ledger
          SET pihak_lawan_id = $1::uuid
        WHERE id = $2::uuid AND unit_id = $3 AND pihak_lawan_id IS NULL AND NOT void`,
      [input.pihakLawanId, input.cashLedgerId, unit.unit_id],
    );
    if (upd.rowCount !== 1) {
      await batal(client);
      return { ok: false, error: "Baris berubah bersamaan — muat ulang halaman." };
    }
    await audit(client, scope, "kas.pihak_lawan.tetapkan", `${unit.code}/${input.cashLedgerId}`, {
      pihakLawanId: input.pihakLawanId,
      pihakLawan: pihak?.nama ?? null,
      kategori: baris.categoryLabel,
      nominal: baris.amount,
      tanggal: baris.businessDate,
    });
    await client.query("COMMIT");
    revalidatePath(halaman(unit.code));
    return { ok: true, pesan: `Pihak lawan “${pihak?.nama ?? ""}” ditetapkan.` };
  } catch (e) {
    await batal(client);
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menetapkan pihak lawan." };
  } finally {
    client.release();
  }
}
