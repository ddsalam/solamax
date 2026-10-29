import type { PoolClient } from "pg";
import { senKeTeks } from "./antar-unit-model";
import type { RekeningKoran } from "./impor-bank-parser";
import type { ScopedUnitId } from "./scope";

/**
 * Inti TULIS impor rekening koran (rencana 2026-10-29 U9 langkah 4; U13 uji
 * ulang) — satu rekening koran + barisnya, DI DALAM transaksi pemanggil
 * sesudah `set_config('app.unit_ids', …, true)`.
 *
 * ⚠️ Sengaja BUKAN berkas "use server" (pola `cocok-bank-tulis.ts`): fungsi tanpa
 * gerbang wewenang. Gerbangnya milik `impor-bank-actions.ts`.
 *
 * Satu-satunya salinan SQL insert impor: dipakai `unggahRekeningKoran` (langkah 4)
 * dan skrip uji ulang (`scripts/uji-ulang-rekening-koran.ts`, yang tak punya sesi
 * Auth.js).
 *
 * ⛔ TIDAK menulis `cash_ledger` (KTD6).
 */
export async function simpanRekeningKoran(
  c: PoolClient,
  m: {
    unitId: ScopedUnitId;
    accountId: string;
    /** Hari pertama periode, `YYYY-MM-01` (`periodeAwal`). */
    hariPertama: string;
    rk: RekeningKoran;
    sha256: string;
    /** Per baris `rk.rows` — `tentukanHariBuku(...).status === "pra-cut-over"`. */
    pra: readonly boolean[];
    userId: number;
  },
): Promise<string> {
  const { rk } = m;
  if (m.pra.length !== rk.rows.length) throw new Error("Penanda pra-cut-over tidak sepanjang baris rekening koran.");
  const ins = await c.query<{ id: string }>(
    `INSERT INTO app.rekening_koran
       (unit_id, account_id, periode, saldo_awal, saldo_akhir, total_cr, n_cr, total_db, n_db,
        file_sha256, uploaded_by_user_id)
     VALUES ($1, $2::uuid, $3::date, $4::numeric, $5::numeric, $6::numeric, $7, $8::numeric, $9, $10, $11)
     RETURNING id::text AS id`,
    [
      m.unitId,
      m.accountId,
      m.hariPertama,
      senKeTeks(rk.saldoAwalSen),
      senKeTeks(rk.footer.saldoAkhirSen),
      senKeTeks(rk.footer.mutasiCrSen),
      rk.footer.nCr,
      senKeTeks(rk.footer.mutasiDbSen),
      rk.footer.nDb,
      m.sha256,
      m.userId,
    ],
  );
  const rekeningKoranId = ins.rows[0]?.id;
  if (!rekeningKoranId) throw new Error("Rekening koran tidak tersimpan.");

  if (rk.rows.length > 0) {
    await c.query(
      `INSERT INTO app.mutasi_bank
         (unit_id, rekening_koran_id, account_id, tanggal_bank, urutan, keterangan, amount,
          saldo_setelah, so, dok_ref, pra_cutover)
       SELECT $1, $2::uuid, $3::uuid, t.tanggal, t.urutan, t.keterangan, t.amount, t.saldo, t.so, t.dok, t.pra
         FROM unnest($4::date[], $5::int[], $6::text[], $7::numeric[], $8::numeric[], $9::text[], $10::text[], $11::bool[])
              AS t(tanggal, urutan, keterangan, amount, saldo, so, dok, pra)`,
      [
        m.unitId,
        rekeningKoranId,
        m.accountId,
        rk.rows.map((r) => r.tanggal),
        rk.rows.map((r) => r.urutan),
        rk.rows.map((r) => r.keterangan),
        rk.rows.map((r) => senKeTeks(r.amountSen)),
        rk.rows.map((r) => (r.saldoSen === null ? null : senKeTeks(r.saldoSen))),
        rk.rows.map((r) => r.so),
        rk.rows.map((r) => r.dokRef),
        [...m.pra],
      ],
    );
  }
  return rekeningKoranId;
}
