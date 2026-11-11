import { MULAI_BUKU_BESAR } from "./buku-besar-bulan";
import { KATEGORI_SETORAN } from "./cocok-bank-model";
import { qScoped } from "./db";
import { teksKeSen } from "./pihak-lawan-model";
import type { ScopedUnitId } from "./scope";
import {
  KATEGORI_KELUAR_KAS_BESAR,
  kandidatJadikanTransfer,
  type BarisBankKoreksi,
  type BarisKasBesar,
} from "./transfer-kas-model";

/**
 * Jalur BACA daftar koreksi "Jadikan transfer" (rencana 2026-11-11 U6; R15).
 * Sejak `MULAI_BUKU_BESAR` — baris lebih tua tak dijurnal, jadi tak
 * mengkredit 1103 dua kali. Penilaiannya milik `kandidatJadikanTransfer`
 * (murni); berkas ini hanya menyediakan bahannya + keterangan tampilan.
 */

export interface BarisKoreksiTampil {
  bankId: string;
  tanggal: string;
  namaBank: string;
  nominalSen: number;
  keterangan: string;
  hariTutup: boolean;
  bulanTutup: boolean;
  dicocokkan: boolean;
}

export interface KoreksiSiap extends BarisKoreksiTampil {
  kasId: string;
  kasKategori: string;
  kasKeterangan: string;
  catatan: string | null;
}

export interface KoreksiManual extends BarisKoreksiTampil {
  alasan: string;
}

interface Bank {
  id: string;
  accountId: string;
  namaBank: string;
  tanggal: string;
  kategori: string | null;
  amount: string;
  keterangan: string;
  dibuat: string;
  dariSetoranPengawas: boolean;
  dicocokkan: boolean;
}

interface Kas {
  id: string;
  tanggal: string;
  kategori: string | null;
  amount: string;
  keterangan: string;
  dicocokkan: boolean;
}

export async function getKoreksiTransfer(unit: ScopedUnitId): Promise<{ siap: KoreksiSiap[]; periksaManual: KoreksiManual[] }> {
  const [bank, kas, tutupHari, tutupBulan] = await Promise.all([
    qScoped<Bank>(
      unit,
      `SELECT l.id::text AS id, l.account_id::text AS "accountId", a.nama AS "namaBank",
              to_char(l.business_date,'YYYY-MM-DD') AS tanggal, l.category_label AS kategori,
              l.amount::text AS amount, l.keterangan, l.created_at::text AS dibuat,
              (l.source_manual_entry_id IS NOT NULL) AS "dariSetoranPengawas",
              EXISTS (
                SELECT 1 FROM app.cocok_bank_baris b
                 WHERE b.cash_ledger_id = l.id AND b.unit_id = l.unit_id AND b.aktif
              ) AS dicocokkan
         FROM app.cash_ledger l
         JOIN app.cash_account a ON a.id = l.account_id AND a.unit_id = l.unit_id
        WHERE l.unit_id = $1 AND a.kind = 'bank' AND l.jenis = 'debet'
          AND l.category_label = $2 AND NOT l.void AND l.transfer_uuid IS NULL
          AND l.business_date >= $3::date`,
      [unit, KATEGORI_SETORAN, MULAI_BUKU_BESAR],
    ),
    qScoped<Kas>(
      unit,
      `SELECT l.id::text AS id, to_char(l.business_date,'YYYY-MM-DD') AS tanggal, l.category_label AS kategori,
              l.amount::text AS amount, l.keterangan,
              EXISTS (
                SELECT 1 FROM app.cocok_bank_baris b
                 WHERE b.cash_ledger_id = l.id AND b.unit_id = l.unit_id AND b.aktif
              ) AS dicocokkan
         FROM app.cash_ledger l
         JOIN app.cash_account a ON a.id = l.account_id AND a.unit_id = l.unit_id
        WHERE l.unit_id = $1 AND a.kind = 'kas' AND l.jenis = 'kredit'
          AND l.category_label = ANY($2::text[]) AND NOT l.void AND l.transfer_uuid IS NULL
          AND l.business_date >= $3::date`,
      [unit, KATEGORI_KELUAR_KAS_BESAR, MULAI_BUKU_BESAR],
    ),
    qScoped<{ d: string }>(
      unit,
      `SELECT to_char(business_date,'YYYY-MM-DD') AS d FROM app.day_close
        WHERE unit_id = $1 AND status = 'closed' AND business_date >= $2::date`,
      [unit, MULAI_BUKU_BESAR],
    ),
    qScoped<{ b: string }>(
      unit,
      `SELECT to_char(bulan,'YYYY-MM') AS b FROM app.tutup_bulan WHERE unit_id = $1`,
      [unit],
    ),
  ]);

  const hariTutup = new Set(tutupHari.map((r) => r.d));
  const bulanTutup = new Set(tutupBulan.map((r) => r.b));
  const bankRows: BarisBankKoreksi[] = bank.map((b) => ({
    id: b.id,
    accountId: b.accountId,
    tanggal: b.tanggal,
    kategori: b.kategori,
    amountSen: teksKeSen(b.amount),
    transferUuid: null,
    void: false,
    dibuat: b.dibuat,
    dariSetoranPengawas: b.dariSetoranPengawas,
  }));
  const kasRows: BarisKasBesar[] = kas.map((k) => ({
    id: k.id,
    tanggal: k.tanggal,
    kategori: k.kategori,
    amountSen: teksKeSen(k.amount),
    transferUuid: null,
    void: false,
  }));
  const bankPer = new Map(bank.map((b) => [b.id, b]));
  const kasPer = new Map(kas.map((k) => [k.id, k]));
  const tampil = (b: BarisBankKoreksi): BarisKoreksiTampil => {
    const x = bankPer.get(b.id)!;
    return {
      bankId: b.id,
      tanggal: b.tanggal,
      namaBank: x.namaBank,
      nominalSen: b.amountSen,
      keterangan: x.keterangan,
      hariTutup: hariTutup.has(b.tanggal),
      bulanTutup: bulanTutup.has(b.tanggal.slice(0, 7)),
      dicocokkan: x.dicocokkan,
    };
  };

  const hasil = kandidatJadikanTransfer(bankRows, kasRows);
  return {
    siap: hasil.siap.map((s) => {
      const k = kasPer.get(s.kas.id)!;
      const t = tampil(s.bank);
      return {
        ...t,
        dicocokkan: t.dicocokkan || k.dicocokkan,
        kasId: k.id,
        kasKategori: k.kategori ?? "",
        kasKeterangan: k.keterangan,
        catatan: s.catatan,
      };
    }),
    periksaManual: hasil.periksaManual.map((p) => ({ ...tampil(p.bank), alasan: p.alasan })),
  };
}
