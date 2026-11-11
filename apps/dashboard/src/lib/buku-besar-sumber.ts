import { normalizeProductIdentity } from "./derive";
import { effectiveBuyPrice } from "./harga-beli";
import { getHargaBeliRows } from "./keuangan-input-queries";
import { sisaSoAktif } from "./keuangan-mesin";
import { SQL_AKUN_EFEKTIF } from "./keuangan-reklas";
import { SQL_ME_TAK_BERLAKU } from "./keuangan-berlaku";
import { NOMINAL_MANUAL_ENTRY_SQL } from "./manual-entry-nominal";
import { getDailyGlByProduct, getDoHarian, getSalesByProduct, getSaldoPelanggan } from "./queries";
import { posUntukKode, type Pos } from "./pos-model";
import { sqlTitipan } from "./titipan-bright";
import {
  POS,
  senDariRupiah,
  type BarisKas,
  type BarisManual,
  type MasukanHari,
  type PencairanEdc,
  type ProdukHari,
  type SaldoPelangganHari,
} from "./buku-besar-model";
import type { Tier } from "./keuangan-tutup-hari";
import type { ScopedUnitId } from "./scope";

/**
 * Pembaca catatan sumber satu unit-hari untuk buku besar (rencana 2026-11-02 K6
 * U8; KTD3). Hasilnya {@link MasukanHari} untuk `turunkanHari` (murni).
 *
 * ⛔ DUA JALUR BACA, SENGAJA:
 *
 * 1. **Data `app.*` lewat klien transaksi pemanggil.** Jalur `*-tulis` yang
 *    membentuk jurnalnya sendiri (KTD3 pemicu 1) harus melihat baris yang BARU
 *    ia tulis dan belum di-COMMIT. Semua kueri di sini memakai `c`, sesudah
 *    `set_config('app.unit_ids', …)` — RLS 0016 memfilter ulang.
 * 2. **Data EasyMax lewat {@link PembacaEasymax}** — bawaannya kueri laporan
 *    rumus yang SAMA (`getDailyGlByProduct`, `getSalesByProduct`, `getDoHarian`,
 *    `getSaldoPelanggan`, harga beli `effectiveBuyPrice`), di koneksi pool
 *    sendiri. Aman: data EasyMax tak pernah ditulis di transaksi ini. Satu
 *    rumus untuk laporan rumus dan buku besar, jadi beda keduanya (R12) adalah
 *    beda aturan, bukan beda bacaan. Disuntikkan supaya uji tak butuh mirror.
 *
 * Sengaja BUKAN berkas "use server".
 */

/** Klien minimal — `PoolClient` memenuhinya. */
export interface KlienBaca {
  query<T extends object>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Bahan EasyMax satu unit-hari. */
export interface BahanEasymax {
  produk: ProdukHari[];
  pelanggan: SaldoPelangganHari | null;
}

export type PembacaEasymax = (unit: ScopedUnitId, tanggal: string) => Promise<BahanEasymax>;

/**
 * Pembaca EasyMax bawaan — perakitan yang sama dengan `getBahanLaporan`
 * (`keuangan-laporan-queries.ts`): produk tanpa identitas tidak dijurnal.
 */
export const bacaEasymaxHari: PembacaEasymax = async (unit, tanggal) => {
  const [gl, sales, buyRows, doRows, saldo] = await Promise.all([
    getDailyGlByProduct(unit, tanggal, tanggal),
    getSalesByProduct(unit, tanggal, tanggal),
    getHargaBeliRows(unit),
    getDoHarian(unit, tanggal),
    getSaldoPelanggan(unit, tanggal),
  ]);
  const hargaJual = new Map(
    sales.flatMap((s) => {
      const k = normalizeProductIdentity(s.ckdbbm);
      return k === null ? [] : [[k, s.harga] as const];
    }),
  );
  const doPer = new Map(
    doRows.flatMap((x) => {
      const k = normalizeProductIdentity(x.ckdbbm);
      return k === null ? [] : [[k, x] as const];
    }),
  );
  // Himpunan produk = baris G/L harian, sama dengan laporan rumus: produk yang
  // hanya punya alur SO tanpa baris stok juga tidak dinilai di sana.
  const produk: ProdukHari[] = [];
  for (const r of gl) {
    const k = normalizeProductIdentity(r.ckdbbm);
    if (k === null) continue;
    const d = doPer.get(k);
    produk.push({
      produk: k,
      volumeL: r.sales_gross,
      teraL: r.tera,
      hargaJual: hargaJual.get(k) ?? null,
      hargaBeli: effectiveBuyPrice(buyRows, k, tanggal),
      stokL: r.fisik,
      lossesGainL: r.gl,
      penerimaanL: d?.penerimaan ?? 0,
      sisaSoAktifL: d === undefined ? 0 : sisaSoAktif(d.sisa, d.sisa_macet),
    });
  }
  produk.sort((a, b) => a.produk.localeCompare(b.produk));
  return {
    produk,
    pelanggan: {
      piutangAwalSen: senDariRupiah(saldo.awal.piutangLokal + saldo.awal.piutangOnline),
      piutangAkhirSen: senDariRupiah(saldo.akhir.piutangLokal + saldo.akhir.piutangOnline),
      depositAwalSen: depositSen(saldo.awal.hutangLokal),
      depositAkhirSen: depositSen(saldo.akhir.hutangLokal),
    },
  };
};

/**
 * `hutangLokal` EasyMax bertanda NEGATIF untuk deposit yang kita utangi
 * (`getSaldoPelanggan`: liabilitas negatif); {@link SaldoPelangganHari} meminta
 * positif = kewajiban. Tanpa pembalikan ini P28 membalik arah 2101: pemakaian
 * deposit Rp 300.000 di Bakau 22 Okt (−3.429.860,5 → −3.129.860,5) terjurnal
 * Kr 2101 alih-alih Dr 2101. `0 - x`, bukan `-x`: saldo nol tetap +0, bukan −0.
 */
function depositSen(hutangLokal: number): number {
  return senDariRupiah(0 - hutangLokal);
}

// ---------------------------------------------------------------------------
// SQL — $1 unit, $2 tanggal (kecuali disebut lain)
// ---------------------------------------------------------------------------

/** Pos resmi + sub-pos unit — bentuk sama dengan `SQL_DAFTAR_POS` (pos-queries). */
const SQL_POS = `
  SELECT NULL::text AS id, p.kode, p.nama, p.jenis, p.induk, p.kode_induk AS "kodeInduk",
         p.pengurang, p.kliring, p.sistem, NULL::int AS "unitId", NULL::text AS "cashAccountId"
    FROM app.pos p
  UNION ALL
  SELECT u.id::text, u.kode, u.nama, i.jenis, false, u.kode_induk, false, false, false,
         u.unit_id::int, u.cash_account_id::text
    FROM app.pos_unit u JOIN app.pos i ON i.kode = u.kode_induk
   WHERE u.unit_id = $1`;

const SQL_KODE_LAMA = `SELECT kode_lama AS "kodeLama", pos_kode AS "posKode" FROM app.pos_kode_lama`;

const SQL_AKUN = `SELECT id::text AS id, kind::text AS kind FROM app.cash_account WHERE unit_id = $1`;

/** Baris kas hari buku itu: non-void, bukan saldo pembuka (saldo awal pos, R9/P22). */
export const SQL_KAS_HARI = `
  SELECT l.id::text AS id, l.account_id::text AS "accountId", l.amount::text AS amount,
         l.category_label AS kategori, l.keterangan,
         to_char(l.tanggal_asal, 'YYYY-MM-DD') AS "tanggalAsal",
         l.edc_settlement_id::text AS "edcSettlementId", l.pasangan_uuid::text AS "pasanganUuid",
         pl.jenis AS "pihakLawanJenis"
    FROM app.cash_ledger l
    LEFT JOIN app.pihak_lawan pl ON pl.id = l.pihak_lawan_id AND pl.unit_id = l.unit_id
   WHERE l.unit_id = $1 AND l.business_date = $2::date AND NOT l.void AND NOT l.saldo_awal
   ORDER BY l.id`;

/** Baris pintu Finance yang bertaut ke baris kas $2 (uuid[]), akun efektif. */
const SQL_TERTAUT = `
  SELECT m.cash_ledger_id::text AS "cashLedgerId", m.id::text AS id,
         ${SQL_AKUN_EFEKTIF("m")} AS akun, ${NOMINAL_MANUAL_ENTRY_SQL}::text AS nominal
    FROM app.manual_entry m
   WHERE m.unit_id = $1 AND NOT ${SQL_ME_TAK_BERLAKU("m")} AND m.source_door = 'finance'
     AND m.cash_ledger_id = ANY($2::uuid[])
   ORDER BY m.id`;

const SQL_PENEBUSAN = `
  SELECT cash_ledger_id::text AS "cashLedgerId", id::text AS id, net::text AS net, ppn::text AS ppn,
         pph::text AS pph, pbbkb::text AS pbbkb, nota::text AS nota, gross::text AS gross
    FROM app.penebusan
   WHERE unit_id = $1 AND NOT void AND cash_ledger_id = ANY($2::uuid[])`;

/** MDR non-kas per settlement $2 (uuid[]) — kaki ketiga pencairan (§2.5). */
const SQL_MDR = `
  SELECT edc_settlement_id::text AS "settlementId", sum(amount_rp)::text AS mdr
    FROM app.noncash_expense
   WHERE unit_id = $1 AND NOT void AND edc_settlement_id = ANY($2::uuid[])
   GROUP BY edc_settlement_id`;

/**
 * `manual_entry` hari itu yang TIDAK diwujudkan baris kas aktif: baris pengawas,
 * dan baris Finance tanpa tautan (atau tautannya sudah batal). Baris Finance
 * bertaut dijurnal bersama baris kasnya (P11/P12/P20).
 */
const SQL_MANUAL_HARI = `
  SELECT m.id::text AS id, m.section::text AS section, m.source_door AS "sourceDoor",
         ${SQL_AKUN_EFEKTIF("m")} AS akun, ${NOMINAL_MANUAL_ENTRY_SQL}::text AS nominal,
         ${sqlTitipan("m")} AS titipan, m.keterangan
    FROM app.manual_entry m
   WHERE m.unit_id = $1 AND m.business_date = $2::date AND NOT ${SQL_ME_TAK_BERLAKU("m")}
     AND NOT (m.source_door = 'finance' AND m.cash_ledger_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM app.cash_ledger l
            WHERE l.id = m.cash_ledger_id AND l.unit_id = m.unit_id AND NOT l.void))
   ORDER BY m.id`;

const SQL_TUTUP_HARI = `
  SELECT status::text AS status, tier::text AS tier, approved_by_user_id IS NOT NULL AS disetujui
    FROM app.day_close WHERE unit_id = $1 AND business_date = $2::date`;

/**
 * Saldo 1131/1132 SEBELUM hari $2 dan net memorial 1103 hari itu. Saldo awal
 * dari `saldo_awal_pos` (bukan jurnal `saldo_awal` — keduanya tak boleh
 * dijumlah); jurnal aktif bertanggal EFEKTIF lebih awal, plus memorial
 * bertanggal efektif hari itu. `awal` NULL = saldo awal pos belum diisi.
 */
export const SQL_SALDO_SEBELUM = `
  SELECT p.kode,
         (SELECT s.saldo_sen::text FROM app.saldo_awal_pos s
           WHERE s.unit_id = $1 AND s.pos_kode = p.kode AND NOT s.void) AS awal,
         COALESCE((SELECT sum(b.debet_sen - b.kredit_sen)
                     FROM app.jurnal_baris b
                     JOIN app.jurnal j ON j.id = b.jurnal_id AND j.unit_id = b.unit_id
                    WHERE b.unit_id = $1 AND b.pos_kode = p.kode AND j.status = 'aktif'
                      AND j.jenis <> 'saldo_awal'
                      -- Jurnal sumber yang DIBUKUKAN pada hari $2 dibentuk ulang dari
                      -- sumbernya sekarang; menghitungnya di sini (mis. P7 terdorong
                      -- maju, efektif < $2) membuat P23 menghitungnya dua kali.
                      AND NOT (j.jenis = 'sumber' AND j.tanggal_buku = $2::date)
                      AND (j.tanggal_efektif < $2::date
                           OR (j.tanggal_efektif = $2::date AND j.jenis = 'memorial'))), 0)::text AS gerak,
         COALESCE((SELECT sum(b.debet_sen - b.kredit_sen)
                     FROM app.jurnal_baris b
                     JOIN app.jurnal j ON j.id = b.jurnal_id AND j.unit_id = b.unit_id
                    WHERE b.unit_id = $1 AND b.pos_kode = p.kode AND j.status = 'aktif'
                      AND j.jenis = 'memorial' AND j.tanggal_efektif = $2::date), 0)::text AS memorial
    FROM unnest(ARRAY['${POS.PERSEDIAAN_TANGKI}', '${POS.SO_DIBAYAR}', '${POS.BELUM_DISETOR}']) AS p(kode)`;

// ---------------------------------------------------------------------------

export interface OpsiBaca {
  /**
   * Pembaca EasyMax. `null` = jangan baca EasyMax: aturan harian (P1, P8–P10,
   * P23, P24, P28) tidak diturunkan — dipakai pembentukan per sumber.
   */
  easymax: PembacaEasymax | null;
}

/** Pos per rekening: kas → 1101, EDC Penampungan → 1102, bank → sub-pos 111x unit itu. */
function petaPosAkun(akun: readonly { id: string; kind: string }[], daftar: readonly Pos[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const a of akun) {
    if (a.kind === "kas") out[a.id] = POS.KAS_BESAR;
    else if (a.kind === "edc_penampungan") out[a.id] = POS.EDC_PENAMPUNGAN;
    else out[a.id] = daftar.find((p) => p.cashAccountId === a.id)?.kode ?? null;
  }
  return out;
}

export async function bacaSumberHari(
  c: KlienBaca,
  unit: ScopedUnitId,
  tanggal: string,
  opsi: OpsiBaca = { easymax: bacaEasymaxHari },
): Promise<MasukanHari> {
  const daftar = (await c.query<Pos>(SQL_POS, [unit])).rows;
  const kodeLama = new Map((await c.query<{ kodeLama: string; posKode: string }>(SQL_KODE_LAMA)).rows.map((r) => [r.kodeLama, r.posKode]));
  const posKode = (akun: string | null) => posUntukKode(akun, daftar, kodeLama)?.kode ?? null;
  const posAkun = petaPosAkun((await c.query<{ id: string; kind: string }>(SQL_AKUN, [unit])).rows, daftar);

  const kasMentah = (
    await c.query<{
      id: string;
      accountId: string;
      amount: string;
      kategori: string | null;
      keterangan: string;
      tanggalAsal: string | null;
      edcSettlementId: string | null;
      pasanganUuid: string | null;
      pihakLawanJenis: string | null;
    }>(SQL_KAS_HARI, [unit, tanggal])
  ).rows;
  const ids = kasMentah.map((r) => r.id);
  const tertaut = ids.length
    ? (await c.query<{ cashLedgerId: string; id: string; akun: string | null; nominal: string }>(SQL_TERTAUT, [unit, ids])).rows
    : [];
  const penebusan = ids.length
    ? (await c.query<{ cashLedgerId: string; id: string; net: string; ppn: string; pph: string; pbbkb: string; nota: string; gross: string }>(
        SQL_PENEBUSAN,
        [unit, ids],
      )).rows
    : [];

  const kas: BarisKas[] = kasMentah.map((r) => {
    const pb = penebusan.find((p) => p.cashLedgerId === r.id);
    return {
      id: r.id,
      accountId: r.accountId,
      amountSen: senDariRupiah(r.amount),
      kategori: r.kategori,
      keterangan: r.keterangan,
      tanggalAsal: r.tanggalAsal,
      edcSettlementId: r.edcSettlementId,
      pasanganUuid: r.pasanganUuid,
      pihakLawanJenis: r.pihakLawanJenis,
      tertaut: tertaut
        .filter((t) => t.cashLedgerId === r.id)
        .map((t) => ({ manualEntryId: t.id, posKode: posKode(t.akun), amountSen: senDariRupiah(t.nominal) })),
      penebusan: pb
        ? {
            id: pb.id,
            netSen: senDariRupiah(pb.net),
            ppnSen: senDariRupiah(pb.ppn),
            pphSen: senDariRupiah(pb.pph),
            pbbkbSen: senDariRupiah(pb.pbbkb),
            notaSen: senDariRupiah(pb.nota),
            grossSen: senDariRupiah(pb.gross),
          }
        : null,
    };
  });

  // P5 — kaki kas per settlement + MDR non-kasnya (tanggal mana pun).
  const settlement = [...new Set(kas.flatMap((k) => (k.edcSettlementId ? [k.edcSettlementId] : [])))].sort();
  const mdr = settlement.length
    ? new Map((await c.query<{ settlementId: string; mdr: string }>(SQL_MDR, [unit, settlement])).rows.map((r) => [r.settlementId, senDariRupiah(r.mdr)]))
    : new Map<string, number>();
  const pencairan: PencairanEdc[] = settlement.map((sid) => {
    const legs = kas.filter((k) => k.edcSettlementId === sid);
    return {
      settlementId: sid,
      tanggalEfektif: legs.map((l) => l.tanggalAsal ?? tanggal).sort()[0]!,
      legs: legs.map((l) => ({ posKode: posAkun[l.accountId] ?? null, amountSen: l.amountSen })),
      mdrSen: mdr.get(sid) ?? 0,
    };
  });

  const manual: BarisManual[] = (
    await c.query<{ id: string; section: BarisManual["section"]; sourceDoor: BarisManual["sourceDoor"]; akun: string | null; nominal: string; titipan: boolean; keterangan: string }>(
      SQL_MANUAL_HARI,
      [unit, tanggal],
    )
  ).rows.map((r) => ({
    id: r.id,
    section: r.section,
    sourceDoor: r.sourceDoor,
    amountSen: senDariRupiah(r.nominal),
    posKode: posKode(r.akun),
    titipan: r.titipan,
    keterangan: r.keterangan,
  }));

  const saldo = (await c.query<{ kode: string; awal: string | null; gerak: string; memorial: string }>(SQL_SALDO_SEBELUM, [unit, tanggal])).rows;
  const sebelum = (kode: string) => {
    const r = saldo.find((x) => x.kode === kode);
    return r?.awal == null ? null : Number(r.awal) + Number(r.gerak);
  };
  const memorial1103 = Number(saldo.find((x) => x.kode === POS.BELUM_DISETOR)?.memorial ?? 0);

  const th = (await c.query<{ status: string; tier: Tier; disetujui: boolean }>(SQL_TUTUP_HARI, [unit, tanggal])).rows[0];

  const em = opsi.easymax === null ? null : await opsi.easymax(unit, tanggal);

  return {
    tanggal,
    produk: em?.produk ?? null,
    pelanggan: em?.pelanggan ?? null,
    kas,
    pencairan,
    manual,
    posAkun,
    saldoPersediaan: { s1131: sebelum(POS.PERSEDIAAN_TANGKI), s1132: sebelum(POS.SO_DIBAYAR) },
    memorial1103Sen: memorial1103,
    tutupHari: th ? { ditutup: th.status === "closed", tier: th.tier, disetujui: th.disetujui } : null,
  };
}
