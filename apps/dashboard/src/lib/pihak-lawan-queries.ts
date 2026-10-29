import { qScoped } from "./db";
import {
  KATEGORI_PIHAK_LAWAN,
  teksKeSen,
  type JenisPihakLawan,
  type MutasiPihakLawan,
  type SaldoAwalPihakLawan,
} from "./pihak-lawan-model";
import type { ScopedUnitId } from "./scope";

/**
 * Kueri baca pihak lawan (rencana 2026-10-29 U3). Semuanya lewat `qScoped()`
 * dengan `ScopedUnitId` ber-brand — RLS `unit_scope` 0049 + `unit_id` di WHERE.
 *
 * Nominal dibaca sebagai TEKS lalu diubah ke sen bulat (`teksKeSen`), tidak
 * `::float8`: saldo pihak lawan adalah penjumlahan, dan model murninya
 * membandingkan dalam sen.
 */

export interface PihakLawanRow {
  id: string;
  jenis: JenisPihakLawan;
  nama: string;
  lawanUnitId: number | null;
  aktif: boolean;
  saldoAwal: SaldoAwalPihakLawan | null;
}

export async function getPihakLawan(unit: ScopedUnitId): Promise<PihakLawanRow[]> {
  const rows = await qScoped<{
    id: string;
    jenis: JenisPihakLawan;
    nama: string;
    lawanUnitId: number | null;
    aktif: boolean;
    saTanggal: string | null;
    saAmount: string | null;
    saSementara: boolean | null;
  }>(
    unit,
    `SELECT p.id::text                          AS id,
            p.jenis,
            p.nama,
            p.lawan_unit_id                     AS "lawanUnitId",
            p.aktif,
            to_char(s.tanggal,'YYYY-MM-DD')     AS "saTanggal",
            s.amount::text                      AS "saAmount",
            s.sementara                         AS "saSementara"
       FROM app.pihak_lawan p
       LEFT JOIN app.pihak_lawan_saldo_awal s
              ON s.pihak_lawan_id = p.id AND s.unit_id = p.unit_id AND NOT s.void
      WHERE p.unit_id = $1
      ORDER BY p.jenis, p.nama`,
    [unit],
  );
  return rows.map((r) => ({
    id: r.id,
    jenis: r.jenis,
    nama: r.nama,
    lawanUnitId: r.lawanUnitId,
    aktif: r.aktif,
    saldoAwal:
      r.saTanggal === null || r.saAmount === null
        ? null
        : { tanggal: r.saTanggal, amountSen: teksKeSen(r.saAmount), sementara: r.saSementara === true },
  }));
}

/**
 * Baris kas bertautan pihak lawan SAMPAI DENGAN `to` (business_date). Baris
 * void ikut — model murni yang menyaringnya, seperti `getMutasiKas`.
 */
export async function getMutasiPihakLawan(unit: ScopedUnitId, to: string): Promise<MutasiPihakLawan[]> {
  const rows = await qScoped<{ pihakLawanId: string; businessDate: string; amount: string; void: boolean }>(
    unit,
    `SELECT pihak_lawan_id::text                AS "pihakLawanId",
            to_char(business_date,'YYYY-MM-DD') AS "businessDate",
            amount::text                        AS amount,
            void
       FROM app.cash_ledger
      WHERE unit_id = $1 AND pihak_lawan_id IS NOT NULL AND business_date <= $2::date`,
    [unit, to],
  );
  return rows.map((r) => ({
    pihakLawanId: r.pihakLawanId,
    businessDate: r.businessDate,
    amountSen: teksKeSen(r.amount),
    void: r.void,
  }));
}

export interface BarisTanpaPihakLawan {
  id: string;
  businessDate: string;
  keterangan: string;
  categoryLabel: string;
  akun: string;
  amountSen: number;
}

/**
 * Baris LAMA berkategori pihak lawan yang belum menyebut pihak lawan — lahir
 * sebelum CHECK `NOT VALID` 0049 (KTD3). Inilah daftar kerja "Tetapkan pihak
 * lawan"; ia kosong bila semua sudah diselesaikan.
 */
export async function getBarisTanpaPihakLawan(unit: ScopedUnitId): Promise<BarisTanpaPihakLawan[]> {
  const rows = await qScoped<{
    id: string;
    businessDate: string;
    keterangan: string;
    categoryLabel: string;
    akun: string;
    amount: string;
  }>(
    unit,
    `SELECT l.id::text                            AS id,
            to_char(l.business_date,'YYYY-MM-DD') AS "businessDate",
            l.keterangan,
            l.category_label                      AS "categoryLabel",
            a.nama                                AS akun,
            l.amount::text                        AS amount
       FROM app.cash_ledger l
       JOIN app.cash_account a ON a.id = l.account_id AND a.unit_id = l.unit_id
      WHERE l.unit_id = $1 AND NOT l.void AND l.pihak_lawan_id IS NULL
        AND l.category_label = ANY($2::text[])
      ORDER BY l.business_date, l.created_at`,
    [unit, [...KATEGORI_PIHAK_LAWAN]],
  );
  return rows.map((r) => ({
    id: r.id,
    businessDate: r.businessDate,
    keterangan: r.keterangan,
    categoryLabel: r.categoryLabel,
    akun: r.akun,
    amountSen: teksKeSen(r.amount),
  }));
}
