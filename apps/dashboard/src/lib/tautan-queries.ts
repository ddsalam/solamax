import { qScoped } from "./db";
import { SQL_ME_TAK_BERLAKU } from "./keuangan-berlaku";
import { KATEGORI_BEBAN } from "./keuangan-kas-model";
import { NOMINAL_MANUAL_ENTRY_SQL } from "./manual-entry-nominal";
import { KATEGORI_PENEBUSAN } from "./penebusan-model";
import type { ScopedUnitId } from "./scope";
import type { BebanTautan, KasTautan } from "./tautan-model";

/**
 * Kueri BACA daftar "perlu ditautkan" (rencana K6 U3; R27). Pemilahan ke tiga
 * daftar milik `tautan-model.ts` (murni); di sini hanya pengambilan calon.
 *
 * Batas bawah = cut-over: baris kas sejak saldo pembuka REKENINGNYA, baris
 * Biaya sejak cut-over terawal unit (sumber yang sama dengan
 * `hariBukuTerkunci`). Unit tanpa saldo pembuka ⇒ daftar kosong — belum ada
 * buku kas untuk ditautkan. Baris bulan tertutup ikut terbaca (ditandai), tapi
 * tindakannya ditolak model dan server.
 */

const LABEL_KAS = [...Object.keys(KATEGORI_BEBAN), KATEGORI_PENEBUSAN];

export async function getKasTautan(unit: ScopedUnitId): Promise<KasTautan[]> {
  return qScoped<KasTautan>(
    unit,
    `WITH cut AS (
       SELECT account_id, min(business_date) AS d
         FROM app.cash_ledger
        WHERE unit_id = $1 AND saldo_awal AND NOT void
        GROUP BY account_id
     )
     SELECT l.id::text AS id, l.account_id::text AS "accountId", a.nama AS "namaAkun", a.kind::text AS "kindAkun",
            to_char(l.business_date,'YYYY-MM-DD') AS "businessDate", l.keterangan,
            l.category_label AS "categoryLabel", l.amount::float8 AS amount, l.void,
            EXISTS (SELECT 1 FROM app.manual_entry m
                     WHERE m.cash_ledger_id = l.id AND m.unit_id = l.unit_id AND NOT ${SQL_ME_TAK_BERLAKU("m")}) AS "bebanAktif",
            EXISTS (SELECT 1 FROM app.penebusan p
                     WHERE p.cash_ledger_id = l.id AND p.unit_id = l.unit_id AND NOT p.void) AS "penebusanAktif",
            EXISTS (SELECT 1 FROM app.tutup_bulan t
                     WHERE t.unit_id = l.unit_id AND t.bulan = date_trunc('month', l.business_date)::date) AS "bulanTertutup"
       FROM app.cash_ledger l
       JOIN app.cash_account a ON a.id = l.account_id AND a.unit_id = l.unit_id
       JOIN cut ON cut.account_id = l.account_id
      WHERE l.unit_id = $1 AND NOT l.void AND NOT l.saldo_awal
        AND l.business_date >= cut.d
        AND l.category_label = ANY($2::text[])
      ORDER BY l.business_date, l.created_at`,
    [unit, LABEL_KAS],
  );
}

export async function getBebanTautan(unit: ScopedUnitId): Promise<BebanTautan[]> {
  return qScoped<BebanTautan>(
    unit,
    `SELECT m.id::text AS id, to_char(m.business_date,'YYYY-MM-DD') AS "businessDate",
            m.section::text AS section, m.source_door AS "sourceDoor", m.keterangan,
            ${NOMINAL_MANUAL_ENTRY_SQL}::float8 AS amount,
            m.operational_category AS "operationalCategory", m.void,
            m.cash_ledger_id::text AS "cashLedgerId",
            EXISTS (SELECT 1 FROM app.day_close d
                     WHERE d.unit_id = m.unit_id AND d.business_date = m.business_date
                       AND d.status = 'closed') AS "hariTertutup",
            EXISTS (SELECT 1 FROM app.tutup_bulan t
                     WHERE t.unit_id = m.unit_id AND t.bulan = date_trunc('month', m.business_date)::date) AS "bulanTertutup"
       FROM app.manual_entry m
      WHERE m.unit_id = $1 AND NOT ${SQL_ME_TAK_BERLAKU("m")} AND m.source_door = 'finance' AND m.cash_ledger_id IS NULL
        AND m.section IN ('pengeluaran','pendapatan_lain')
        AND m.business_date >= (SELECT min(business_date) FROM app.cash_ledger
                                 WHERE unit_id = $1 AND saldo_awal AND NOT void)
      ORDER BY m.business_date, m.urut`,
    [unit],
  );
}
