import type { KakiUnitIni } from "./antar-unit-model";
import { q, qScoped } from "./db";
import { teksKeSen } from "./pihak-lawan-model";
import type { ScopedUnitId } from "./scope";

/**
 * Kueri baca pasangan antar unit (rencana 2026-10-29 U4) untuk halaman SATU
 * unit — hanya kaki milik unit itu (`qScoped(unit)`), tak pernah buku unit
 * lawan. Kesamaan saldo dua buku (R4) dibaca U6/Pemantauan lewat
 * `qScoped([a, b])` + `paritasPasangan`.
 */

export interface KakiTampil extends KakiUnitIni {
  /** Kode & nama unit lawan — dari master `public.unit` / pihak lawan unit ini, bukan buku unit lawan. */
  lawanCode: string;
  lawanNama: string;
}

export async function getKakiAntarUnit(unit: ScopedUnitId): Promise<KakiTampil[]> {
  const rows = await qScoped<{
    lawanCode: string;
    lawanNama: string;
    id: string;
    pasanganUuid: string;
    lawanUnitId: number;
    businessDate: string;
    tanggalAsal: string | null;
    amount: string;
    void: boolean;
    alasanMaju: string | null;
    keterangan: string;
    akun: string;
  }>(
    unit,
    `SELECT l.id::text                             AS id,
            l.pasangan_uuid::text                  AS "pasanganUuid",
            p.lawan_unit_id                        AS "lawanUnitId",
            to_char(l.business_date,'YYYY-MM-DD')  AS "businessDate",
            to_char(l.tanggal_asal,'YYYY-MM-DD')   AS "tanggalAsal",
            l.amount::text                         AS amount,
            l.void,
            l.alasan_maju                          AS "alasanMaju",
            l.keterangan,
            a.nama                                 AS akun,
            u.code                                 AS "lawanCode",
            p.nama                                 AS "lawanNama"
       FROM app.cash_ledger l
       JOIN app.pihak_lawan p  ON p.id = l.pihak_lawan_id AND p.unit_id = l.unit_id
       JOIN app.cash_account a ON a.id = l.account_id AND a.unit_id = l.unit_id
       JOIN public.unit u      ON u.unit_id = p.lawan_unit_id
      WHERE l.unit_id = $1 AND l.pasangan_uuid IS NOT NULL AND p.jenis = 'unit'
      ORDER BY l.business_date DESC, l.created_at DESC
      LIMIT 400`,
    [unit],
  );
  return rows.map((r) => ({ ...r, amountSen: teksKeSen(r.amount) }));
}

/** Rekening aktif satu unit (formulir — unit yang sedang dibuka). */
export async function getRekeningAktif(unit: ScopedUnitId): Promise<{ id: string; nama: string }[]> {
  return qScoped<{ id: string; nama: string }>(
    unit,
    `SELECT id::text AS id, nama FROM app.cash_account WHERE unit_id = $1 AND active ORDER BY kind, nama`,
    [unit],
  );
}

/**
 * Kode alasan koreksi yang boleh dipilih HoF saat membalik — master
 * `reason_code` (`applies_to = 'adjustment'`), TANPA kode pembukuan maju
 * `ADJ-FWD-*` (yang itu diisi sistem). Master bukan tabel ber-unit.
 */
export async function getKodeAlasanBalik(): Promise<{ code: string; label: string }[]> {
  return q<{ code: string; label: string }>(
    `SELECT code, label FROM app.reason_code
      WHERE applies_to = 'adjustment' AND active AND code NOT LIKE 'ADJ-FWD-%'
      ORDER BY code`,
  );
}

export interface KakiAntarUnitPantau {
  unitId: number;
  lawanUnitId: number;
  pasanganUuid: string | null;
  businessDate: string;
  /** Teks `numeric` — diubah ke sen bulat di model, tak lewat float. */
  amount: string;
  void: boolean;
}

export interface SaldoAwalAntarUnitPantau {
  unitId: number;
  lawanUnitId: number;
  tanggal: string;
  amount: string;
  sementara: boolean;
}

/**
 * Bahan kesamaan saldo antar unit (R4) untuk SEMUA unit di `units` — kaki
 * Hutang Piutang berpihak-lawan unit (semua tanggal: jendela setengah-dibukukan
 * butuh baris sesudah tanggal yang dinilai) dan saldo pembuka pasangan.
 *
 * ⛔ `qScoped(units)` — RLS hanya memulangkan buku unit yang dipegang pembaca.
 *    Pasangan yang satu unitnya di luar jangkauan tetap setengah, dan model
 *    (`paritasAntarUnit`) tidak menilainya. Dipakai Pemantauan & buku pembantu.
 */
export async function getBahanParitas(
  units: readonly ScopedUnitId[],
): Promise<{ kakiAntarUnit: KakiAntarUnitPantau[]; saldoAwalAntarUnit: SaldoAwalAntarUnitPantau[] }> {
  const ids = units.map(Number);
  const [kakiAntarUnit, saldoAwalAntarUnit] = await Promise.all([
    qScoped<KakiAntarUnitPantau>(
      units,
      `SELECT l.unit_id::int                         AS "unitId",
              p.lawan_unit_id::int                   AS "lawanUnitId",
              l.pasangan_uuid::text                  AS "pasanganUuid",
              to_char(l.business_date, 'YYYY-MM-DD') AS "businessDate",
              l.amount::text                         AS amount,
              l.void
         FROM app.cash_ledger l
         JOIN app.pihak_lawan p ON p.id = l.pihak_lawan_id AND p.unit_id = l.unit_id
        WHERE l.unit_id = ANY($1::int[]) AND p.jenis = 'unit'
          AND l.category_label = 'Hutang Piutang'`,
      [ids],
    ),
    qScoped<SaldoAwalAntarUnitPantau>(
      units,
      `SELECT s.unit_id::int                   AS "unitId",
              p.lawan_unit_id::int             AS "lawanUnitId",
              to_char(s.tanggal, 'YYYY-MM-DD') AS tanggal,
              s.amount::text                   AS amount,
              s.sementara
         FROM app.pihak_lawan_saldo_awal s
         JOIN app.pihak_lawan p ON p.id = s.pihak_lawan_id AND p.unit_id = s.unit_id
        WHERE s.unit_id = ANY($1::int[]) AND NOT s.void AND p.jenis = 'unit'`,
      [ids],
    ),
  ]);
  return { kakiAntarUnit, saldoAwalAntarUnit };
}
