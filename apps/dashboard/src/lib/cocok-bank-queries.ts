import { qScoped } from "./db";
import {
  usulkanSemua,
  type KasCocok,
  type KonteksCocok,
  type MutasiCocok,
  type PenebusanCocok,
  type RekeningUnit,
  type UsulanCocok,
  JENDELA_HARI,
} from "./cocok-bank-model";
import { normalisasiSo } from "./penebusan-model";
import { addDays } from "./periods";
import { teksKeSen } from "./pihak-lawan-model";
import type { ScopedUnitId } from "./scope";

/**
 * Kueri mesin cocok (rencana 2026-10-29 U10; R19, R20; KTD6, KTD7). SQL yang
 * dipakai BERSAMA server action (di dalam transaksinya, lewat `PoolClient`) dan
 * halaman (lewat `qScoped`) hidup di sini — satu rumus, bukan dua salinan.
 * Sengaja BUKAN berkas "use server".
 *
 * "Dicocokkan" SELALU berarti: anggota kelompok cocok AKTIF (`b.aktif`, cermin
 * FK 0052) — satu predikat, {@link PREDIKAT_KAS_DICOCOKKAN}.
 */

/** Pembaca minimal — `PoolClient` memenuhinya; `kueriScoped` membungkus `qScoped`. */
export interface Kueri {
  query<T extends object>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export function kueriScoped(unit: ScopedUnitId): Kueri {
  return {
    query: async <T extends object>(sql: string, params: unknown[] = []) => ({ rows: await qScoped<T>(unit, sql, params) }),
  };
}

/** Fragmen atas `app.cash_ledger l`: baris kas ini di kelompok cocok AKTIF. */
export const PREDIKAT_KAS_DICOCOKKAN = `EXISTS (SELECT 1 FROM app.cocok_bank_baris b
              WHERE b.cash_ledger_id = l.id AND b.unit_id = l.unit_id AND b.aktif)`;

/** Fragmen atas `app.mutasi_bank m`: baris impor ini di kelompok cocok AKTIF. */
export const PREDIKAT_MUTASI_DICOCOKKAN = `EXISTS (SELECT 1 FROM app.cocok_bank_baris b
              WHERE b.mutasi_bank_id = m.id AND b.unit_id = m.unit_id AND b.aktif)`;

const KOLOM_MUTASI = `m.id::text AS id, m.account_id::text AS "accountId",
            to_char(m.tanggal_bank, 'YYYY-MM-DD') AS "tanggalBank", m.keterangan,
            m.amount::text AS amount, m.so, m.dok_ref AS "dokRef", m.pra_cutover AS "praCutover",
            m.rk_status AS "rkStatus", m.rekening_koran_id::text AS "rekeningKoranId",
            ${PREDIKAT_MUTASI_DICOCOKKAN} AS dicocokkan`;

/** Baris impor satu rekening koran. $1 unit, $2 rekening koran. */
export const SQL_MUTASI_REKENING_KORAN = `SELECT ${KOLOM_MUTASI}
       FROM app.mutasi_bank m
      WHERE m.unit_id = $1 AND m.rekening_koran_id = $2::uuid
      ORDER BY m.tanggal_bank, m.urutan`;

/** Baris impor menurut id. $1 unit, $2 uuid[]. */
export const SQL_MUTASI_ID = `SELECT ${KOLOM_MUTASI}
       FROM app.mutasi_bank m
      WHERE m.unit_id = $1 AND m.id = ANY($2::uuid[])
      ORDER BY m.tanggal_bank, m.urutan`;

const KOLOM_KAS = `l.id::text AS id, l.account_id::text AS "accountId",
            to_char(l.business_date, 'YYYY-MM-DD') AS "businessDate",
            to_char(l.tanggal_asal, 'YYYY-MM-DD') AS "tanggalAsal",
            l.amount::text AS amount, l.keterangan, l.category_label AS "categoryLabel",
            l.void, l.saldo_awal AS "saldoAwal", l.edc_settlement_id::text AS "edcSettlementId",
            to_char(s.settlement_date, 'YYYY-MM-DD') AS "edcSettlementDate",
            l.pasangan_uuid::text AS "pasanganUuid", l.lahir_dari_cocok_id::text AS "lahirDariCocokId",
            ${PREDIKAT_KAS_DICOCOKKAN} AS dicocokkan`;

/**
 * Baris kas KANDIDAT unit ini (semua rekening — pindah buku sendiri memeriksa
 * kaki di rekening seberang): non-void, bukan saldo awal, dengan hari buku
 * ATAU tanggal asal di [$2, $3], ditambah baris yang disebut id-nya ($4 —
 * kas penebusan bisa bertanggal di luar jendela). $1 unit.
 */
export const SQL_KAS_KANDIDAT = `SELECT ${KOLOM_KAS}
       FROM app.cash_ledger l
       LEFT JOIN app.edc_settlement s ON s.id = l.edc_settlement_id AND s.unit_id = l.unit_id
      WHERE l.unit_id = $1 AND NOT l.void AND NOT l.saldo_awal
        AND (l.business_date BETWEEN $2::date AND $3::date
             OR COALESCE(l.tanggal_asal, l.business_date) BETWEEN $2::date AND $3::date
             OR l.id = ANY($4::uuid[]))`;

/** Baris kas menurut id — termasuk void/saldo awal supaya penolakannya bernama. $1 unit, $2 uuid[]. */
export const SQL_KAS_ID = `SELECT ${KOLOM_KAS}
       FROM app.cash_ledger l
       LEFT JOIN app.edc_settlement s ON s.id = l.edc_settlement_id AND s.unit_id = l.unit_id
      WHERE l.unit_id = $1 AND l.id = ANY($2::uuid[])
      ORDER BY l.id`;

/** Penebusan AKTIF ber-SO tertentu ATAU memiliki baris kas tertentu. $1 unit, $2 text[], $3 uuid[]. */
export const SQL_PENEBUSAN_COCOK = `SELECT id::text AS id, no_so AS "noSo", cash_ledger_id::text AS "cashLedgerId"
       FROM app.penebusan
      WHERE unit_id = $1 AND NOT void
        AND (no_so = ANY($2::text[]) OR cash_ledger_id = ANY($3::uuid[]))`;

/** Rekening bank yang TERDAFTAR di unit ini (KTD13) — aktif maupun ditutup. $1 unit. */
export const SQL_REKENING_UNIT = `SELECT id::text AS id, nomor_rekening AS "nomorRekening"
       FROM app.cash_account
      WHERE unit_id = $1 AND kind = 'bank'`;

type BarisMutasi = Omit<MutasiCocok, "amountSen"> & { amount: string; rekeningKoranId: string; dicocokkan: boolean };
type BarisKas = Omit<KasCocok, "amountSen"> & { amount: string; dicocokkan: boolean };

export type MutasiTerbaca = MutasiCocok & { rekeningKoranId: string; dicocokkan: boolean };
export type KasTerbaca = KasCocok & { dicocokkan: boolean };

export const keMutasi = ({ amount, ...r }: BarisMutasi): MutasiTerbaca => ({ ...r, amountSen: teksKeSen(amount) });
export const keKas = ({ amount, ...r }: BarisKas): KasTerbaca => ({ ...r, amountSen: teksKeSen(amount) });

export async function bacaMutasiRekeningKoran(c: Kueri, unitId: number, rekeningKoranId: string): Promise<MutasiTerbaca[]> {
  return (await c.query<BarisMutasi>(SQL_MUTASI_REKENING_KORAN, [unitId, rekeningKoranId])).rows.map(keMutasi);
}

export async function bacaMutasiId(c: Kueri, unitId: number, ids: readonly string[]): Promise<MutasiTerbaca[]> {
  return (await c.query<BarisMutasi>(SQL_MUTASI_ID, [unitId, ids])).rows.map(keMutasi);
}

export async function bacaKasId(c: Kueri, unitId: number, ids: readonly string[], kunci = false): Promise<KasTerbaca[]> {
  const sql = kunci ? `${SQL_KAS_ID}\n      FOR UPDATE OF l` : SQL_KAS_ID;
  return (await c.query<BarisKas>(sql, [unitId, ids])).rows.map(keKas);
}

/**
 * Potret buku untuk mesin cocok atas sekumpulan baris impor: kandidat kas di
 * jendela [tanggal bank terawal − 3, tanggal bank terakhir], penebusan ber-SO
 * yang disebut + penebusan pemilik kandidat (supaya kas penebusan TIDAK pernah
 * jadi kandidat ketikan), kas penebusan di luar jendela, dan rekening unit.
 */
export async function bacaKonteksCocok(
  c: Kueri,
  unitId: number,
  mutasi: readonly MutasiTerbaca[],
  opsi: { paralel?: boolean } = {},
): Promise<KonteksCocok> {
  const mutasiDicocokkan = new Set(mutasi.filter((m) => m.dicocokkan).map((m) => m.id));
  const bacaRekening = async () => (await c.query<RekeningUnit>(SQL_REKENING_UNIT, [unitId])).rows;
  if (mutasi.length === 0) {
    return { kas: [], penebusan: [], rekening: await bacaRekening(), kasDicocokkan: new Set(), mutasiDicocokkan };
  }

  const tanggal = mutasi.map((m) => m.tanggalBank).sort();
  const dari = addDays(tanggal[0]!, -JENDELA_HARI);
  const sampai = tanggal[tanggal.length - 1]!;
  const sos = [...new Set(mutasi.flatMap((m) => (m.so === null ? [] : [normalisasiSo(m.so)])))];

  const bacaKas = async () => (await c.query<BarisKas>(SQL_KAS_KANDIDAT, [unitId, dari, sampai, []])).rows.map(keKas);
  // ⚠️ `paralel` HANYA untuk pembaca ber-scope (`kueriScoped`, satu koneksi per
  //    kueri). Klien transaksi (`PoolClient`) tak boleh menerima dua kueri
  //    bersamaan ⇒ jalur transaksi tetap berurutan.
  let rekening: RekeningUnit[];
  let kas: KasTerbaca[];
  if (opsi.paralel) {
    [rekening, kas] = await Promise.all([bacaRekening(), bacaKas()]);
  } else {
    rekening = await bacaRekening();
    kas = await bacaKas();
  }
  const penebusan = (
    await c.query<PenebusanCocok>(SQL_PENEBUSAN_COCOK, [unitId, sos, kas.map((k) => k.id)])
  ).rows;
  const ada = new Set(kas.map((k) => k.id));
  const kurang = penebusan.map((p) => p.cashLedgerId).filter((id) => !ada.has(id));
  if (kurang.length > 0) kas = [...kas, ...(await bacaKasId(c, unitId, kurang))];

  return {
    kas,
    penebusan,
    rekening,
    kasDicocokkan: new Set(kas.filter((k) => k.dicocokkan).map((k) => k.id)),
    mutasiDicocokkan,
  };
}

// ---------------------------------------------------------------------------
// Halaman (U11 memakai ini untuk layar klasifikasi; U10 tidak membuat halaman)
// ---------------------------------------------------------------------------

export interface UsulanRekeningKoran {
  mutasi: MutasiTerbaca[];
  usulan: UsulanCocok[];
  /** Kas yang disebut usulan (kandidat & rujukan cacat), per id. */
  kas: Record<string, KasTerbaca>;
}

/** Kandidat per baris impor satu rekening koran — vonis yang SAMA dengan aksi otomatis. */
export async function getUsulanRekeningKoran(unit: ScopedUnitId, rekeningKoranId: string): Promise<UsulanRekeningKoran> {
  const c = kueriScoped(unit);
  const mutasi = await bacaMutasiRekeningKoran(c, unit, rekeningKoranId);
  const ktx = await bacaKonteksCocok(c, unit, mutasi, { paralel: true });
  const usulan = usulkanSemua(mutasi, ktx);
  const disebut = new Set(usulan.flatMap((u) => [...u.kandidat.map((k) => k.cashLedgerId), ...(u.rujukan?.cashLedgerId ? [u.rujukan.cashLedgerId] : [])]));
  const kas = Object.fromEntries((ktx.kas as KasTerbaca[]).filter((k) => disebut.has(k.id)).map((k) => [k.id, k]));
  return { mutasi, usulan, kas };
}

/** Id baris kas unit ini yang berada di kelompok cocok AKTIF ("Lunas di bank", R3). */
export async function getKasDicocokkan(unit: ScopedUnitId, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await qScoped<{ id: string }>(
    unit,
    `SELECT b.cash_ledger_id::text AS id
       FROM app.cocok_bank_baris b
      WHERE b.unit_id = $1 AND b.aktif AND b.cash_ledger_id = ANY($2::uuid[])`,
    [unit, ids],
  );
  return new Set(rows.map((r) => r.id));
}
