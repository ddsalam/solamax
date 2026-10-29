import { qScoped } from "./db";
import { getUsulanRekeningKoran, PREDIKAT_KAS_DICOCOKKAN } from "./cocok-bank-queries";
import { LABEL_TANDA, type AturanCocok } from "./cocok-bank-model";
import { KATEGORI_PENAMPUNG } from "./keuangan-sisi-kas";
import { statusBarisImpor, type StatusBarisImpor } from "./klasifikasi-model";
import { teksKeSen } from "./pihak-lawan-model";
import { PREDIKAT_REKENING_BCA } from "./impor-bank-queries";
import type { ScopedUnitId } from "./scope";

/**
 * Bacaan layar klasifikasi per unit × bulan (rencana 2026-10-29 U11; R21,
 * R23, R25; KTD6, KTD8) — READ-ONLY, sengaja BUKAN berkas "use server".
 * Kandidat cocok memakai vonis YANG SAMA dengan aksi otomatis
 * (`getUsulanRekeningKoran` → `usulkanSemua`).
 */

export interface KandidatTampil {
  cashLedgerId: string;
  aturan: AturanCocok;
  businessDate: string;
  tanggalAsal: string | null;
  amountSen: number;
  keterangan: string;
  categoryLabel: string | null;
}

export interface BarisImporTampil {
  id: string;
  accountId: string;
  rekeningKoranId: string;
  tanggalBank: string;
  keterangan: string;
  amountSen: number;
  so: string | null;
  status: StatusBarisImpor;
  kandidat: KandidatTampil[];
  /** Label tanda usulan (mis. "penebusan belum diketik"), bila ada. */
  tanda: string | null;
  /** Baris kas parkir yang masih bisa dipindahkan (status diparkir). */
  parkirId: string | null;
}

export interface BukuTanpaPasangan {
  id: string;
  accountId: string;
  businessDate: string;
  tanggalAsal: string | null;
  amountSen: number;
  keterangan: string;
  categoryLabel: string | null;
}

export interface RekeningBulan {
  accountId: string;
  nama: string;
  rekeningKoranId: string | null;
}

/** Rekening BCA aktif unit + rekening koran AKTIF bulan itu (bila sudah diunggah). $1 unit, $2 'YYYY-MM-01'. */
export async function getRekeningBulan(unit: ScopedUnitId, periode: string): Promise<RekeningBulan[]> {
  return qScoped<RekeningBulan>(
    unit,
    `SELECT cash_account.id::text AS "accountId", cash_account.nama,
            (SELECT r.id::text FROM app.rekening_koran r
              WHERE r.unit_id = cash_account.unit_id AND r.account_id = cash_account.id AND r.status = 'aktif'
                AND r.periode = $2::date) AS "rekeningKoranId"
       FROM app.cash_account
      WHERE unit_id = $1 AND ${PREDIKAT_REKENING_BCA}
      ORDER BY nama`,
    [unit, `${periode}-01`],
  );
}

/**
 * Per baris impor yang ada di kelompok AKTIF: Σ penampung kelompok itu dan
 * baris parkir yang belum dipindahkan (KTD8). $1 unit, $2 uuid[] baris impor.
 */
async function getParkir(unit: ScopedUnitId, mutasiIds: readonly string[]): Promise<Map<string, { penampung: string; parkirId: string | null }>> {
  if (mutasiIds.length === 0) return new Map();
  const rows = await qScoped<{ mutasiId: string; penampung: string; parkirId: string | null }>(
    unit,
    `SELECT b.mutasi_bank_id::text AS "mutasiId",
            COALESCE((SELECT sum(l.amount) FROM app.cocok_bank_baris b2
                        JOIN app.cash_ledger l ON l.id = b2.cash_ledger_id AND l.unit_id = b2.unit_id
                       WHERE b2.cocok_id = b.cocok_id AND b2.unit_id = b.unit_id AND b2.aktif
                         AND NOT l.void AND l.category_label = $3), 0)::text AS penampung,
            (SELECT l.id::text FROM app.cocok_bank_baris b2
               JOIN app.cash_ledger l ON l.id = b2.cash_ledger_id AND l.unit_id = b2.unit_id
              WHERE b2.cocok_id = b.cocok_id AND b2.unit_id = b.unit_id AND b2.aktif
                AND NOT l.void AND l.category_label = $3 AND l.parkir_sumber_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM app.cash_ledger x
                                 WHERE x.unit_id = l.unit_id AND x.parkir_sumber_id = l.id AND NOT x.void)
              LIMIT 1) AS "parkirId"
       FROM app.cocok_bank_baris b
      WHERE b.unit_id = $1 AND b.aktif AND b.mutasi_bank_id = ANY($2::uuid[])`,
    [unit, mutasiIds, KATEGORI_PENAMPUNG],
  );
  return new Map(rows.map((r) => [r.mutasiId, { penampung: r.penampung, parkirId: r.parkirId }]));
}

/** Semua baris impor rekening koran AKTIF bulan itu (semua rekening), terurut tanggal bank. */
export async function getBarisImporBulan(unit: ScopedUnitId, rekening: readonly RekeningBulan[]): Promise<BarisImporTampil[]> {
  const out: BarisImporTampil[] = [];
  for (const r of rekening) {
    if (r.rekeningKoranId === null) continue;
    const u = await getUsulanRekeningKoran(unit, r.rekeningKoranId);
    const usulan = new Map(u.usulan.map((x) => [x.mutasiId, x]));
    const parkir = await getParkir(unit, u.mutasi.filter((m) => m.dicocokkan).map((m) => m.id));
    for (const m of u.mutasi) {
      const us = usulan.get(m.id);
      const p = parkir.get(m.id);
      const penampungSen = p ? teksKeSen(p.penampung) : 0;
      const status = statusBarisImpor({ praCutover: m.praCutover, dicocokkan: m.dicocokkan, penampungSen });
      out.push({
        id: m.id,
        accountId: m.accountId,
        rekeningKoranId: m.rekeningKoranId,
        tanggalBank: m.tanggalBank,
        keterangan: m.keterangan,
        amountSen: m.amountSen,
        so: m.so,
        status,
        kandidat:
          status !== "terbuka"
            ? []
            : (us?.kandidat ?? []).flatMap((k) => {
                const kas = u.kas[k.cashLedgerId];
                return kas
                  ? [
                      {
                        cashLedgerId: kas.id,
                        aturan: k.aturan,
                        businessDate: kas.businessDate,
                        tanggalAsal: kas.tanggalAsal,
                        amountSen: kas.amountSen,
                        keterangan: kas.keterangan,
                        categoryLabel: kas.categoryLabel,
                      },
                    ]
                  : [];
              }),
        tanda: status === "terbuka" && us?.tanda ? LABEL_TANDA[us.tanda] : null,
        parkirId: status === "diparkir" ? (p?.parkirId ?? null) : null,
      });
    }
  }
  return out.sort((a, b) => a.tanggalBank.localeCompare(b.tanggalBank));
}

/**
 * Baris buku rekening-rekening itu yang TIDAK punya pasangan rekening koran di
 * bulan itu (R25): non-void, bukan saldo awal, tanggal asal ?? hari buku di
 * bulan itu, tidak di kelompok cocok aktif. $1 unit, $2 uuid[], $3 awal, $4 akhir.
 */
export async function getBukuTanpaPasangan(unit: ScopedUnitId, accountIds: readonly string[], periode: string): Promise<BukuTanpaPasangan[]> {
  if (accountIds.length === 0) return [];
  const awal = `${periode}-01`;
  const rows = await qScoped<Omit<BukuTanpaPasangan, "amountSen"> & { amount: string }>(
    unit,
    `SELECT l.id::text AS id, l.account_id::text AS "accountId",
            to_char(l.business_date, 'YYYY-MM-DD') AS "businessDate",
            to_char(l.tanggal_asal, 'YYYY-MM-DD') AS "tanggalAsal",
            l.amount::text AS amount, l.keterangan, l.category_label AS "categoryLabel"
       FROM app.cash_ledger l
      WHERE l.unit_id = $1 AND l.account_id = ANY($2::uuid[]) AND NOT l.void AND NOT l.saldo_awal
        AND COALESCE(l.tanggal_asal, l.business_date) >= $3::date
        AND COALESCE(l.tanggal_asal, l.business_date) < ($3::date + interval '1 month')
        AND NOT ${PREDIKAT_KAS_DICOCOKKAN}
      ORDER BY COALESCE(l.tanggal_asal, l.business_date), l.created_at`,
    [unit, accountIds, awal],
  );
  return rows.map(({ amount, ...r }) => ({ ...r, amountSen: teksKeSen(amount) }));
}
