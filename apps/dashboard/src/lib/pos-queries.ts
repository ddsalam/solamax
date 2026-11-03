import { qScoped } from "./db";
import type { JenisPos, Pos, RujukanPos } from "./pos-model";
import type { ScopedUnitId } from "./scope";

/**
 * Kueri baca daftar pos (rencana 2026-11-02 K6 U1). Semuanya lewat `qScoped()`
 * dengan `ScopedUnitId` ber-brand: `app.pos` dan `app.pos_kode_lama` global
 * (tanpa RLS), `app.pos_unit` ber-RLS `unit_scope` (0056) + `unit_id` di WHERE.
 *
 * SQL di sini diekspor juga untuk aksi (`pos-actions.ts`), yang membacanya
 * ulang DI DALAM transaksinya sebelum memutuskan — satu bentuk baca, bukan dua.
 */

interface BarisPos {
  id: string | null;
  kode: string;
  nama: string;
  jenis: JenisPos;
  induk: boolean;
  kodeInduk: string | null;
  pengurang: boolean;
  kliring: boolean;
  sistem: boolean;
  unitId: number | null;
  cashAccountId: string | null;
}

/**
 * Pos resmi + sub-pos SATU unit ($1). Jenis sub-pos = jenis induknya. Nama
 * sub-pos bank mengikuti nama rekening yang berlaku (Ubah nama di Kelola akun
 * kas), bukan salinan saat ia lahir.
 */
export const SQL_DAFTAR_POS = `
  SELECT NULL::text        AS id,
         p.kode, p.nama, p.jenis, p.induk,
         p.kode_induk      AS "kodeInduk",
         p.pengurang, p.kliring, p.sistem,
         NULL::int         AS "unitId",
         NULL::text        AS "cashAccountId"
    FROM app.pos p
  UNION ALL
  SELECT u.id::text,
         u.kode, COALESCE(a.nama, u.nama), i.jenis, false,
         u.kode_induk,
         false, false, false,
         u.unit_id::int,
         u.cash_account_id::text
    FROM app.pos_unit u
    JOIN app.pos i ON i.kode = u.kode_induk
    LEFT JOIN app.cash_account a ON a.id = u.cash_account_id AND a.unit_id = u.unit_id
   WHERE u.unit_id = $1
  ORDER BY kode`;

export function barisKePos(r: BarisPos): Pos {
  return {
    id: r.id,
    kode: r.kode,
    nama: r.nama,
    jenis: r.jenis,
    induk: r.induk,
    kodeInduk: r.kodeInduk,
    pengurang: r.pengurang,
    kliring: r.kliring,
    sistem: r.sistem,
    unitId: r.unitId,
    cashAccountId: r.cashAccountId,
  };
}

export async function getDaftarPos(unit: ScopedUnitId): Promise<Pos[]> {
  const rows = await qScoped<BarisPos>(unit, SQL_DAFTAR_POS, [unit]);
  return rows.map(barisKePos);
}

/** Kode lama → kode pos (KTD2). */
export async function getKodeLama(unit: ScopedUnitId): Promise<Map<string, string>> {
  const rows = await qScoped<{ kodeLama: string; posKode: string }>(
    unit,
    `SELECT kode_lama AS "kodeLama", pos_kode AS "posKode" FROM app.pos_kode_lama ORDER BY kode_lama`,
  );
  return new Map(rows.map((r) => [r.kodeLama, r.posKode]));
}

/**
 * Rujukan satu kode pos di unit $1 ($2 = kode) — yang menahan penghapusan (R4).
 *
 *   · peta      — baris peta kategori ber-unit ini yang menunjuk kode itu;
 *   · jurnal    — baris jurnal (0058) + catatan sumber yang SUDAH menyimpan kode
 *                 ini (manual_entry, noncash_expense, reclassification): mereka
 *                 menjadi jurnal saat buku besar dibentuk;
 *   · saldoAwal — baris saldo awal pos aktif (0058).
 */
export const SQL_RUJUKAN_POS = `
  SELECT (SELECT count(*) FROM app.category_account_map m
           WHERE m.unit_id = $1 AND m.accounting_account = $2)::int AS peta,
         ((SELECT count(*) FROM app.manual_entry e
            WHERE e.unit_id = $1 AND e.accounting_account = $2)
        + (SELECT count(*) FROM app.noncash_expense n
            WHERE n.unit_id = $1 AND n.accounting_account = $2)
        + (SELECT count(*) FROM app.reclassification r
            WHERE r.unit_id = $1 AND (r.to_account = $2 OR r.from_account = $2))
        + (SELECT count(*) FROM app.jurnal_baris b
            WHERE b.unit_id = $1 AND b.pos_kode = $2))::int AS jurnal,
         (SELECT count(*) FROM app.saldo_awal_pos s
           WHERE s.unit_id = $1 AND s.pos_kode = $2 AND NOT s.void)::int AS "saldoAwal"`;

/** Rujukan setiap sub-pos unit (tanpa sub-pos bank: itu tak pernah dihapus di sini). */
export async function getRujukanSubPos(unit: ScopedUnitId, kode: readonly string[]): Promise<Map<string, RujukanPos>> {
  const out = new Map<string, RujukanPos>();
  for (const k of kode) {
    const [r] = await qScoped<RujukanPos>(unit, SQL_RUJUKAN_POS, [unit, k]);
    if (r) out.set(k, r);
  }
  return out;
}
