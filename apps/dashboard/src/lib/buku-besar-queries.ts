import { hariDalamBulan, rentangBulan } from "./bulan";
import { MULAI_BUKU_BESAR, POS, senDariRupiah, TANGGAL_SALDO_AWAL, type BarisJurnal } from "./buku-besar-model";
import type { AngkaRumus, BahanLaporanBukuBesar, GerakPos, KasPembuka } from "./buku-besar-laporan-model";
import { qScoped } from "./db";
import { getBahanLaporan } from "./keuangan-laporan-queries";
import { labaBersihDari } from "./keuangan-laporan-model";
import { addDays } from "./periods";
import type { Pos } from "./pos-model";
import { getDaftarPos } from "./pos-queries";
import type { ScopedUnitId } from "./scope";

/**
 * Pembaca halaman Buku Besar — READ-ONLY (rencana 2026-11-02 K6 U9; R8–R10,
 * R12, KTD10). Yang menyusun laporannya `buku-besar-laporan-model.ts` (murni).
 *
 * ⛔ Setiap kueri per-unit menerima `ScopedUnitId`, dan RLS 0058 memfilter ulang.
 */

/**
 * Saldo pembuka rekening yang menjadi saldo awal pos kas/bank 30 Sep 2026
 * (§10.24, §10.26): baris `cash_ledger.saldo_awal` non-void ber-cut-over paling
 * lambat 1 Okt 2026 (saldo pembuka 1 Okt = saldo akhir 30 Sep). Rekening aktif
 * tanpa saldo pembuka ikut dengan `amount` NULL — belum ditetapkan.
 *
 * Dipakai juga di transaksi `simpanSaldoAwalPos` (`buku-besar-actions.ts`).
 */
export const SQL_KAS_PEMBUKA = `
  SELECT a.nama, a.kind::text AS kind, l.amount::text AS amount,
         COALESCE(l.saldo_awal_sementara, false) AS sementara, pu.kode AS "posBank"
    FROM app.cash_account a
    LEFT JOIN app.cash_ledger l
           ON l.account_id = a.id AND l.unit_id = a.unit_id AND l.saldo_awal AND NOT l.void
    LEFT JOIN app.pos_unit pu ON pu.cash_account_id = a.id AND pu.unit_id = a.unit_id
   WHERE a.unit_id = $1
     AND (l.id IS NULL OR l.business_date <= DATE '${addDays(TANGGAL_SALDO_AWAL, 1)}')
     AND (a.active OR l.id IS NOT NULL)
   ORDER BY (a.kind <> 'kas'), a.nama`;

export interface BarisKasPembuka {
  nama: string;
  kind: string;
  amount: string | null;
  sementara: boolean;
  posBank: string | null;
}

/** Baris SQL → {@link KasPembuka}: kas → 1101, EDC Penampungan → 1102, bank → sub-pos 111x. */
export function keKasPembuka(r: BarisKasPembuka): KasPembuka {
  const posKode = r.kind === "kas" ? POS.KAS_BESAR : r.kind === "edc_penampungan" ? POS.EDC_PENAMPUNGAN : r.posBank;
  return {
    nama: r.nama,
    posKode,
    saldoSen: r.amount === null ? null : senDariRupiah(r.amount),
    sementara: r.sementara,
  };
}

/** Saldo kas/bank per pos dari saldo pembuka rekening (yang sudah ditetapkan). */
export function kasPerPos(kas: readonly KasPembuka[]): { posKode: string; saldoSen: number }[] {
  const m = new Map<string, number>();
  for (const k of kas) if (k.posKode !== null && k.saldoSen !== null) m.set(k.posKode, (m.get(k.posKode) ?? 0) + k.saldoSen);
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([posKode, saldoSen]) => ({ posKode, saldoSen }));
}

export const SQL_SALDO_AWAL_POS = `
  SELECT pos_kode AS "posKode", saldo_sen::text AS "saldoSen", sumber
    FROM app.saldo_awal_pos WHERE unit_id = $1 AND NOT void ORDER BY pos_kode`;

/** Gerak pos teragregasi sampai akhir bulan menurut tanggal EFEKTIF (R33). $2 awal, $3 akhir. */
const SQL_GERAK = `
  SELECT b.pos_kode AS "posKode", j.status, j.jenis, (j.tanggal_efektif >= $2::date) AS "dalamBulan",
         sum(b.debet_sen)::text AS debet, sum(b.kredit_sen)::text AS kredit
    FROM app.jurnal_baris b
    JOIN app.jurnal j ON j.id = b.jurnal_id AND j.unit_id = b.unit_id
   WHERE b.unit_id = $1 AND j.tanggal_efektif <= $3::date
   GROUP BY 1, 2, 3, 4`;

export interface KeadaanBukuBesar {
  /** Bulan ini sudah ditutup (K5 atau buku besar)? */
  ditutup: boolean;
  /** Ditutup DENGAN buku besar (R13: jurnalnya beku). */
  ditutupBukuBesar: boolean;
  /** Tanggal buku jurnal sumber terakhir unit ini. `null` = belum pernah dibentuk. */
  jurnalSampai: string | null;
  /** Hari bulan ini yang sudah tutup hari tetapi tanpa jurnal sumber. */
  hariTanpaJurnal: string[];
  /** Pembentukan ulang yang gagal (mis. saat tutup hari) dan belum pernah berhasil sesudahnya. */
  gagal: { tanggal: string; galat: string }[];
}

export interface BahanHalamanBukuBesar extends BahanLaporanBukuBesar {
  daftar: Pos[];
  keadaan: KeadaanBukuBesar;
}

export async function getBahanBukuBesar(unit: ScopedUnitId, bulan: string): Promise<BahanHalamanBukuBesar> {
  const [awal, akhir] = rentangBulan(bulan);
  const [daftar, saldoAwal, kas, gerak, tutup, sampai, tanpa, gagal] = await Promise.all([
    getDaftarPos(unit),
    qScoped<{ posKode: string; saldoSen: string; sumber: "akuntan" | "akun_kas" }>(unit, SQL_SALDO_AWAL_POS, [unit]),
    qScoped<BarisKasPembuka>(unit, SQL_KAS_PEMBUKA, [unit]),
    qScoped<{ posKode: string; status: GerakPos["status"]; jenis: GerakPos["jenis"]; dalamBulan: boolean; debet: string; kredit: string }>(
      unit,
      SQL_GERAK,
      [unit, awal, akhir],
    ),
    qScoped<{ bukuBesar: boolean }>(unit, `SELECT buku_besar AS "bukuBesar" FROM app.tutup_bulan WHERE unit_id = $1 AND bulan = $2::date`, [unit, awal]),
    qScoped<{ sampai: string | null }>(
      unit,
      `SELECT to_char(max(tanggal_buku), 'YYYY-MM-DD') AS sampai FROM app.jurnal WHERE unit_id = $1 AND jenis = 'sumber'`,
      [unit],
    ),
    qScoped<{ tanggal: string }>(
      unit,
      `SELECT to_char(d.business_date, 'YYYY-MM-DD') AS tanggal
         FROM app.day_close d
        WHERE d.unit_id = $1 AND d.status = 'closed'
          AND d.business_date BETWEEN GREATEST($2::date, DATE '${MULAI_BUKU_BESAR}') AND $3::date
          AND NOT EXISTS (SELECT 1 FROM app.jurnal j
                           WHERE j.unit_id = d.unit_id AND j.jenis = 'sumber' AND j.tanggal_buku = d.business_date)
        ORDER BY 1`,
      [unit, awal, akhir],
    ),
    // Target audit = `<unit_id>/<tanggal>` (sama dengan `bentukUlangHari`).
    qScoped<{ tanggal: string; galat: string }>(
      unit,
      `SELECT split_part(a.target, '/', 2) AS tanggal,
              (array_agg(a.detail->>'galat' ORDER BY a.created_at DESC))[1] AS galat
         FROM app.audit_log a
        WHERE a.action = 'buku_besar.bentuk_ulang_gagal' AND a.target LIKE $1::text || '/' || $2 || '-%'
          AND NOT EXISTS (SELECT 1 FROM app.audit_log s
                           WHERE s.action = 'buku_besar.bentuk_ulang' AND s.target = a.target AND s.created_at > a.created_at)
        GROUP BY 1 ORDER BY 1`,
      [unit, bulan],
    ),
  ]);
  return {
    daftar,
    saldoAwal: saldoAwal.map((s) => ({ posKode: s.posKode, saldoSen: Number(s.saldoSen), sumber: s.sumber })),
    kasPembuka: kas.map(keKasPembuka),
    gerak: gerak.map((g) => ({
      posKode: g.posKode,
      status: g.status,
      jenis: g.jenis,
      dalamBulan: g.dalamBulan,
      debetSen: Number(g.debet),
      kreditSen: Number(g.kredit),
    })),
    bulanDitutupBukuBesar: tutup[0]?.bukuBesar === true,
    keadaan: {
      ditutup: tutup.length > 0,
      ditutupBukuBesar: tutup[0]?.bukuBesar === true,
      jurnalSampai: sampai[0]?.sampai ?? null,
      hariTanpaJurnal: tanpa.map((t) => t.tanggal),
      gagal,
    },
  };
}

// ---------------------------------------------------------------------------
// Daftar jurnal (drill-down pos → jurnal → catatan sumber; memorial)
// ---------------------------------------------------------------------------

export interface JurnalTampil {
  id: string;
  tanggalBuku: string;
  tanggalEfektif: string;
  jenis: "sumber" | "koreksi" | "memorial" | "saldo_awal";
  aturan: string;
  status: "aktif" | "menunggu" | "batal";
  sumberTabel: string | null;
  sumberId: string | null;
  keterangan: string;
  diusulkanOlehId: number | null;
  diusulkanOleh: string | null;
  disetujuiOleh: string | null;
  disetujuiAt: string | null;
  /** Memorial pembalik (non-batal) yang membatalkan jurnal ini, bila ada. */
  dibalikOleh: string | null;
  baris: BarisJurnal[];
}

const KOLOM_JURNAL = `
  SELECT j.id::text AS id,
         to_char(j.tanggal_buku, 'YYYY-MM-DD') AS "tanggalBuku",
         to_char(j.tanggal_efektif, 'YYYY-MM-DD') AS "tanggalEfektif",
         j.jenis, j.aturan, j.status, j.sumber_tabel AS "sumberTabel", j.sumber_id AS "sumberId", j.keterangan,
         j.diusulkan_oleh_user_id AS "diusulkanOlehId",
         up.email AS "diusulkanOleh", us.email AS "disetujuiOleh",
         to_char(j.disetujui_at AT TIME ZONE 'Asia/Pontianak', 'YYYY-MM-DD HH24:MI') AS "disetujuiAt",
         (SELECT r.id::text FROM app.jurnal r
           WHERE r.unit_id = j.unit_id AND r.jenis = 'memorial' AND r.sumber_tabel = 'jurnal'
             AND r.sumber_id = j.id::text AND r.status <> 'batal'
           LIMIT 1) AS "dibalikOleh",
         COALESCE((SELECT json_agg(json_build_object('posKode', b.pos_kode, 'debetSen', b.debet_sen, 'kreditSen', b.kredit_sen)
                                   ORDER BY b.kredit_sen, b.pos_kode)
                     FROM app.jurnal_baris b WHERE b.jurnal_id = j.id AND b.unit_id = j.unit_id), '[]'::json) AS baris
    FROM app.jurnal j
    LEFT JOIN app.users up ON up.id = j.diusulkan_oleh_user_id
    LEFT JOIN app.users us ON us.id = j.disetujui_oleh_user_id`;

type BarisJurnalSql = Omit<JurnalTampil, "baris"> & { baris: { posKode: string; debetSen: number | string; kreditSen: number | string }[] };

const keJurnal = (r: BarisJurnalSql): JurnalTampil => ({
  ...r,
  baris: r.baris.map((b) => ({ posKode: b.posKode, debetSen: Number(b.debetSen), kreditSen: Number(b.kreditSen) })),
});

/** Batas baris daftar jurnal satu pos — layar menyebut bila terpotong. */
export const BATAS_JURNAL_POS = 500;

/** Jurnal yang menyentuh `pos` bertanggal efektif di bulan itu (semua status). */
export async function getJurnalPos(unit: ScopedUnitId, bulan: string, pos: string): Promise<JurnalTampil[]> {
  const [awal, akhir] = rentangBulan(bulan);
  const rows = await qScoped<BarisJurnalSql>(
    unit,
    `${KOLOM_JURNAL}
      WHERE j.unit_id = $1 AND j.tanggal_efektif BETWEEN $2::date AND $3::date
        AND EXISTS (SELECT 1 FROM app.jurnal_baris x WHERE x.jurnal_id = j.id AND x.unit_id = j.unit_id AND x.pos_kode = $4)
      ORDER BY j.tanggal_efektif, j.created_at, j.id
      LIMIT ${BATAS_JURNAL_POS + 1}`,
    [unit, awal, akhir, pos],
  );
  return rows.map(keJurnal);
}

/** Memorial bertanggal di bulan itu, ditambah yang masih menunggu di bulan mana pun. */
export async function getMemorial(unit: ScopedUnitId, bulan: string): Promise<JurnalTampil[]> {
  const [awal, akhir] = rentangBulan(bulan);
  const rows = await qScoped<BarisJurnalSql>(
    unit,
    `${KOLOM_JURNAL}
      WHERE j.unit_id = $1 AND j.jenis = 'memorial'
        AND (j.tanggal_efektif BETWEEN $2::date AND $3::date OR j.status = 'menunggu')
      ORDER BY (j.status <> 'menunggu'), j.tanggal_efektif DESC, j.created_at DESC`,
    [unit, awal, akhir],
  );
  return rows.map(keJurnal);
}

// ---------------------------------------------------------------------------
// Pembanding laporan rumus (R12)
// ---------------------------------------------------------------------------

/** Hari laporan rumus dibaca bersamaan — tiap hari belasan kueri. */
// Satu hari pada satu waktu: getBahanLaporan ≈ 64 round-trip; 4 serempak menekan
// pool (max 10) dan bisa menelantarkan permintaan lain (temuan review #5).
const SEREMPAK = 1;

/**
 * Angka laporan rumus yang sebanding untuk bulan itu, per `batas` = akhir bulan
 * atau hari ini bila bulan berjalan. Neraca dibaca pada `batas`; laba = Σ net
 * profit harian (`labaBersihDari`, jalur Layar 2). Satu hari tak terhitung ⇒
 * laba bulan `null`, tidak dinolkan (§10.23).
 */
export async function getPembandingRumus(unit: ScopedUnitId, bulan: string, hariIni: string): Promise<{ batas: string; angka: AngkaRumus } | null> {
  const [, akhir] = rentangBulan(bulan);
  const batas = akhir < hariIni ? akhir : hariIni;
  const hari = hariDalamBulan(bulan).filter((d) => d >= MULAI_BUKU_BESAR && d <= batas);
  if (hari.length === 0) return null;
  const laba: (number | null)[] = [];
  let akhirBahan: Awaited<ReturnType<typeof getBahanLaporan>> | null = null;
  for (let i = 0; i < hari.length; i += SEREMPAK) {
    const potong = hari.slice(i, i + SEREMPAK);
    const bahan = await Promise.all(potong.map((d) => getBahanLaporan(unit, d, addDays(d, -1))));
    bahan.forEach((b, j) => {
      laba.push(labaBersihDari(b));
      if (potong[j] === batas) akhirBahan = b;
    });
  }
  const b = akhirBahan as Awaited<ReturnType<typeof getBahanLaporan>> | null;
  return {
    batas,
    angka: {
      kasBankRp: b?.kasAkhir ?? null,
      persediaanRp: b?.totals.inventoryValue ?? null,
      soRp: b?.totals.soValue ?? null,
      piutangEasymaxRp: b?.piutangEasymax ?? null,
      labaRp: laba.some((x) => x === null) ? null : laba.reduce<number>((s, x) => s + (x ?? 0), 0),
    },
  };
}
