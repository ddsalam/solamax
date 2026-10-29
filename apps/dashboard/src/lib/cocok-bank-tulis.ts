import type { PoolClient } from "pg";
import { usulkanSemua, type UsulanCocok } from "./cocok-bank-model";
import { bacaKasId, bacaKonteksCocok, bacaMutasiRekeningKoran } from "./cocok-bank-queries";
import type { ScopedUnitId } from "./scope";

/**
 * Inti TULIS kelompok cocok (rencana 2026-10-29 U10; KTD6, KTD7) — dipanggil
 * DI DALAM transaksi pemanggil, sesudah `set_config('app.unit_ids', …, true)`.
 * Tanpa gerbang wewenang: gerbangnya milik `cocok-bank-actions.ts` /
 * `impor-bank-actions.ts` dan dijalankan SEBELUM BEGIN.
 *
 * ⚠️ Sengaja BUKAN berkas "use server" (pola `antar-unit-tulis.ts`): setiap
 * ekspor berkas seperti itu menjadi endpoint peramban — termasuk fungsi tanpa
 * gerbang di bawah.
 *
 * ⛔ KTD6: tak ada `cash_ledger` yang ditulis di sini — hanya `cocok_bank`,
 * `cocok_bank_baris`, dan `audit_log`.
 */

export interface Aktor {
  userId: number;
  email: string | null;
}

export async function audit(c: PoolClient, aktor: Aktor, action: string, target: string, detail: Record<string, unknown>) {
  await c.query(
    `INSERT INTO app.audit_log (actor_user_id, actor_email, action, target, detail)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [aktor.userId, aktor.email, action, target, JSON.stringify(detail)],
  );
}

/** Satu kelompok + anggotanya. Partial unique 0052 menolak anggota yang sudah di kelompok aktif. */
export async function tulisKelompok(
  c: PoolClient,
  m: { unitId: ScopedUnitId; cara: "otomatis" | "manual"; aktor: Aktor; mutasiIds: readonly string[]; kasIds: readonly string[] },
): Promise<string> {
  const g = await c.query<{ id: string }>(
    `INSERT INTO app.cocok_bank (unit_id, cara, dibuat_by_user_id)
     VALUES ($1, $2, $3)
     RETURNING id::text AS id`,
    [m.unitId, m.cara, m.aktor.userId],
  );
  const id = g.rows[0]?.id;
  if (!id) throw new Error("Kelompok cocok tidak tersimpan.");
  await c.query(
    `INSERT INTO app.cocok_bank_baris (unit_id, cocok_id, mutasi_bank_id, cash_ledger_id)
     SELECT $1, $2::uuid, t.mutasi, t.kas
       FROM unnest($3::uuid[], $4::uuid[]) AS t(mutasi, kas)`,
    [
      m.unitId,
      id,
      [...m.mutasiIds, ...m.kasIds.map(() => null)],
      [...m.mutasiIds.map(() => null), ...m.kasIds],
    ],
  );
  return id;
}

export type HasilOtomatis =
  | {
      ok: true;
      /** Kelompok yang ditulis (cocok tunggal). */
      nOtomatis: number;
      /** Baris yang menunggu pilihan manusia (banyak kandidat / tanpa kandidat / cacat). */
      nBanyak: number;
      nTanpa: number;
      usulan: UsulanCocok[];
    }
  | { ok: false; error: string };

/**
 * "Cocokkan otomatis" satu rekening koran: usulan dihitung atas potret buku
 * SESUDAH rekening koran dikunci, lalu hanya cocok TUNGGAL yang ditulis
 * (KTD7). Rekening koran dikunci `FOR NO KEY UPDATE` — dua pencocok pada
 * rekening koran yang sama berurutan, dan `tarikRekeningKoran` (FOR UPDATE)
 * menunggu. Baris kas yang akan ditautkan dikunci `FOR UPDATE` lalu diperiksa
 * ULANG (non-void, belum di kelompok aktif): yang berubah sejak dibaca
 * dilewati, bukan ditebak.
 *
 * ⚠️ `mutasi_bank` tak bisa dikunci baris: `dashboard_app` sengaja tanpa UPDATE
 * di sana (0051), dan `FOR UPDATE/SHARE` menuntut hak itu. Penguncinya adalah
 * rekening koran induknya + partial unique 0052.
 */
export async function jalankanCocokOtomatis(
  c: PoolClient,
  m: { unitId: ScopedUnitId; unitCode: string; rekeningKoranId: string; aktor: Aktor },
): Promise<HasilOtomatis> {
  const rk = await c.query<{ status: string }>(
    `SELECT status FROM app.rekening_koran
      WHERE id = $1::uuid AND unit_id = $2
      FOR NO KEY UPDATE`,
    [m.rekeningKoranId, m.unitId],
  );
  const st = rk.rows[0]?.status;
  if (st === undefined) return { ok: false, error: "Rekening koran tak ditemukan di unit ini — muat ulang halaman." };
  if (st !== "aktif") return { ok: false, error: "Rekening koran ini sudah ditarik — tak ada yang dicocokkan." };

  const mutasi = await bacaMutasiRekeningKoran(c, m.unitId, m.rekeningKoranId);
  const ktx = await bacaKonteksCocok(c, m.unitId, mutasi);
  const usulan = usulkanSemua(mutasi, ktx);
  const tunggal = usulan.filter((u) => u.jenis === "tunggal");

  // Kunci & periksa ulang baris kas yang akan ditautkan.
  const kasIds = [...new Set(tunggal.map((u) => u.kandidat[0]!.cashLedgerId))].sort();
  const terkunci = kasIds.length === 0 ? [] : await bacaKasId(c, m.unitId, kasIds, true);
  const masihBebas = new Set(terkunci.filter((k) => !k.void && !k.dicocokkan && k.lahirDariCocokId === null).map((k) => k.id));

  let nOtomatis = 0;
  for (const u of tunggal) {
    const kas = u.kandidat[0]!;
    if (!masihBebas.has(kas.cashLedgerId)) continue;
    const id = await tulisKelompok(c, { unitId: m.unitId, cara: "otomatis", aktor: m.aktor, mutasiIds: [u.mutasiId], kasIds: [kas.cashLedgerId] });
    await audit(c, m.aktor, "cocok_bank.otomatis", `${m.unitCode}/${id}`, {
      rekeningKoran: m.rekeningKoranId,
      mutasi: [u.mutasiId],
      kas: [kas.cashLedgerId],
      aturan: kas.aturan,
    });
    nOtomatis += 1;
  }
  const terbuka = usulan.filter((u) => u.tanda !== "pra-cutover" && u.tanda !== "sudah-dicocokkan" && u.tanda !== "ditarik");
  return {
    ok: true,
    nOtomatis,
    nBanyak: terbuka.filter((u) => u.jenis === "banyak").length,
    nTanpa: terbuka.filter((u) => u.jenis === "tanpa").length,
    usulan,
  };
}
