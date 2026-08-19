"use server";

import { revalidatePath } from "next/cache";
import { pool } from "./db";
import {
  kandidatAktifkanKembali,
  periksaNama,
  periksaNonaktif,
  PESAN_SALAH_NAMA,
  type KindAkun,
} from "./keuangan-akun-model";
import {
  canInputKeuangan,
  canNonaktifkanAkunKas,
} from "./keuangan-wewenang";
import { getDataScope, type DataScope, type ScopedUnit } from "./scope";

/**
 * Server action Kelola Akun Kas (§10.18).
 *
 * ⛔ LIMA HAL YANG MENGIKAT:
 *
 * 1. **TIDAK ADA `DELETE`, dan tak akan pernah bisa ada.** `dashboard_app`
 *    hanya punya `SELECT, INSERT, UPDATE`; `DELETE` di-REVOKE (0029:200).
 *    Memanggilnya jatuh **`42501` saat dijalankan** — parser sempurna, `tsc`
 *    buta, uji unit tak menyentuh DB. Dijaga penjaga hak-akses tersendiri.
 * 2. **Wewenang ASIMETRIS** (§10.18): tambah & ubah nama = `canInputKeuangan`;
 *    **nonaktifkan = HoF**. Menambah menambah sesuatu yang TERLIHAT;
 *    menonaktifkan membuat saldo berhenti terlihat.
 * 3. **`active` dan `closed_at` DILAS** (CHECK 0029:72). Menonaktifkan WAJIB
 *    menyertakan tanggal; mengaktifkan kembali WAJIB mengosongkannya. Tak ada
 *    jalan menulis salah satunya sendirian.
 * 4. **Aturan nama ditegakkan di SATU tempat** — `periksaNama`, yang sama
 *    dipakai layar. Menyalinnya berarti form dan server bisa menjawab berbeda.
 * 5. **Setiap tulis masuk `audit_log`**: siapa, kapan, dari nilai apa ke apa.
 */

export type AkunResult = { ok: true; pesan?: string } | { ok: false; error: string };

type Buka =
  | { boleh: false; error: string }
  | { boleh: true; scope: DataScope; unit: ScopedUnit };

async function buka(code: string, izin: "tulis" | "nonaktif"): Promise<Buka> {
  const scope = await getDataScope();
  const unit = scope.requireUnit(code); // di luar scope → notFound(), tak menulis
  const ctx = { role: scope.role, email: scope.email };
  const lolos = izin === "tulis" ? canInputKeuangan(ctx) : canNonaktifkanAkunKas(ctx);
  if (!lolos) {
    return {
      boleh: false,
      error:
        izin === "tulis"
          ? "Hanya peran Keuangan yang boleh menambah atau mengubah nama akun kas."
          : "Hanya Head of Finance yang boleh menonaktifkan akun kas — menghilangkan akun " +
            "adalah cara membuat saldo hilang dari pandangan.",
    };
  }
  return { boleh: true, scope, unit };
}

/** Jejak wajib: siapa, kapan, dari nilai apa ke nilai apa. */
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

async function akunUnit(
  client: { query: (s: string, p: unknown[]) => Promise<{ rows: unknown[] }> },
  unitId: number,
): Promise<{ id: string; nama: string; active: boolean }[]> {
  const r = await client.query(
    `SELECT id::text AS id, nama, active FROM app.cash_account WHERE unit_id = $1`,
    [unitId],
  );
  return r.rows as { id: string; nama: string; active: boolean }[];
}

export interface TambahAkunInput {
  code: string;
  namaUnit: string;
  nama: string;
  kind: KindAkun;
}

export async function tambahAkunKas(input: TambahAkunInput): Promise<AkunResult> {
  const ctx = await buka(input.code, "tulis");
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const akun = await akunUnit(client, unit.unit_id);

    // Aturan nama dari SATU tempat — sama dengan yang dipakai layar.
    const salah = periksaNama(input.nama, {
      kind: input.kind,
      namaUnit: input.namaUnit,
      akun,
    });
    if (salah.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: salah.map((s) => PESAN_SALAH_NAMA[s]).join(" ") };
    }

    // Jebakan reaktivasi: kunci unik BUKAN parsial, jadi nama yang sama pada
    // baris tidak-aktif akan menolak INSERT dengan galat yang terbaca seperti
    // bug. Tawarkan jalan yang benar alih-alih membiarkannya jatuh.
    const lama = kandidatAktifkanKembali(input.nama, akun);
    if (lama !== null) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error:
          `Rekening “${lama.nama}” pernah ada dan sedang tidak aktif. ` +
          `Aktifkan kembali alih-alih membuat baru — riwayat mutasinya ikut terpakai lagi.`,
      };
    }

    await client.query(
      `INSERT INTO app.cash_account (unit_id, nama, kind, active)
       VALUES ($1,$2,$3::app.cash_account_kind,true)`,
      [unit.unit_id, input.nama.trim(), input.kind],
    );
    await audit(client, scope, "cash_account_add", `${unit.code}:${input.nama.trim()}`, {
      unit: unit.code,
      nama: input.nama.trim(),
      kind: input.kind,
    });
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/akun-kas`);
    return { ok: true, pesan: `Rekening “${input.nama.trim()}” ditambahkan.` };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menambah akun." };
  } finally {
    client.release();
  }
}

export async function ubahNamaAkunKas(input: {
  code: string;
  namaUnit: string;
  id: string;
  nama: string;
}): Promise<AkunResult> {
  const ctx = await buka(input.code, "tulis");
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const cur = await client.query<{ nama: string; kind: KindAkun }>(
      `SELECT nama, kind::text AS kind FROM app.cash_account
        WHERE id = $1::uuid AND unit_id = $2 FOR UPDATE`,
      [input.id, unit.unit_id],
    );
    const row = cur.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Akun tak ditemukan." };
    }

    const salah = periksaNama(input.nama, {
      kind: row.kind,
      namaUnit: input.namaUnit,
      akun: await akunUnit(client, unit.unit_id),
      kecualiId: input.id,
    });
    if (salah.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: salah.map((s) => PESAN_SALAH_NAMA[s]).join(" ") };
    }

    await client.query(`UPDATE app.cash_account SET nama = $1 WHERE id = $2::uuid AND unit_id = $3`, [
      input.nama.trim(),
      input.id,
      unit.unit_id,
    ]);
    await audit(client, scope, "cash_account_rename", `${unit.code}:${input.id}`, {
      unit: unit.code,
      dari: row.nama,
      ke: input.nama.trim(),
    });
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/akun-kas`);
    // ⚠️ Nama bukan riwayat: laporan lama akan menyebut nama BARU untuk mutasi
    // lama (§10.18 butir 2). Disebut ke pengguna, bukan hanya ke dokumen.
    return {
      ok: true,
      pesan:
        `Nama diubah. Perlu diketahui: laporan lama akan menyebut nama BARU untuk mutasi ` +
        `lama — nama bukan riwayat.`,
    };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal mengubah nama." };
  } finally {
    client.release();
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Nonaktifkan — **HoF saja**, dan **wajib bertanggal**.
 *
 * Tanggalnya bukan formalitas: CHECK 0029:72 mengelas `active` ke `closed_at`,
 * jadi tak ada keadaan "berhenti dipakai tapi belum ditutup". Form yang
 * menawarkan keduanya terpisah akan gagal di DB (§10.18).
 */
export async function nonaktifkanAkunKas(input: {
  code: string;
  id: string;
  closedAt: string;
}): Promise<AkunResult> {
  const ctx = await buka(input.code, "nonaktif");
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;
  if (!DATE_RE.test(input.closedAt)) {
    return {
      ok: false,
      error:
        "Tanggal tutup wajib diisi — skema tidak mengenal “nonaktif tetapi belum ditutup”. " +
        "Kalau tanggalnya belum diketahui, biarkan rekening ini aktif.",
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const cur = await client.query<{ nama: string; active: boolean; nMutasi: string }>(
      `SELECT a.nama, a.active,
              (SELECT count(*) FROM app.cash_ledger l
                WHERE l.account_id = a.id AND NOT l.void)::text AS "nMutasi"
         FROM app.cash_account a
        WHERE a.id = $1::uuid AND a.unit_id = $2 FOR UPDATE`,
      [input.id, unit.unit_id],
    );
    const row = cur.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Akun tak ditemukan." };
    }
    const h = periksaNonaktif({ active: row.active, nMutasi: Number(row.nMutasi) });
    if (!h.boleh) {
      await client.query("ROLLBACK");
      return { ok: false, error: h.peringatan ?? "Akun ini tidak bisa dinonaktifkan." };
    }

    await client.query(
      `UPDATE app.cash_account SET active = false, closed_at = $1::date
        WHERE id = $2::uuid AND unit_id = $3 AND active`,
      [input.closedAt, input.id, unit.unit_id],
    );
    await audit(client, scope, "cash_account_deactivate", `${unit.code}:${input.id}`, {
      unit: unit.code,
      nama: row.nama,
      closedAt: input.closedAt,
      nMutasi: Number(row.nMutasi),
    });
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/akun-kas`);
    return { ok: true, pesan: `“${row.nama}” dinonaktifkan per ${input.closedAt}.` };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menonaktifkan." };
  } finally {
    client.release();
  }
}

/**
 * Aktifkan kembali — **`canInputKeuangan`**, bukan HoF.
 *
 * Arahnya yang menentukan: mengaktifkan kembali membuat akun **terlihat lagi**,
 * dan yang terlihat menampakkan kesalahannya sendiri. Yang dijaga HoF adalah
 * arah sebaliknya — membuat sesuatu berhenti terlihat (§10.18).
 *
 * `closed_at` DIKOSONGKAN dalam pernyataan yang sama: CHECK 0029:72 mengelas
 * keduanya, jadi mengaktifkan tanpa mengosongkannya akan ditolak DB.
 */
export async function aktifkanKembaliAkunKas(input: {
  code: string;
  id: string;
}): Promise<AkunResult> {
  const ctx = await buka(input.code, "tulis");
  if (!ctx.boleh) return { ok: false, error: ctx.error };
  const { scope, unit } = ctx;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unit.unit_id)]);
    const cur = await client.query<{ nama: string }>(
      `SELECT nama FROM app.cash_account
        WHERE id = $1::uuid AND unit_id = $2 AND NOT active FOR UPDATE`,
      [input.id, unit.unit_id],
    );
    const row = cur.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Akun tak ditemukan atau memang sudah aktif." };
    }
    await client.query(
      `UPDATE app.cash_account SET active = true, closed_at = NULL
        WHERE id = $1::uuid AND unit_id = $2 AND NOT active`,
      [input.id, unit.unit_id],
    );
    await audit(client, scope, "cash_account_reactivate", `${unit.code}:${input.id}`, {
      unit: unit.code,
      nama: row.nama,
    });
    await client.query("COMMIT");
    revalidatePath(`/keuangan/unit/${unit.code}/akun-kas`);
    return { ok: true, pesan: `“${row.nama}” aktif kembali; riwayat mutasinya ikut terpakai lagi.` };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* abaikan */
    }
    return { ok: false, error: e instanceof Error ? e.message : "Gagal mengaktifkan kembali." };
  } finally {
    client.release();
  }
}
