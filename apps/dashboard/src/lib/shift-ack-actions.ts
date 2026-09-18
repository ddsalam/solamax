"use server";

import { revalidatePath } from "next/cache";
import { q, qScoped } from "./db";
import { getDataScope } from "./scope";

/**
 * Pengakuan pemilik atas pergerakan angka pada data BEKU.
 *
 * Keputusan pemilik 2026-09-17: angka historis boleh bergerak, ASAL
 * pergerakannya terlihat dan diakui manusia. Modul ini adalah satu-satunya
 * jalur yang menghijaukan indikator itu, dan ia meninggalkan jejak.
 *
 * Empat batas yang ditegakkan di sini, semuanya server-side:
 *
 *  A1  HANYA super_admin. Ini wewenang PEMILIK, bukan pengelola akses — orang
 *      yang bisa memberi akses tidak dengan sendirinya berhak menyatakan sebuah
 *      angka historis sah.
 *  A2  Satu pengakuan untuk SATU peristiwa, disebut generasinya. Tidak ada
 *      "setujui semua": pemanggilan tanpa `generation_id` ditolak, bukan
 *      diperluas diam-diam menjadi seluruh tanggal.
 *  A3  Peristiwanya harus BENAR-BENAR ADA dan terlihat dalam scope pemanggil.
 *      Pembacaan ini lewat `qScoped`, jadi RLS ikut menilai — pengakuan atas
 *      unit di luar scope tidak akan menemukan barisnya.
 *  A4  Jejaknya dua lapis: baris append-only di `saldo_pelanggan_shift_ack`
 *      (tabel itu di-REVOKE UPDATE/DELETE untuk dashboard_app) DAN satu baris
 *      di `app.audit_log`. Tidak ada jalur yang menghijaukan tanpa jejak.
 *
 * Tanpa kedaluwarsa otomatis: pengakuan tidak pernah kedaluwarsa, dan tidak
 * pernah diperluas. Kalau angkanya bergerak lagi, generasinya baru dan
 * indikatornya memerah lagi tanpa perlu ada yang mencabut apa pun.
 */
export async function acknowledgeShift(formData: FormData): Promise<void> {
  const scope = await getDataScope();
  // A1 — wewenang pemilik.
  if (!scope.isSuperAdmin) throw new Error("forbidden: super_admin only");

  const code = String(formData.get("code") ?? "");
  const asOfDate = String(formData.get("as_of_date") ?? "");
  const generationId = String(formData.get("generation_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  // A2 — satu peristiwa, disebut generasinya.
  if (!generationId) throw new Error("generation_id wajib: tidak ada jalur setujui-semua");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new Error("as_of_date tidak valid");

  const unit = scope.requireUnit(code);

  // A3 — peristiwanya harus ada DAN terlihat dalam scope (RLS ikut menilai).
  const found = await qScoped<{ generation_id: string }>(
    unit.unit_id,
    `SELECT generation_id FROM app.saldo_pelanggan_shift
      WHERE unit_id = $1::smallint AND as_of_date = $2::date AND generation_id = $3::uuid`,
    [unit.unit_id, asOfDate, generationId],
  );
  if (found.length !== 1) throw new Error("peristiwa pergeseran tidak ditemukan dalam scope ini");

  // A4 — jejak lapis pertama: append-only.
  await qScoped(
    unit.unit_id,
    `INSERT INTO app.saldo_pelanggan_shift_ack
       (unit_id, as_of_date, generation_id, acknowledged_by_user_id, acknowledged_by_email, note)
     VALUES ($1::smallint, $2::date, $3::uuid, $4, $5, NULLIF($6, ''))`,
    [unit.unit_id, asOfDate, generationId, String(scope.userId), scope.email, note],
  );

  // A4 — jejak lapis kedua, di tempat tindakan pemilik lain sudah dicatat.
  await q(
    `INSERT INTO app.audit_log (actor_user_id, actor_email, action, target, tenant_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      scope.userId,
      scope.email,
      "saldo_shift_acknowledge",
      `${unit.code}/${asOfDate}/${generationId}`,
      null,
      JSON.stringify({ unit_id: unit.unit_id, as_of_date: asOfDate, generation_id: generationId, note }),
    ],
  );

  revalidatePath(`/keuangan/unit/${encodeURIComponent(unit.code)}/piutang/${asOfDate}`);
}
