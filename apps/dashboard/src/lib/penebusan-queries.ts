import { qScoped } from "./db";
import { rentangBulan } from "./penebusan-model";
import { teksKeSen } from "./pihak-lawan-model";
import type { ScopedUnitId } from "./scope";

/**
 * Kueri baca penebusan per SO (rencana 2026-10-29 U7; R12, R13). Semua lewat
 * `qScoped` — RLS 0050 + RLS cermin EasyMax (0016) membatasi ke unit yang
 * lolos otorisasi. Murni SELECT.
 *
 * Tautan ke EasyMax (R12): `lower(trim(th.cnoso)) = p.no_so` — konvensi yang
 * sama dengan `getDoSuspectSO` / `so_macet` (0028); SO batal (`sbatal`)
 * diabaikan. Produk & volume dibaca dari `tebus_detail`, tidak disalin.
 */

export interface PenebusanTampil {
  id: string;
  unitCode: string;
  noSo: string;
  tanggalBayar: string;
  rekening: string;
  netSen: number;
  ppnSen: number;
  pphSen: number;
  pbbkbSen: number;
  notaSen: number;
  grossSen: number;
  kasDibuat: boolean;
  /** Hari buku baris kasnya (≠ tanggal bayar bila dibukukan maju). */
  hariBuku: string;
  /** SO ditemukan di `tebus_header` (tidak batal). */
  tertaut: boolean;
  /** Nama produk EasyMax (dipisah koma); `null` bila belum tertaut. */
  produk: string | null;
  /** Σ `tebus_detail.nvolume` (liter); `null` bila belum tertaut. */
  volume: number | null;
}

export async function getPenebusanBulan(units: readonly ScopedUnitId[], bulan: string): Promise<PenebusanTampil[]> {
  const [awal, akhir] = rentangBulan(bulan);
  const rows = await qScoped<{
    id: string;
    unitCode: string;
    noSo: string;
    tanggalBayar: string;
    rekening: string;
    net: string;
    ppn: string;
    pph: string;
    pbbkb: string;
    nota: string;
    gross: string;
    kasDibuat: boolean;
    hariBuku: string;
    nSo: number;
    produk: string | null;
    volume: number | null;
  }>(
    units,
    `SELECT p.id::text AS id, u.code AS "unitCode", p.no_so AS "noSo",
            to_char(p.tanggal_bayar,'YYYY-MM-DD') AS "tanggalBayar",
            a.nama AS rekening,
            p.net::text AS net, p.ppn::text AS ppn, p.pph::text AS pph, p.pbbkb::text AS pbbkb,
            p.nota::text AS nota, p.gross::text AS gross,
            p.kas_dibuat AS "kasDibuat",
            to_char(l.business_date,'YYYY-MM-DD') AS "hariBuku",
            so.n AS "nSo", so.produk, so.volume
       FROM app.penebusan p
       JOIN public.unit u      ON u.unit_id = p.unit_id
       JOIN app.cash_account a ON a.id = p.account_id AND a.unit_id = p.unit_id
       JOIN app.cash_ledger l  ON l.id = p.cash_ledger_id AND l.unit_id = p.unit_id
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS n,
                sum(td.nvolume)::float8 AS volume,
                string_agg(DISTINCT COALESCE(
                  (SELECT max(pr.vcnmbbm) FROM product pr
                    WHERE pr.unit_id = td.unit_id AND trim(pr.ckdbbm) = trim(td.ckdbbm)),
                  trim(td.ckdbbm)), ', ') AS produk
           FROM tebus_header th
           JOIN tebus_detail td ON td.unit_id = th.unit_id AND td.ckdtbs = th.ckdtbs
          WHERE th.unit_id = p.unit_id AND lower(trim(th.cnoso)) = p.no_so
            AND COALESCE(th.sbatal, 0) = 0
       ) so ON true
      WHERE p.unit_id = ANY($1::int[]) AND NOT p.void
        AND p.tanggal_bayar BETWEEN $2::date AND $3::date
      ORDER BY u.code, p.tanggal_bayar, p.no_so`,
    [units.map(Number), awal, akhir],
  );
  return rows.map((r) => {
    const tertaut = Number(r.nSo) > 0;
    return {
      id: r.id,
      unitCode: r.unitCode,
      noSo: r.noSo,
      tanggalBayar: r.tanggalBayar,
      rekening: r.rekening,
      netSen: teksKeSen(r.net),
      ppnSen: teksKeSen(r.ppn),
      pphSen: teksKeSen(r.pph),
      pbbkbSen: teksKeSen(r.pbbkb),
      notaSen: teksKeSen(r.nota),
      grossSen: teksKeSen(r.gross),
      kasDibuat: r.kasDibuat,
      hariBuku: r.hariBuku,
      tertaut,
      produk: tertaut ? r.produk : null,
      volume: tertaut && r.volume !== null ? Number(r.volume) : null,
    };
  });
}

export interface SoBelumTertaut {
  id: string;
  noSo: string;
  tanggalBayar: string;
  rekening: string;
  grossSen: number;
}

/** Penebusan aktif (semua bulan) yang SO-nya belum ditemukan di EasyMax (R12). */
export async function getSoBelumTertaut(unit: ScopedUnitId): Promise<SoBelumTertaut[]> {
  const rows = await qScoped<{ id: string; noSo: string; tanggalBayar: string; rekening: string; gross: string }>(
    unit,
    `SELECT p.id::text AS id, p.no_so AS "noSo",
            to_char(p.tanggal_bayar,'YYYY-MM-DD') AS "tanggalBayar",
            a.nama AS rekening, p.gross::text AS gross
       FROM app.penebusan p
       JOIN app.cash_account a ON a.id = p.account_id AND a.unit_id = p.unit_id
      WHERE p.unit_id = $1 AND NOT p.void
        AND NOT EXISTS (
          SELECT 1 FROM tebus_header th
           WHERE th.unit_id = p.unit_id AND lower(trim(th.cnoso)) = p.no_so
             AND COALESCE(th.sbatal, 0) = 0
        )
      ORDER BY p.tanggal_bayar DESC, p.no_so
      LIMIT 200`,
    [unit],
  );
  return rows.map((r) => ({
    id: r.id,
    noSo: r.noSo,
    tanggalBayar: r.tanggalBayar,
    rekening: r.rekening,
    grossSen: teksKeSen(r.gross),
  }));
}

/** Rekening BANK aktif satu unit — pembayar penebusan. */
export async function getRekeningBank(unit: ScopedUnitId): Promise<{ id: string; nama: string }[]> {
  return qScoped<{ id: string; nama: string }>(
    unit,
    `SELECT id::text AS id, nama FROM app.cash_account
      WHERE unit_id = $1 AND kind = 'bank' AND active
      ORDER BY nama`,
    [unit],
  );
}
