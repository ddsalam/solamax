import { qScoped } from "./db";
import type { ScopedUnitId } from "./scope-rule";
import { DATE_RE } from "./selection-keys";
import { kelompokkanPerHari, JENDELA_HARI, type HariPiutang } from "./selisih-arus-kas-model";

/**
 * Bacaan penjelasan selisih Cash flow check (rencana 2026-11-11-2210 U2;
 * R2, R4, R7, KTD3) — SATU round-trip, jendela D−7…D+7, lewat `qScoped`.
 *
 * Sisi EasyMax: `bppiut` sjnsbp=2 (pembayaran/pengurangan piutang), non-batal,
 * dalam bucket yang SAMA dengan `READ_SALDO_PELANGGAN_LEGACY_SQL` —
 * Lokal = SJENIS {1,5} tanpa titik, Online = kode bertitik; gabungannya =
 * `lokal OR dotted`. Pelanggan lain tidak ikut, karena juga tidak ikut Δ
 * saldo piutang di cek.
 *
 * Sisi bank: baris kas "Transfer Pembayaran Piutang Pelanggan", non-void,
 * bukan saldo awal, menurut `business_date` (hari buku) — sama dengan sisi
 * kas cek (`arusBukuKas`/`sisiKasPada`), BUKAN `tanggal_asal`.
 */

/** Label kategori kas yang arusnya dari EasyMax (`PETA_KATEGORI_ARUS_KAS`, `dariBukuKas: false`). */
export const KATEGORI_PIUTANG_PELANGGAN = "Transfer Pembayaran Piutang Pelanggan";

export const SQL_PEMBAYARAN_PIUTANG_SEKITAR = `
SELECT 'easymax' AS sisi,
       to_char(b.dtgl,'YYYY-MM-DD') AS tanggal,
       trim(b.ckdbppiut) AS id,
       trim(b.ckdplg) AS pelanggan,
       b.vcref AS ref,
       b.vcket AS keterangan,
       b.njumlah::text AS amount,
       NULL::text AS nama_akun,
       NULL::text AS nomor_rekening,
       NULL::text AS tanggal_asal
  FROM public.bppiut b
  LEFT JOIN (SELECT unit_id, ckdplg FROM public.pelanggan_master
              WHERE unit_id = $1 AND sjenis IN (1,5)) m
    ON m.unit_id = b.unit_id AND trim(m.ckdplg) = trim(b.ckdplg)
 WHERE b.unit_id = $1 AND b.sjnsbp = 2 AND COALESCE(b.sbatal,0) = 0
   AND b.dtgl BETWEEN $2::date - ${JENDELA_HARI} AND $2::date + ${JENDELA_HARI}
   AND (m.ckdplg IS NOT NULL OR COALESCE(position('.' in trim(b.ckdplg)) > 0, false))
UNION ALL
SELECT 'bank' AS sisi,
       to_char(l.business_date,'YYYY-MM-DD') AS tanggal,
       l.id::text AS id,
       NULL::text AS pelanggan,
       NULL::text AS ref,
       l.keterangan AS keterangan,
       l.amount::text AS amount,
       a.nama AS nama_akun,
       a.nomor_rekening AS nomor_rekening,
       to_char(l.tanggal_asal,'YYYY-MM-DD') AS tanggal_asal
  FROM app.cash_ledger l
  JOIN app.cash_account a ON a.id = l.account_id
 WHERE l.unit_id = $1 AND l.category_label = $3 AND NOT l.void AND NOT l.saldo_awal
   AND l.business_date BETWEEN $2::date - ${JENDELA_HARI} AND $2::date + ${JENDELA_HARI}
 ORDER BY sisi, tanggal, id`;

interface Baris {
  sisi: "easymax" | "bank";
  tanggal: string;
  id: string;
  pelanggan: string | null;
  ref: string | null;
  keterangan: string | null;
  amount: string;
  nama_akun: string | null;
  nomor_rekening: string | null;
  tanggal_asal: string | null;
}

/**
 * Nama akun untuk layar — nomor rekening TIDAK PERNAH penuh: setiap deret ≥ 5
 * digit di nama diganti "…" + 4 digit terakhirnya; bila nama tak memuat nomor
 * dan `nomor_rekening` ada, "…" + 4 digit terakhirnya ditambahkan.
 */
export function namaAkunSamar(nama: string, nomorRekening: string | null): string {
  const samar = nama.replace(/\d{5,}/g, (d) => `…${d.slice(-4)}`).replace(/\s*-\s*…/, " …");
  if (samar !== nama || nomorRekening === null) return samar;
  const d = nomorRekening.replace(/\D/g, "");
  return d.length >= 4 ? `${nama} …${d.slice(-4)}` : nama;
}

export async function getPembayaranPiutangSekitar(unit: ScopedUnitId, date: string): Promise<HariPiutang[]> {
  if (!DATE_RE.test(date)) throw new Error(`tanggal tidak sah: ${date}`);
  const rows = await qScoped<Baris>(unit, SQL_PEMBAYARAN_PIUTANG_SEKITAR, [unit, date, KATEGORI_PIUTANG_PELANGGAN]);
  return kelompokkanPerHari(
    rows.map((r) =>
      r.sisi === "easymax"
        ? {
            sisi: "easymax" as const,
            tanggal: r.tanggal,
            baris: { kode: r.id, pelanggan: r.pelanggan ?? "", ref: r.ref, keterangan: r.keterangan, rp: Number(r.amount) },
          }
        : {
            sisi: "bank" as const,
            tanggal: r.tanggal,
            baris: {
              id: r.id,
              rekening: namaAkunSamar(r.nama_akun ?? "", r.nomor_rekening),
              tanggalAsal: r.tanggal_asal,
              keterangan: r.keterangan,
              rp: Number(r.amount),
            },
          },
    ),
  );
}
