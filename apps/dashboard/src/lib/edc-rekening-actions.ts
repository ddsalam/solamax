"use server";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { normalisasiEdc } from "./edc-rekening-model";
import { canAturRekeningEdc } from "./keuangan-wewenang";
import { getDataScope, type ScopedUnit } from "./scope";

/**
 * Server action Pengaturan EDC — rekening pencairan tiap EDC (§10.28).
 *
 * ⛔ Pengaturan TIDAK PERNAH ditimpa. Rekening baru = baris baru dengan tanggal
 * berlakunya; mengoreksi salah isi = batalkan (void) lalu tulis ulang. Setiap
 * perubahan tercatat di `audit_log` DAN tampil di Pemantauan pemakaian —
 * mengganti rekening tujuan dana adalah celah penyelewengan klasik, jadi ia
 * harus selalu terlihat, bukan sekadar mungkin ditelusuri.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PESAN_WEWENANG =
  "Rekening pencairan EDC diatur oleh tim Finance (staf Keuangan / Head of Finance), Direksi, atau super admin.";

export type RekeningEdcResult = { ok: true } | { ok: false; error: string };

async function mulai(client: PoolClient, unit: ScopedUnit): Promise<void> {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
}

async function gagal(client: PoolClient, e: unknown, pesan: string): Promise<RekeningEdcResult> {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* abaikan */
  }
  return { ok: false, error: e instanceof Error ? e.message : pesan };
}

function segarkan(code: string): void {
  revalidatePath(`/keuangan/unit/${code}/edc`);
  // Formulir batch settlement membaca saran rekening dari pengaturan ini.
  revalidatePath(`/keuangan/unit/${code}`, "layout");
  revalidatePath("/keuangan/pemantauan");
}

/**
 * Tetapkan rekening pencairan sebuah EDC mulai `berlakuSejak`.
 *
 * Bila pada tanggal yang SAMA sudah ada pengaturan aktif, yang lama dibatalkan
 * dan yang baru menggantikannya — itu koreksi, dan riwayatnya tetap utuh.
 */
export async function aturRekeningEdc(input: {
  code: string;
  acquirer: string;
  toAccountId: string;
  berlakuSejak: string;
  catatan?: string;
}): Promise<RekeningEdcResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  if (!canAturRekeningEdc({ role: scope.role, email: scope.email })) {
    return { ok: false, error: PESAN_WEWENANG };
  }
  const acquirer = normalisasiEdc(input.acquirer);
  if (acquirer === "") return { ok: false, error: "Nama EDC wajib diisi, contoh BCA atau LINKAJA." };
  if (!DATE_RE.test(input.berlakuSejak)) return { ok: false, error: "Tanggal berlaku tak valid." };
  if (input.toAccountId === "") return { ok: false, error: "Pilih rekening tujuan pencairannya." };

  const client = await pool.connect();
  try {
    await mulai(client, unit);

    // Rekening harus rekening BANK yang AKTIF milik unit ini. FK komposit di DB
    // menjaga "milik unit ini"; jenis & keaktifan dijaga di sini.
    const akun = await client.query<{ nama: string; kind: string; active: boolean }>(
      `SELECT nama, kind::text AS kind, active FROM app.cash_account
        WHERE id = $1::uuid AND unit_id = $2`,
      [input.toAccountId, unit.unit_id],
    );
    const a = akun.rows[0];
    if (!a) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Rekening tak ditemukan di unit ini — muat ulang halaman." };
    }
    if (a.kind !== "bank") {
      await client.query("ROLLBACK");
      return { ok: false, error: "Dana EDC cair ke rekening BANK — bukan Kas Besar atau EDC Penampungan." };
    }
    if (!a.active) {
      await client.query("ROLLBACK");
      return { ok: false, error: `Rekening ${a.nama} sudah nonaktif — pilih rekening yang masih dipakai.` };
    }

    // Yang berlaku pada tanggal itu SEBELUM perubahan — untuk menolak isian yang
    // tak mengubah apa pun, dan untuk jejak audit "dari → ke".
    const sebelum = await client.query<{ id: string; toAccountId: string; berlakuSejak: string; nama: string }>(
      `SELECT r.id::text AS id, r.to_account_id::text AS "toAccountId",
              to_char(r.berlaku_sejak, 'YYYY-MM-DD') AS "berlakuSejak", a.nama
         FROM app.edc_rekening_pencairan r
         JOIN app.cash_account a ON a.id = r.to_account_id AND a.unit_id = r.unit_id
        WHERE r.unit_id = $1 AND r.acquirer = $2 AND NOT r.void AND r.berlaku_sejak <= $3::date
        ORDER BY r.berlaku_sejak DESC
        LIMIT 1
        FOR UPDATE OF r`,
      [unit.unit_id, acquirer, input.berlakuSejak],
    );
    const lama = sebelum.rows[0] ?? null;
    if (lama !== null && lama.toAccountId === input.toAccountId) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error: `${acquirer} sudah cair ke ${a.nama} sejak ${lama.berlakuSejak} — tidak ada yang berubah.`,
      };
    }
    // Koreksi pada tanggal yang sama: batalkan yang lama, tulis yang baru.
    if (lama !== null && lama.berlakuSejak === input.berlakuSejak) {
      await client.query(
        `UPDATE app.edc_rekening_pencairan
            SET void = true, voided_by_user_id = $1, voided_at = now()
          WHERE id = $2::uuid AND unit_id = $3 AND NOT void`,
        [scope.userId, lama.id, unit.unit_id],
      );
    }
    await client.query(
      `INSERT INTO app.edc_rekening_pencairan
         (unit_id, acquirer, to_account_id, berlaku_sejak, catatan, created_by_user_id)
       VALUES ($1, $2, $3::uuid, $4::date, $5, $6)`,
      [unit.unit_id, acquirer, input.toAccountId, input.berlakuSejak, input.catatan?.trim() || null, scope.userId],
    );
    await client.query(
      `INSERT INTO app.audit_log (actor_user_id, action, target, detail) VALUES ($1, $2, $3, $4)`,
      [
        scope.userId,
        lama === null ? "edc_rekening.tetapkan" : "edc_rekening.ganti",
        `${unit.code}/${acquirer}`,
        JSON.stringify({
          berlakuSejak: input.berlakuSejak,
          ke: a.nama,
          sebelumnya: lama === null ? null : { rekening: lama.nama, sejak: lama.berlakuSejak },
        }),
      ],
    );
    await client.query("COMMIT");
    segarkan(unit.code);
    return { ok: true };
  } catch (e) {
    return gagal(client, e, "Gagal menyimpan pengaturan rekening.");
  } finally {
    client.release();
  }
}

/** Batalkan satu versi pengaturan (salah isi). Riwayatnya tetap tampil, bertanda dibatalkan. */
export async function batalkanRekeningEdc(input: { code: string; id: string }): Promise<RekeningEdcResult> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(input.code);
  if (!canAturRekeningEdc({ role: scope.role, email: scope.email })) {
    return { ok: false, error: PESAN_WEWENANG };
  }

  const client = await pool.connect();
  try {
    await mulai(client, unit);
    const r = await client.query<{ acquirer: string; berlakuSejak: string; nama: string }>(
      `UPDATE app.edc_rekening_pencairan r
          SET void = true, voided_by_user_id = $1, voided_at = now()
         FROM app.cash_account a
        WHERE r.id = $2::uuid AND r.unit_id = $3 AND NOT r.void
          AND a.id = r.to_account_id AND a.unit_id = r.unit_id
        RETURNING r.acquirer, to_char(r.berlaku_sejak, 'YYYY-MM-DD') AS "berlakuSejak", a.nama`,
      [scope.userId, input.id, unit.unit_id],
    );
    const b = r.rows[0];
    if (!b) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Pengaturan ini sudah dibatalkan atau tak ditemukan — muat ulang halaman." };
    }
    await client.query(
      `INSERT INTO app.audit_log (actor_user_id, action, target, detail) VALUES ($1, $2, $3, $4)`,
      [
        scope.userId,
        "edc_rekening.batal",
        `${unit.code}/${b.acquirer}`,
        JSON.stringify({ berlakuSejak: b.berlakuSejak, rekening: b.nama }),
      ],
    );
    await client.query("COMMIT");
    segarkan(unit.code);
    return { ok: true };
  } catch (e) {
    return gagal(client, e, "Gagal membatalkan pengaturan.");
  } finally {
    client.release();
  }
}
