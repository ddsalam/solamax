import { qScoped } from "./db";
import type { RingkasRekeningKoran, SaldoBukuAwal } from "./impor-bank-model";
import { teksKeSen } from "./pihak-lawan-model";
import type { ScopedUnitId } from "./scope";

/**
 * Kueri impor rekening koran (rencana 2026-10-29 U9; R17–R19, R22). SQL yang
 * dipakai BERSAMA server action (di dalam transaksinya) dan halaman (lewat
 * `qScoped`) hidup di sini sebagai konstanta — satu rumus, bukan dua salinan
 * yang kelak berselisih.
 */

/**
 * Rekening BCA yang wajib & boleh diimpor: rekening BANK aktif bernomor
 * (KTD13) yang namanya "Bank BCA - …" (pola nama yang ditegakkan form,
 * `^Bank\s+.+\s-\s*\d+$`). Bank lain tetap diketik manual sampai ada contoh
 * berkasnya (Scope Boundaries) — tanpa saringan nama, rekening BRI ikut
 * dituntut impornya oleh tutup bulan (R25, U12). Fragmen atas `app.cash_account`
 * tanpa alias.
 */
export const POLA_NAMA_BCA = String.raw`^Bank\s+BCA\M`;
export const PREDIKAT_REKENING_BCA = `kind = 'bank' AND active AND nomor_rekening IS NOT NULL AND nama ~* '${POLA_NAMA_BCA}'`;

/**
 * Cut-over yang berlaku untuk sebuah rekening — SAMA dengan `hariBukuTerkunci`
 * (§10.24 butir 2, §10.26): saldo pembuka rekening itu, jatuh ke cut-over
 * terawal unit bila rekening belum punya. $1 unit, $2 rekening.
 */
export const SQL_CUT_OVER = `SELECT to_char(min(business_date), 'YYYY-MM-DD') AS unit,
            to_char(min(business_date) FILTER (WHERE account_id = $2::uuid), 'YYYY-MM-DD') AS akun
       FROM app.cash_ledger
      WHERE unit_id = $1 AND saldo_awal AND NOT void`;

/**
 * R18 — saldo buku rekening pada AWAL hari $3 (hari pertama periode), MENURUT
 * TANGGAL ASAL: saldo pembuka rekening + Σ baris non-void yang tanggal asalnya
 * (atau hari bukunya bila tidak terdorong) ∈ [cut-over, $3). Baris bulan lalu
 * yang dibukukan maju ke bulan ini dihitung pada tanggal asalnya, jadi impor
 * susulan tidak menimbulkan selisih rutin. Nol baris = rekening tanpa saldo
 * pembuka. $1 unit, $2 rekening, $3 hari pertama periode.
 */
export const SQL_SALDO_BUKU_AWAL = `WITH sa AS (
       SELECT business_date, amount, saldo_awal_sementara
         FROM app.cash_ledger
        WHERE unit_id = $1 AND account_id = $2::uuid AND saldo_awal AND NOT void
        ORDER BY business_date, created_at
        LIMIT 1
     )
     SELECT to_char(sa.business_date, 'YYYY-MM-DD') AS "cutOver",
            sa.saldo_awal_sementara AS sementara,
            (sa.amount + COALESCE((
               SELECT sum(l.amount)
                 FROM app.cash_ledger l
                WHERE l.unit_id = $1 AND l.account_id = $2::uuid AND NOT l.void AND NOT l.saldo_awal
                  AND COALESCE(l.tanggal_asal, l.business_date) >= sa.business_date
                  AND COALESCE(l.tanggal_asal, l.business_date) < $3::date
             ), 0))::text AS saldo
       FROM sa`;

export type BarisSaldoBuku = { cutOver: string; saldo: string; sementara: boolean };

export function keSaldoBukuAwal(r: BarisSaldoBuku | undefined): SaldoBukuAwal | null {
  return r ? { cutOver: r.cutOver, saldoSen: teksKeSen(r.saldo), sementara: r.sementara } : null;
}

export async function getSaldoBukuAwal(unit: ScopedUnitId, accountId: string, hariPertama: string): Promise<SaldoBukuAwal | null> {
  const [r] = await qScoped<BarisSaldoBuku>(unit, SQL_SALDO_BUKU_AWAL, [unit, accountId, hariPertama]);
  return keSaldoBukuAwal(r);
}

export interface RekeningBca {
  id: string;
  nama: string;
  nomorRekening: string;
  /** Cut-over rekening (atau unit) — `null` bila belum ada saldo pembuka. */
  cutOver: string | null;
}

export async function getRekeningBca(unit: ScopedUnitId): Promise<RekeningBca[]> {
  return qScoped<RekeningBca>(
    unit,
    `SELECT id::text AS id, nama, nomor_rekening AS "nomorRekening",
            to_char(COALESCE(
              (SELECT min(l.business_date) FROM app.cash_ledger l
                WHERE l.unit_id = cash_account.unit_id AND l.account_id = cash_account.id
                  AND l.saldo_awal AND NOT l.void),
              (SELECT min(l.business_date) FROM app.cash_ledger l
                WHERE l.unit_id = cash_account.unit_id AND l.saldo_awal AND NOT l.void)
            ), 'YYYY-MM-DD') AS "cutOver"
       FROM app.cash_account
      WHERE unit_id = $1 AND ${PREDIKAT_REKENING_BCA}
      ORDER BY nama`,
    [unit],
  );
}

export interface RekeningKoranTampil extends RingkasRekeningKoran {
  accountId: string;
  /** `YYYY-MM`. */
  periode: string;
  saldoAwalSen: number;
}

/** Semua rekening koran unit (aktif & ditarik) dengan hitungan barisnya. */
export async function getRekeningKoranUnit(unit: ScopedUnitId): Promise<RekeningKoranTampil[]> {
  const rows = await qScoped<{
    id: string;
    accountId: string;
    periode: string;
    status: "aktif" | "ditarik";
    saldoAwal: string;
    nBaris: number;
    nPraCutover: number;
    uploadedAt: string;
  }>(
    unit,
    `SELECT r.id::text AS id, r.account_id::text AS "accountId",
            to_char(r.periode, 'YYYY-MM') AS periode, r.status, r.saldo_awal::text AS "saldoAwal",
            (SELECT count(*)::int FROM app.mutasi_bank m
              WHERE m.rekening_koran_id = r.id AND m.unit_id = r.unit_id) AS "nBaris",
            (SELECT count(*)::int FROM app.mutasi_bank m
              WHERE m.rekening_koran_id = r.id AND m.unit_id = r.unit_id AND m.pra_cutover) AS "nPraCutover",
            to_char(r.uploaded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "uploadedAt"
       FROM app.rekening_koran r
      WHERE r.unit_id = $1
      ORDER BY r.periode, r.uploaded_at`,
    [unit],
  );
  return rows.map(({ saldoAwal, ...r }) => ({ ...r, saldoAwalSen: teksKeSen(saldoAwal) }));
}
