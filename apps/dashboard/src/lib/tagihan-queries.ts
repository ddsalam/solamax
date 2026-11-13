import { qScoped } from "./db";
import { todayWib } from "./periods";
import type { ScopedUnitId } from "./scope";
import {
  compareTagihanRows,
  deriveTagihanStatus,
  matchesTagihanFilter,
  paginateTagihan,
  summarizeTagihan,
  type TagihanFaktur,
  type TagihanFilter,
  type TagihanPage,
  type TagihanRingkasan,
  type TagihanRow,
  type TagihanStatus,
  type TagihanTermin,
} from "./tagihan-model";
import { getPetaTermin, terminUntuk, type PetaTermin } from "./termin-queries";

/**
 * Kueri baca layar Tagihan pelanggan (rencana 2026-11-13 U6; R1, R7, R8, R17,
 * R19–R23; KTD4, KTD8, KTD11). SELURUHNYA BACA, seluruhnya lewat `qScoped()`
 * dengan `ScopedUnitId` ber-brand — RLS `unit_scope` (0063/0064/0037) ditambah
 * `unit_id` di setiap WHERE.
 *
 * ⛔ **Tidak ada satu pun vonis status di berkas ini.** Status bayar, jatuh
 * tempo dan penanda diputuskan `deriveTagihanStatus` (`tagihan-model.ts`) —
 * satu pembuat vonis. SQL di sini hanya menarik fakta dan menjumlahkan
 * pembayaran yang tidak batal; jumlah itu diserahkan ke model sebagai SATU
 * pembayaran hidup, jadi aturan "berapa yang dihitung lunas" tetap tinggal di
 * model.
 *
 * 📏 **Ongkos.** Tidak ada N+1: daftar satu unit = 1 kueri kesiapan, lalu 3
 * kueri paralel (faktur + jumlah bayar + nama; termin; belum ditagihkan).
 * Rincian faktur = 5 kueri berapa pun banyaknya dokumen. Ringkasan lintas
 * unit = 4 kueri untuk SELURUH unit (larik unit sekali kirim, pola
 * `keuangan-pantau-queries.ts`). Status dihitung di JS untuk setiap faktur
 * hidup yang belum lunas — puluhan s.d. ratusan baris per unit; faktur lunas
 * TIDAK ditarik kecuali diminta per periode. Semua daftar berbatas
 * {@link BATAS_BARIS_TAGIHAN}; bila terlampaui, hasilnya ditandai `terpotong`
 * — tidak pernah dipotong diam-diam.
 *
 * Yang paling mahal adalah "belum ditagihkan": satu lintasan atas seluruh
 * posting debet + tautan faktur unit itu (terukur ±0,25 dtk pada 300 ribu
 * posting ilustratif, Postgres 16 lokal), dibayar setiap kali ubinnya tampil.
 *
 * Kode pelanggan selalu dalam bentuk kunci `btrim(ckdplg)` (sama dengan layar
 * Saldo pelanggan dan `termin-queries.ts`); kode faktur/dokumen/pembayaran
 * dalam bentuk `btrim(...)` — kolom cerminnya CHAR berpengisi spasi.
 */

/** Batas baris tiap daftar (per unit yang diminta). Dilampaui = `terpotong`. */
export const BATAS_BARIS_TAGIHAN = 5000;

/** Teks keadaan kosong KTD11 — satu sumber untuk semua layar. */
export const TAGIHAN_BELUM_TERSEDIA = "Data tagihan belum tersedia untuk SPBU ini";

/** Rentang tanggal inklusif, "YYYY-MM-DD". */
export interface PeriodeTagihan {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Kesiapan & kesegaran (KTD11, R22)
// ---------------------------------------------------------------------------

export interface TagihanKesiapanSiap {
  tersedia: true;
  /** Siklus LENGKAP terakhir, ISO UTC — untuk `formatWib()` / `ago()`. */
  selesaiAt: string;
  /** Sama, sudah WIB: `YYYY-MM-DD HH:MM`. */
  selesaiWib: string;
  /** Jumlah kunci faktur / pembayaran di manifest siklus itu (termasuk yang batal). */
  jumlahFaktur: number;
  jumlahPembayaran: number;
  /** Tanggal pembayaran HIDUP terakhir yang tercatat; `null` = belum ada satu pun. */
  pembayaranTerakhir: string | null;
}

/** `tersedia: false` = unit belum pernah menyelesaikan satu siklus pun — BUKAN nol faktur. */
export type TagihanKesiapan = { tersedia: false } | TagihanKesiapanSiap;

export interface TagihanBelumTersedia {
  tersedia: false;
}

const BELUM: TagihanBelumTersedia = { tersedia: false };

interface KesiapanSql extends Omit<TagihanKesiapanSiap, "tersedia"> {
  unitId: number;
}

/**
 * Kesiapan dibaca HANYA dari `tagihan_cycle` — baris yang ditulis transaksi
 * manifest penutup siklus. Bukan dari `sync_state`, yang ikut maju pada
 * payload parsial mana pun (KTD11).
 */
const SQL_KESIAPAN = `
SELECT c.unit_id::int AS "unitId",
       to_char(c.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "selesaiAt",
       to_char(c.completed_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') AS "selesaiWib",
       c.header_count AS "jumlahFaktur",
       c.bayar_count AS "jumlahPembayaran",
       (SELECT to_char(max(p.dtgl), 'YYYY-MM-DD')
          FROM public.tagihan_bayar p
         WHERE p.unit_id = c.unit_id AND COALESCE(p.sbatal, 0) = 0) AS "pembayaranTerakhir"
  FROM public.tagihan_cycle c
 WHERE c.unit_id = ANY($1::int[])`;

async function muatKesiapan(units: readonly ScopedUnitId[]): Promise<Map<number, TagihanKesiapanSiap>> {
  const peta = new Map<number, TagihanKesiapanSiap>();
  if (units.length === 0) return peta;
  const rows = await qScoped<KesiapanSql>(units, SQL_KESIAPAN, [units]);
  for (const { unitId, ...sisa } of rows) peta.set(Number(unitId), { tersedia: true, ...sisa });
  return peta;
}

export async function getTagihanKesiapan(unit: ScopedUnitId): Promise<TagihanKesiapan> {
  return (await muatKesiapan([unit])).get(Number(unit)) ?? BELUM;
}

// ---------------------------------------------------------------------------
// Faktur + jumlah pembayaran + nama pelanggan — SATU kueri
// ---------------------------------------------------------------------------

interface FakturSql {
  unitId: number;
  kode: string;
  customerCode: string;
  namaPelanggan: string | null;
  tanggalFaktur: string | null;
  jatuhTempoEasymax: string | null;
  nilai: number;
  statusEasymax: number | null;
  sisaEasymax: number | null;
  dibayar: number;
  jumlahPembayaran: number;
  jumlahPembayaranBatal: number;
  tanggalBayarTerakhir: string | null;
  keterangan: string | null;
}

/** Nama pelanggan per kode kunci — master cermin, satu baris per `btrim(ckdplg)`. $1 unit[]. */
const SQL_NAMA_PELANGGAN = `
    SELECT unit_id, btrim(ckdplg) AS kode, max(vcnmplg) AS nama
      FROM public.pelanggan_master
     WHERE unit_id = ANY($1::int[])
     GROUP BY unit_id, btrim(ckdplg)`;

/** Nilai faktur = grand total; admin tak pernah dipakai (probe 13 Nov), jadi `ntotal` hanya cadangan. */
const SQL_NILAI_FAKTUR = "COALESCE(h.ngatot, h.ntotal, 0)";

/**
 * $1 unit[], $2/$3 periode lunas (atau NULL), $4 kode pelanggan (atau NULL),
 * $5 sertakan SEMUA faktur hidup, $6 batas baris.
 *
 * Faktur TERBUKA tidak pernah dibatasi tanggal (R7). Saringan SQL-nya sengaja
 * KONSERVATIF — "jumlah bayar hidup berbeda dari nilai faktur" pada numerik
 * eksak: ia hanya membuang faktur yang PASTI lunas, tidak pernah yang mungkin
 * belum. Yang lolos tetapi lunas sesudah pembulatan rupiah diputuskan model.
 *
 * Faktur LUNAS hanya ikut bila periodenya diminta, dan periodenya diukur pada
 * TANGGAL PELUNASAN = pembayaran hidup terakhir (cadangan: tanggal faktur,
 * untuk faktur bernilai nol tanpa pembayaran). Bukan tanggal faktur: yang
 * ditanyakan keuangan adalah "apa yang dibayar bulan ini", dan faktur tiga
 * bulan lalu yang dilunasi kemarin harus muncul di bulan ini — sama dengan
 * cara menu "Pembayaran Tagihan Pelanggan" EasyMax dibaca per periode.
 */
const SQL_FAKTUR = `
SELECT h.unit_id::int AS "unitId",
       btrim(h.ckdtagih) AS kode,
       COALESCE(btrim(h.ckdplg), '') AS "customerCode",
       pm.nama AS "namaPelanggan",
       to_char(h.dtgl, 'YYYY-MM-DD') AS "tanggalFaktur",
       to_char(h.dtgljt, 'YYYY-MM-DD') AS "jatuhTempoEasymax",
       ${SQL_NILAI_FAKTUR}::float8 AS nilai,
       h.nstatus::int AS "statusEasymax",
       h.nlastsaldo::float8 AS "sisaEasymax",
       COALESCE(bay.dibayar, 0)::float8 AS dibayar,
       COALESCE(bay.n_hidup, 0)::int AS "jumlahPembayaran",
       COALESCE(bay.n_batal, 0)::int AS "jumlahPembayaranBatal",
       to_char(bay.terakhir, 'YYYY-MM-DD') AS "tanggalBayarTerakhir",
       h.vcket AS keterangan
  FROM public.tagihan_header h
  LEFT JOIN (
    SELECT unit_id, ckdtagih,
           sum(ntotal) FILTER (WHERE COALESCE(sbatal, 0) = 0) AS dibayar,
           count(*) FILTER (WHERE COALESCE(sbatal, 0) = 0) AS n_hidup,
           count(*) FILTER (WHERE COALESCE(sbatal, 0) <> 0) AS n_batal,
           max(dtgl) FILTER (WHERE COALESCE(sbatal, 0) = 0) AS terakhir
      FROM public.tagihan_bayar
     WHERE unit_id = ANY($1::int[])
     GROUP BY unit_id, ckdtagih
  ) bay ON bay.unit_id = h.unit_id AND bay.ckdtagih = h.ckdtagih
  LEFT JOIN (${SQL_NAMA_PELANGGAN}
  ) pm ON pm.unit_id = h.unit_id AND pm.kode = btrim(h.ckdplg)
 WHERE h.unit_id = ANY($1::int[])
   AND COALESCE(h.sbatal, 0) = 0
   AND ($4::text IS NULL OR btrim(h.ckdplg) = $4::text)
   AND (
     $5::boolean
     OR COALESCE(bay.dibayar, 0) IS DISTINCT FROM ${SQL_NILAI_FAKTUR}
     OR ($2::date IS NOT NULL
         AND COALESCE(bay.terakhir, h.dtgl) BETWEEN $2::date AND $3::date)
   )
 ORDER BY h.unit_id, h.dtgl NULLS FIRST, h.ckdtagih
 LIMIT $6::int`;

interface MuatFakturOpsi {
  periodeLunas?: PeriodeTagihan | null;
  kodePelanggan?: string | null;
  semua?: boolean;
}

async function muatFaktur(
  units: readonly ScopedUnitId[],
  opsi: MuatFakturOpsi = {},
): Promise<{ rows: FakturSql[]; terpotong: boolean }> {
  if (units.length === 0) return { rows: [], terpotong: false };
  const batas = BATAS_BARIS_TAGIHAN * units.length;
  const rows = await qScoped<FakturSql>(units, SQL_FAKTUR, [
    units,
    opsi.periodeLunas?.from ?? null,
    opsi.periodeLunas?.to ?? null,
    opsi.kodePelanggan ?? null,
    opsi.semua === true,
    batas + 1,
  ]);
  return rows.length > batas ? { rows: rows.slice(0, batas), terpotong: true } : { rows, terpotong: false };
}

/** Satu baris daftar: faktur + status turunan model + yang dibutuhkan layar. */
export interface TagihanBaris extends TagihanRow {
  namaPelanggan: string | null;
  /**
   * Tanggal faktur kosong di sumber (tanggal nol EasyMax). `faktur.tanggalFaktur`
   * lalu berisi `""`, jatuh tempo tidak dihitung, dan statusnya `Termin belum
   * diatur` — tidak pernah lewat jatuh tempo.
   */
  tanggalFakturKosong: boolean;
  /** Tanggal pembayaran hidup terakhir; untuk faktur lunas = tanggal pelunasan. */
  tanggalBayarTerakhir: string | null;
  /** Banyaknya pembayaran hidup / batal pada faktur ini. */
  jumlahPembayaran: number;
  jumlahPembayaranBatal: number;
  keterangan: string | null;
}

const TANPA_TERMIN: TagihanTermin = { terminPelanggan: null, terminUnit: null };

function keBaris(r: FakturSql, peta: PetaTermin, hariIni: string): TagihanBaris {
  const kosong = r.tanggalFaktur === null;
  const faktur: TagihanFaktur = {
    kode: r.kode,
    customerCode: r.customerCode,
    tanggalFaktur: r.tanggalFaktur ?? "",
    jatuhTempoEasymax: r.jatuhTempoEasymax,
    nilai: Number(r.nilai),
    statusEasymax: r.statusEasymax === null ? null : Number(r.statusEasymax),
    sisaEasymax: r.sisaEasymax === null ? null : Number(r.sisaEasymax),
    batal: false,
  };
  // Tanpa tanggal faktur tak ada jatuh tempo yang bisa dihitung: model diberi
  // faktur tanpa jatuh tempo dan tanpa termin, sehingga jatuh ke "belum diatur".
  const status = deriveTagihanStatus(
    kosong ? { ...faktur, jatuhTempoEasymax: null } : faktur,
    // Jumlah pembayaran hidup dari SQL, diserahkan sebagai SATU pembayaran hidup.
    [{ jumlah: Number(r.dibayar), batal: false }],
    kosong ? TANPA_TERMIN : terminUntuk(peta, r.customerCode),
    hariIni,
  )!;
  return {
    faktur,
    status,
    namaPelanggan: r.namaPelanggan,
    tanggalFakturKosong: kosong,
    tanggalBayarTerakhir: r.tanggalBayarTerakhir,
    jumlahPembayaran: Number(r.jumlahPembayaran),
    jumlahPembayaranBatal: Number(r.jumlahPembayaranBatal),
    keterangan: r.keterangan,
  };
}

/** Faktur yang masih punya sisa dan jatuh temponya TIDAK berasal dari EasyMax. */
function hitungBergantungTermin(baris: readonly TagihanBaris[]): number {
  return baris.filter((b) => b.status.statusJatuhTempo !== null && b.status.sumber !== "easymax").length;
}

function kunciCari(cari: string | null | undefined): string {
  return (cari ?? "").trim().toLocaleLowerCase("id-ID");
}

function cocokCari(kunci: string, kode: string, nama: string | null): boolean {
  return kunci.length === 0
    || kode.toLocaleLowerCase("id-ID").includes(kunci)
    || (nama?.toLocaleLowerCase("id-ID").includes(kunci) ?? false);
}

/** Kode kunci: pangkas spasi ASCII pinggir, sama dengan `terminUntuk`. */
function pangkas(kode: string): string {
  return kode.replace(/^ +| +$/g, "");
}

function bulat(value: number): number {
  const r = Math.round(value);
  return r === 0 ? 0 : r;
}

// ---------------------------------------------------------------------------
// Belum ditagihkan (R19, KTD8)
// ---------------------------------------------------------------------------

/**
 * Populasi pelanggan "piutang" — disalin PERSIS dari snapshot Saldo pelanggan
 * (`apps/backend/src/saldo-pelanggan/snapshot-sql.ts`: predikat gabungan di
 * baris 88–92 dan 110–114; `local_keys` baris 176–181; saringan Lokal/Online
 * baris 216–231):
 *   · Online = kode BERTITIK, tanpa saringan kelas;
 *   · Lokal  = kode tanpa titik DAN master berkelas 1 atau 5.
 * Kelas 4 (penjualan tunai, `queries.ts:1447-1473`) tak bertitik dan bukan
 * 1/5, jadi tak pernah masuk — debetnya memang tak pernah ditagihkan.
 * Kode kosong/NULL: kedua cabang gagal, sama seperti di snapshot.
 *
 * ⚠️ Satu beda yang disebut: snapshot membaca master dari potongan sumbernya
 * yang beku; di sini master cermin yang hidup. Pelanggan yang kelasnya baru
 * diubah bisa berbeda sampai snapshot berikutnya.
 */
const SQL_POPULASI_PIUTANG = `(
     position('.' in btrim(b.ckdplg)) > 0
     OR EXISTS (
       SELECT 1 FROM public.pelanggan_master lk
        WHERE lk.unit_id = b.unit_id
          AND btrim(lk.ckdplg) = btrim(b.ckdplg)
          AND lk.sjenis IN (1, 5))
   )`;

/**
 * Dokumen belum ditagihkan: posting debet hidup buku piutang yang rujukannya
 * dokumen penjualan (JP) atau pemakaian voucher (UV), milik populasi piutang,
 * dan TIDAK tertaut ke faktur HIDUP mana pun. Tautan faktur batal tetap
 * tersimpan di `tagihan_detail` (probe 13 Nov), jadi tautan selalu dibaca
 * lewat header-nya; tautan yang header-nya batal atau lenyap tidak
 * menyembunyikan penjualan. Tanpa lantai tanggal (KTD8). Satu dokumen bisa
 * punya lebih dari satu posting: dijumlahkan.
 *
 * 🔴 **Kenapa bentuknya gabung-lalu-kelompokkan, bukan anti-join.** Bentuk
 * alaminya (`NOT EXISTS` atas tautan) DIJALANKAN di Postgres 16 terhadap 300
 * ribu posting ilustratif dan tidak selesai dalam 2 menit: perencana menaksir
 * baris posting terlalu kecil (`COALESCE(sbatal,0)=0` dan `LIKE` atas ekspresi
 * tak punya statistik), memilih nested loop anti join, dan membandingkan
 * setiap posting dengan setiap tautan. Index ekspresi
 * atas `btrim(vcref)` (pernah direncanakan di 0063, dibatalkan) tidak menolong:
 * di bawah RLS, klausa
 * yang memuat `btrim()` — fungsi yang TIDAK leakproof — tak boleh menjadi
 * kondisi index, jadi index itu hanya terpakai untuk kolom `unit_id`-nya
 * (dibuktikan dengan EXPLAIN: superuser memakainya, role ber-RLS tidak).
 * Bentuk di bawah menyatukan kedua sumber dan mengelompokkannya per rujukan;
 * ongkosnya satu lintasan atas posting debet + tautan unit itu, dan TIDAK
 * bergantung pada taksiran perencana.
 *
 * Rujukan tetap dibandingkan dalam bentuk `trim(b.vcref)` — konvensi repo.
 * $1 unit[], $2 kode pelanggan (atau NULL).
 */
const SQL_BELUM_DITAGIHKAN_DOKUMEN_DASAR = `
    SELECT z.unit_id, z.ref,
           min(z.kode) AS kode,
           min(z.dtgl) AS tanggal,
           COALESCE(sum(z.njumlah), 0) AS jumlah,
           max(z.vcket) AS keterangan
      FROM (
        SELECT b.unit_id, trim(b.vcref) AS ref, btrim(b.ckdplg) AS kode,
               b.dtgl, b.njumlah, b.vcket, false AS tertaut
          FROM public.bppiut b
         WHERE b.unit_id = ANY($1::int[])
           AND COALESCE(b.sbatal, 0) = 0
           AND b.sjnsbp = 1
           AND (trim(b.vcref) LIKE 'JP%' OR trim(b.vcref) LIKE 'UV%')
           AND ($2::text IS NULL OR btrim(b.ckdplg) = $2::text)
           AND ${SQL_POPULASI_PIUTANG}
        UNION ALL
        SELECT d.unit_id, btrim(d.ckdjualplg), NULL::text,
               NULL::date, NULL::numeric, NULL::text, true
          FROM public.tagihan_detail d
          JOIN public.tagihan_header fh
            ON fh.unit_id = d.unit_id AND fh.ckdtagih = d.ckdtagih
         WHERE d.unit_id = ANY($1::int[])
           AND COALESCE(fh.sbatal, 0) = 0
      ) z
     GROUP BY z.unit_id, z.ref
    HAVING NOT bool_or(z.tertaut)`;

const SQL_BELUM_DITAGIHKAN_KELOMPOK = `
SELECT x.unit_id::int AS "unitId",
       x.kode AS "customerCode",
       pm.nama AS "namaPelanggan",
       x.n::int AS "jumlahDokumen",
       x.total::float8 AS total,
       to_char(x.tertua, 'YYYY-MM-DD') AS "tanggalTertua"
  FROM (
    SELECT dok.unit_id, dok.kode, count(*) AS n, sum(dok.jumlah) AS total, min(dok.tanggal) AS tertua
      FROM (${SQL_BELUM_DITAGIHKAN_DOKUMEN_DASAR}
      ) dok
     GROUP BY dok.unit_id, dok.kode
  ) x
  LEFT JOIN (${SQL_NAMA_PELANGGAN}
  ) pm ON pm.unit_id = x.unit_id AND pm.kode = x.kode
 ORDER BY x.unit_id, x.tertua, x.kode`;

/** $3 batas baris. */
const SQL_BELUM_DITAGIHKAN_DOKUMEN = `
SELECT x.kode AS "customerCode",
       pm.nama AS "namaPelanggan",
       x.ref AS "kodeDokumen",
       to_char(x.tanggal, 'YYYY-MM-DD') AS tanggal,
       x.jumlah::float8 AS jumlah,
       x.keterangan
  FROM (${SQL_BELUM_DITAGIHKAN_DOKUMEN_DASAR}
  ) x
  LEFT JOIN (${SQL_NAMA_PELANGGAN}
  ) pm ON pm.unit_id = x.unit_id AND pm.kode = x.kode
 ORDER BY x.tanggal, x.kode, x.ref
 LIMIT $3::int`;

interface BelumDitagihkanSql {
  unitId: number;
  customerCode: string;
  namaPelanggan: string | null;
  jumlahDokumen: number;
  total: number;
  tanggalTertua: string | null;
}

async function muatBelumDitagihkan(
  units: readonly ScopedUnitId[],
  kodePelanggan: string | null = null,
): Promise<BelumDitagihkanSql[]> {
  if (units.length === 0) return [];
  return qScoped<BelumDitagihkanSql>(units, SQL_BELUM_DITAGIHKAN_KELOMPOK, [units, kodePelanggan]);
}

/** Ubin "Belum ditagihkan": dokumen, pelanggan, rupiah bulat. */
export interface BelumDitagihkanUbin {
  jumlahDokumen: number;
  jumlahPelanggan: number;
  total: number;
}

function ubinBelumDitagihkan(rows: readonly BelumDitagihkanSql[]): BelumDitagihkanUbin {
  let jumlahDokumen = 0;
  let total = 0;
  for (const r of rows) {
    jumlahDokumen += Number(r.jumlahDokumen);
    total += Number(r.total);
  }
  return { jumlahDokumen, jumlahPelanggan: rows.length, total: bulat(total) };
}

/** Empat ubin S1/S5: tiga dari model (atas SEMUA faktur belum lunas) + belum ditagihkan. */
export interface TagihanUbin extends TagihanRingkasan {
  belumDitagihkan: BelumDitagihkanUbin;
}

export interface BelumDitagihkanDokumen {
  customerCode: string;
  namaPelanggan: string | null;
  /** Nomor dokumen penjualan / pemakaian voucher (rujukan buku piutang). */
  kodeDokumen: string;
  tanggal: string;
  jumlah: number;
  keterangan: string | null;
}

/**
 * Dokumen belum ditagihkan, tertua dulu. `kodePelanggan` diisi = milik satu
 * pelanggan (membuka satu kelompok di S3); `null` = seluruh unit (ekspor).
 */
export async function getDokumenBelumDitagihkan(
  unit: ScopedUnitId,
  kodePelanggan: string | null = null,
): Promise<{ dokumen: BelumDitagihkanDokumen[]; terpotong: boolean }> {
  const rows = await qScoped<BelumDitagihkanDokumen>(unit, SQL_BELUM_DITAGIHKAN_DOKUMEN, [
    [unit],
    kodePelanggan === null ? null : pangkas(kodePelanggan),
    BATAS_BARIS_TAGIHAN + 1,
  ]);
  const dokumen = rows.slice(0, BATAS_BARIS_TAGIHAN).map((r) => ({ ...r, jumlah: Number(r.jumlah) }));
  return { dokumen, terpotong: rows.length > BATAS_BARIS_TAGIHAN };
}

// ---------------------------------------------------------------------------
// Saldo pelanggan terbit terakhir (R20)
// ---------------------------------------------------------------------------

/**
 * Pointer TERBIT terakhir satu unit. Syarat generasinya disalin dari
 * `READ_SALDO_SNAPSHOT_POINTER_SQL` (`saldo-snapshot.ts:91-127`): pointer hanya
 * terbaca bila manifest-nya `complete`, `published`, lolos validasi dan
 * berformula v2. Pembaca di sana dikunci (unit, tanggal); yang ini mengambil
 * tanggal TERBESAR yang punya pointer sah — lewat PK `(unit_id, as_of_date)`.
 */
const SQL_POINTER_TERBIT_TERAKHIR = `
SELECT p.as_of_date, p.generation_id, p.pending_replacement
  FROM app.saldo_pelanggan_snapshot_pointer p
  JOIN app.saldo_pelanggan_snapshot_manifest m
    ON m.unit_id = p.unit_id
   AND m.as_of_date = p.as_of_date
   AND m.generation_id = p.generation_id
   AND m.status = 'complete'
   AND m.published
   AND m.validation_passed
   AND m.formula_version = 'saldo-pelanggan-v2'
 WHERE p.unit_id = $1::smallint
 ORDER BY p.as_of_date DESC
 LIMIT 1`;

export interface SaldoTerbitTerakhir {
  /** Tanggal saldo ("per …"), `YYYY-MM-DD`. */
  asOfDate: string;
  generationId: string;
  /** Pointer ini sedang menunggu generasi pengganti (ada koreksi sumber sesudahnya). */
  sedangDiperbarui: boolean;
}

/** `null` = unit ini belum punya satu pun snapshot Saldo pelanggan yang terbit. */
export async function getSaldoTerbitTerakhir(unit: ScopedUnitId): Promise<SaldoTerbitTerakhir | null> {
  const rows = await qScoped<SaldoTerbitTerakhir>(
    unit,
    `SELECT to_char(t.as_of_date, 'YYYY-MM-DD') AS "asOfDate",
            t.generation_id::text AS "generationId",
            t.pending_replacement AS "sedangDiperbarui"
       FROM (${SQL_POINTER_TERBIT_TERAKHIR}) t`,
    [unit],
  );
  return rows[0] ?? null;
}

interface SaldoTerbitSql {
  asOfDate: string;
  sedangDiperbarui: boolean;
  kode: string | null;
  lokal: number | null;
  online: number | null;
}

/**
 * $1 unit, $2 kode pelanggan (atau NULL = semua). Gabungan kiri: snapshot tanpa
 * baris tetap memulangkan tanggalnya (satu baris ber-kode NULL).
 */
const SQL_SALDO_TERBIT = `
WITH terbit AS (${SQL_POINTER_TERBIT_TERAKHIR})
SELECT to_char(t.as_of_date, 'YYYY-MM-DD') AS "asOfDate",
       t.pending_replacement AS "sedangDiperbarui",
       btrim(r.customer_code) AS kode,
       r.akhir_piutang_lokal::float8 AS lokal,
       r.akhir_piutang_online::float8 AS online
  FROM terbit t
  LEFT JOIN app.saldo_pelanggan_snapshot_row r
    ON r.unit_id = $1::smallint
   AND r.as_of_date = t.as_of_date
   AND r.generation_id = t.generation_id
   AND ($2::text IS NULL OR btrim(r.customer_code) = $2::text)`;

interface SaldoTerbit {
  asOfDate: string;
  sedangDiperbarui: boolean;
  saldo: Map<string, { lokal: number; online: number }>;
}

async function muatSaldoTerbit(unit: ScopedUnitId, kodePelanggan: string | null = null): Promise<SaldoTerbit | null> {
  const rows = await qScoped<SaldoTerbitSql>(unit, SQL_SALDO_TERBIT, [unit, kodePelanggan]);
  if (rows.length === 0) return null;
  const saldo = new Map<string, { lokal: number; online: number }>();
  for (const r of rows) {
    if (r.kode !== null) saldo.set(r.kode, { lokal: Number(r.lokal ?? 0), online: Number(r.online ?? 0) });
  }
  return { asOfDate: rows[0]!.asOfDate, sedangDiperbarui: rows[0]!.sedangDiperbarui === true, saldo };
}

/**
 * Cocok-silang R20 satu pelanggan. Selisih DITAMPILKAN, tidak dijelaskan:
 * kredit buku piutang yang tak terikat pembayaran faktur adalah sumber selisih
 * yang sah (KTD8).
 */
export interface CocokSaldoPelanggan {
  /** Σ sisa SELURUH faktur hidup pelanggan ini; lebih bayar ikut sebagai negatif. */
  sisaFaktur: number;
  /** Total dokumen belum ditagihkan. */
  belumDitagihkan: number;
  /** `sisaFaktur + belumDitagihkan`. */
  jumlah: number;
  /** Kelompok saldo pembandingnya: kode bertitik = Online, selainnya Lokal. */
  kelompokSaldo: "lokal" | "online";
  /** Saldo akhir piutang kelompok itu di snapshot terbit terakhir; `null` = belum tersedia. */
  saldoPiutang: number | null;
  /** Tanggal snapshot itu; `null` = belum tersedia. */
  saldoPerTanggal: string | null;
  /** `jumlah − saldoPiutang`; `null` = belum tersedia (jangan tampilkan selisih). */
  selisih: number | null;
}

function cocokSaldo(
  kode: string,
  sisaFaktur: number,
  belumDitagihkan: number,
  terbit: SaldoTerbit | null,
): CocokSaldoPelanggan {
  const kelompokSaldo = kode.includes(".") ? "online" : "lokal";
  const jumlah = sisaFaktur + belumDitagihkan;
  if (terbit === null) {
    return { sisaFaktur, belumDitagihkan, jumlah, kelompokSaldo, saldoPiutang: null, saldoPerTanggal: null, selisih: null };
  }
  // Baris snapshot memuat seluruh kunci master + buku; tak ada baris = tak ada posting = nol.
  const saldoPiutang = bulat(terbit.saldo.get(kode)?.[kelompokSaldo] ?? 0);
  return {
    sisaFaktur, belumDitagihkan, jumlah, kelompokSaldo,
    saldoPiutang, saldoPerTanggal: terbit.asOfDate, selisih: jumlah - saldoPiutang,
  };
}

/** Σ sisa per pelanggan. Faktur lunas bersisa nol, jadi cukup dari yang belum lunas. */
function sisaPerPelanggan(baris: readonly TagihanBaris[]): Map<string, number> {
  const peta = new Map<string, number>();
  for (const b of baris) {
    peta.set(b.faktur.customerCode, (peta.get(b.faktur.customerCode) ?? 0) + b.status.sisa);
  }
  return peta;
}

// ---------------------------------------------------------------------------
// S1 — daftar per unit, ekspor, ringkasan unit
// ---------------------------------------------------------------------------

interface BahanUnit {
  kesiapan: TagihanKesiapanSiap;
  /** Seluruh faktur yang ditarik: semua yang belum lunas (+ lunas pada periode bila diminta). */
  baris: TagihanBaris[];
  belumDitagihkan: BelumDitagihkanSql[];
  ubin: TagihanUbin;
  fakturBergantungTermin: number;
  terpotong: boolean;
}

async function muatUnit(
  unit: ScopedUnitId,
  hariIni: string,
  periodeLunas: PeriodeTagihan | null,
): Promise<BahanUnit | null> {
  const kesiapan = await getTagihanKesiapan(unit);
  if (!kesiapan.tersedia) return null;
  const [faktur, peta, belumDitagihkan] = await Promise.all([
    muatFaktur([unit], { periodeLunas }),
    getPetaTermin(unit),
    muatBelumDitagihkan([unit]),
  ]);
  const baris = faktur.rows.map((r) => keBaris(r, peta, hariIni));
  return {
    kesiapan,
    baris,
    belumDitagihkan,
    // Lunas dan lebih bayar tak masuk ubin mana pun (model), jadi ubin tak
    // bergantung pada saringan aktif maupun pada periode lunas.
    ubin: { ...summarizeTagihan(baris.map((b) => b.status)), belumDitagihkan: ubinBelumDitagihkan(belumDitagihkan) },
    fakturBergantungTermin: hitungBergantungTermin(baris),
    terpotong: faktur.terpotong,
  };
}

export interface TagihanRingkasanUnit {
  tersedia: true;
  kesiapan: TagihanKesiapanSiap;
  ubin: TagihanUbin;
  /** Faktur bersisa yang jatuh temponya bergantung pada termin SolaMax (catatan S4). */
  fakturBergantungTermin: number;
  /** Batas baris terlampaui: angka di layar TIDAK lengkap dan harus dikatakan. */
  terpotong: boolean;
}

/** Ubin + kesiapan satu unit tanpa daftar — untuk S4 dan kepala layar lain. */
export async function getTagihanRingkasanUnit(
  unit: ScopedUnitId,
  hariIni: string = todayWib(),
): Promise<TagihanBelumTersedia | TagihanRingkasanUnit> {
  const bahan = await muatUnit(unit, hariIni, null);
  if (bahan === null) return BELUM;
  const { kesiapan, ubin, fakturBergantungTermin, terpotong } = bahan;
  return { tersedia: true, kesiapan, ubin, fakturBergantungTermin, terpotong };
}

export interface TagihanDaftarInput {
  filter: TagihanFilter;
  /** Cari nama atau kode pelanggan, tak peka huruf besar; diterapkan sebelum halaman. */
  cari?: string | null;
  halaman?: string | number | null;
  /** Hanya dipakai saat `filter === "lunas"` (periode tanggal pelunasan). */
  periodeLunas: PeriodeTagihan;
  /** Tanggal bisnis WIB; bawaan `todayWib()`. */
  hariIni?: string;
}

interface TagihanDaftarDasar extends TagihanRingkasanUnit {
  filter: TagihanFilter;
  cari: string;
  /** Periode pelunasan yang berlaku; `null` bila saringannya bukan `lunas`. */
  periodeLunas: PeriodeTagihan | null;
}

export interface TagihanDaftar extends TagihanDaftarDasar {
  halaman: TagihanPage<TagihanBaris>;
}

export interface TagihanEkspor extends TagihanDaftarDasar {
  /** SELURUH baris saringan aktif, sudah diurutkan, tanpa halaman. */
  baris: TagihanBaris[];
}

async function susunDaftar(
  unit: ScopedUnitId,
  input: Omit<TagihanDaftarInput, "halaman">,
): Promise<TagihanBelumTersedia | TagihanEkspor> {
  const periodeLunas = input.filter === "lunas" ? input.periodeLunas : null;
  const bahan = await muatUnit(unit, input.hariIni ?? todayWib(), periodeLunas);
  if (bahan === null) return BELUM;
  const cari = (input.cari ?? "").trim();
  const kunci = kunciCari(cari);
  const baris = bahan.baris
    .filter((b) => matchesTagihanFilter(b.status, input.filter)
      && cocokCari(kunci, b.faktur.customerCode, b.namaPelanggan))
    .sort(compareTagihanRows);
  return {
    tersedia: true,
    kesiapan: bahan.kesiapan,
    ubin: bahan.ubin,
    fakturBergantungTermin: bahan.fakturBergantungTermin,
    terpotong: bahan.terpotong,
    filter: input.filter,
    cari,
    periodeLunas,
    baris,
  };
}

/** S1: satu halaman daftar + ubin + kesiapan. */
export async function getTagihanDaftar(
  unit: ScopedUnitId,
  input: TagihanDaftarInput,
): Promise<TagihanBelumTersedia | TagihanDaftar> {
  const hasil = await susunDaftar(unit, input);
  if (!hasil.tersedia) return hasil;
  const { baris, ...sisa } = hasil;
  return { ...sisa, halaman: paginateTagihan(baris, input.halaman) };
}

/** Ekspor CSV: baris yang sama dengan saringan aktif, tanpa halaman. */
export async function getTagihanEkspor(
  unit: ScopedUnitId,
  input: Omit<TagihanDaftarInput, "halaman">,
): Promise<TagihanBelumTersedia | TagihanEkspor> {
  return susunDaftar(unit, input);
}

// ---------------------------------------------------------------------------
// S3 — belum ditagihkan per pelanggan + cocok-silang R20
// ---------------------------------------------------------------------------

export interface BelumDitagihkanKelompok {
  customerCode: string;
  namaPelanggan: string | null;
  jumlahDokumen: number;
  /** Rupiah bulat. */
  total: number;
  /** Tanggal dokumen tertua. */
  tanggalTertua: string | null;
  cocokSaldo: CocokSaldoPelanggan;
}

export interface BelumDitagihkanDaftar extends TagihanRingkasanUnit {
  cari: string;
  /** Tertua dulu; SEMUA kelompok yang cocok dengan pencarian, tanpa halaman. */
  kelompok: BelumDitagihkanKelompok[];
  /** Tanggal snapshot Saldo pelanggan pembanding; `null` = belum tersedia. */
  saldoPerTanggal: string | null;
  /** Snapshot pembanding sedang menunggu pengganti. */
  saldoSedangDiperbarui: boolean;
}

export async function getBelumDitagihkan(
  unit: ScopedUnitId,
  input: { cari?: string | null; hariIni?: string } = {},
): Promise<TagihanBelumTersedia | BelumDitagihkanDaftar> {
  const [bahan, terbit] = await Promise.all([
    muatUnit(unit, input.hariIni ?? todayWib(), null),
    muatSaldoTerbit(unit),
  ]);
  if (bahan === null) return BELUM;
  const cari = (input.cari ?? "").trim();
  const kunci = kunciCari(cari);
  const sisa = sisaPerPelanggan(bahan.baris);
  const kelompok = bahan.belumDitagihkan
    .filter((r) => cocokCari(kunci, r.customerCode, r.namaPelanggan))
    .map((r): BelumDitagihkanKelompok => {
      const total = bulat(Number(r.total));
      return {
        customerCode: r.customerCode,
        namaPelanggan: r.namaPelanggan,
        jumlahDokumen: Number(r.jumlahDokumen),
        total,
        tanggalTertua: r.tanggalTertua,
        cocokSaldo: cocokSaldo(r.customerCode, sisa.get(r.customerCode) ?? 0, total, terbit),
      };
    });
  return {
    tersedia: true,
    kesiapan: bahan.kesiapan,
    ubin: bahan.ubin,
    fakturBergantungTermin: bahan.fakturBergantungTermin,
    terpotong: bahan.terpotong,
    cari,
    kelompok,
    saldoPerTanggal: terbit?.asOfDate ?? null,
    saldoSedangDiperbarui: terbit?.sedangDiperbarui ?? false,
  };
}

// ---------------------------------------------------------------------------
// Pembayaran — satu bentuk untuk rincian faktur (S2) dan tab pelanggan (S6)
// ---------------------------------------------------------------------------

export interface TagihanPembayaranBaris {
  /** Nomor pembayaran EasyMax. */
  kode: string;
  kodeFaktur: string;
  tanggal: string | null;
  /** Nomor bukti. */
  bukti: string | null;
  keterangan: string | null;
  /** Kode tempat kas/bank penerima di EasyMax. */
  tempatKas: string | null;
  jumlah: number;
  /** Pembayaran batal: ditampilkan dicoret, TIDAK pernah dihitung. */
  batal: boolean;
  alasanBatal: string | null;
  /** Faktur induknya sendiri batal. */
  fakturBatal: boolean;
}

const sqlPembayaran = (predikat: string): string => `
SELECT btrim(p.ckdbyr) AS kode,
       btrim(p.ckdtagih) AS "kodeFaktur",
       to_char(p.dtgl, 'YYYY-MM-DD') AS tanggal,
       NULLIF(btrim(p.vcbukti), '') AS bukti,
       NULLIF(btrim(p.vcket), '') AS keterangan,
       NULLIF(btrim(p.ctmpkas), '') AS "tempatKas",
       COALESCE(p.ntotal, 0)::float8 AS jumlah,
       (COALESCE(p.sbatal, 0) <> 0) AS batal,
       NULLIF(btrim(p.vcalasan), '') AS "alasanBatal",
       (COALESCE(h.sbatal, 0) <> 0) AS "fakturBatal"
  FROM public.tagihan_bayar p
  JOIN public.tagihan_header h
    ON h.unit_id = p.unit_id AND h.ckdtagih = p.ckdtagih
 WHERE p.unit_id = $1::smallint
   AND ${predikat}
 ORDER BY p.dtgl DESC NULLS LAST, p.ckdbyr DESC
 LIMIT $3::int`;

const SQL_PEMBAYARAN_FAKTUR = sqlPembayaran("p.ckdtagih = $2::bpchar");
const SQL_PEMBAYARAN_PELANGGAN = sqlPembayaran("btrim(h.ckdplg) = $2::text");

async function muatPembayaran(unit: ScopedUnitId, sql: string, kunci: string): Promise<TagihanPembayaranBaris[]> {
  const rows = await qScoped<TagihanPembayaranBaris>(unit, sql, [unit, kunci, BATAS_BARIS_TAGIHAN]);
  return rows.map((r) => ({ ...r, jumlah: Number(r.jumlah), batal: r.batal === true, fakturBatal: r.fakturBatal === true }));
}

// ---------------------------------------------------------------------------
// S2 — rincian faktur
// ---------------------------------------------------------------------------

export interface TagihanDokumenFaktur {
  /** Nomor dokumen penjualan yang ditautkan faktur. */
  kodeDokumen: string;
  /** Tanggal & jumlah dari cermin buku piutang; `null` = dokumennya tak ada di buku. */
  tanggal: string | null;
  jumlah: number | null;
}

export interface TagihanFakturRinci {
  kesiapan: TagihanKesiapanSiap;
  faktur: TagihanFaktur;
  namaPelanggan: string | null;
  tanggalFakturKosong: boolean;
  /** `null` hanya untuk faktur BATAL — faktur batal tak punya status. */
  status: TagihanStatus | null;
  alasanBatal: string | null;
  keterangan: string | null;
  /** Jenis tagihan EasyMax, apa adanya (artinya belum dikunci). */
  jenisTagihan: number | null;
  /** Total sebelum admin dan biaya admin, apa adanya dari EasyMax. */
  nilaiPokok: number | null;
  biayaAdmin: number | null;
  dokumen: TagihanDokumenFaktur[];
  /** Σ jumlah dokumen yang ada di buku piutang, rupiah bulat. */
  totalDokumen: number;
  /** Banyaknya dokumen tertaut yang tak ditemukan di buku piutang. */
  dokumenTanpaBuku: number;
  /** Semua pembayaran, TERMASUK yang batal (beserta alasannya), terbaru dulu. */
  pembayaran: TagihanPembayaranBaris[];
}

interface FakturRinciSql extends KesiapanSql {
  kode: string;
  customerCode: string;
  namaPelanggan: string | null;
  tanggalFaktur: string | null;
  jatuhTempoEasymax: string | null;
  nilai: number;
  statusEasymax: number | null;
  sisaEasymax: number | null;
  batal: boolean;
  alasanBatal: string | null;
  keterangan: string | null;
  jenisTagihan: number | null;
  nilaiPokok: number | null;
  biayaAdmin: number | null;
}

/**
 * $1 unit, $2 kode faktur. Digabung dengan `tagihan_cycle`: unit yang belum pernah
 * menyelesaikan siklus tidak memulangkan faktur apa pun (KTD11), walau
 * potongan parsialnya sudah mendarat.
 */
const SQL_FAKTUR_RINCI = `
SELECT c.unit_id::int AS "unitId",
       to_char(c.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "selesaiAt",
       to_char(c.completed_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') AS "selesaiWib",
       c.header_count AS "jumlahFaktur",
       c.bayar_count AS "jumlahPembayaran",
       (SELECT to_char(max(p.dtgl), 'YYYY-MM-DD')
          FROM public.tagihan_bayar p
         WHERE p.unit_id = c.unit_id AND COALESCE(p.sbatal, 0) = 0) AS "pembayaranTerakhir",
       btrim(h.ckdtagih) AS kode,
       COALESCE(btrim(h.ckdplg), '') AS "customerCode",
       (SELECT max(pm.vcnmplg)
          FROM public.pelanggan_master pm
         WHERE pm.unit_id = h.unit_id AND btrim(pm.ckdplg) = btrim(h.ckdplg)) AS "namaPelanggan",
       to_char(h.dtgl, 'YYYY-MM-DD') AS "tanggalFaktur",
       to_char(h.dtgljt, 'YYYY-MM-DD') AS "jatuhTempoEasymax",
       ${SQL_NILAI_FAKTUR}::float8 AS nilai,
       h.nstatus::int AS "statusEasymax",
       h.nlastsaldo::float8 AS "sisaEasymax",
       (COALESCE(h.sbatal, 0) <> 0) AS batal,
       NULLIF(btrim(h.vcalasan), '') AS "alasanBatal",
       NULLIF(btrim(h.vcket), '') AS keterangan,
       h.sjenistag::int AS "jenisTagihan",
       h.ntotal::float8 AS "nilaiPokok",
       h.nadm::float8 AS "biayaAdmin"
  FROM public.tagihan_header h
  JOIN public.tagihan_cycle c ON c.unit_id = h.unit_id
 WHERE h.unit_id = $1::smallint
   AND h.ckdtagih = $2::bpchar`;

/** Tautan faktur → dokumen penjualan. $1 unit, $2 kode faktur. Dilayani PK. */
const SQL_TAUTAN_FAKTUR = `
SELECT btrim(d.ckdjualplg) AS "kodeDokumen"
  FROM public.tagihan_detail d
 WHERE d.unit_id = $1::smallint
   AND d.ckdtagih = $2::bpchar
 ORDER BY d.ckdjualplg`;

/**
 * Tanggal & jumlah dokumen dari posting debet hidup buku piutang.
 * $1 unit, $2 larik nomor dokumen (sudah dipangkas).
 *
 * Dua langkah (tautan dulu, lalu buku dengan `= ANY(larik)`), bukan satu join:
 * di bawah RLS index ekspresi 0063 tak bisa melayani `trim(b.vcref) = …`
 * (lihat catatan di kueri belum ditagihkan), sehingga join lateral memindai
 * seluruh posting unit SEKALI PER DOKUMEN. Bentuk ini memindainya sekali saja
 * dengan pencocokan larik ber-hash. Predikatnya tetap `trim(b.vcref) = …`,
 * jadi begitu index itu bisa dipakai, kueri ini memakainya tanpa diubah.
 */
const SQL_BUKU_DOKUMEN = `
SELECT trim(b.vcref) AS "kodeDokumen",
       to_char(min(b.dtgl), 'YYYY-MM-DD') AS tanggal,
       sum(b.njumlah)::float8 AS jumlah
  FROM public.bppiut b
 WHERE b.unit_id = $1::smallint
   AND trim(b.vcref) = ANY($2::text[])
   AND COALESCE(b.sbatal, 0) = 0
   AND b.sjnsbp = 1
 GROUP BY trim(b.vcref)`;

/** Dokumen yang tak ada di buku TETAP tampil, dengan tanggal & jumlah `null`. */
async function muatDokumenFaktur(unit: ScopedUnitId, kodeFaktur: string): Promise<TagihanDokumenFaktur[]> {
  const tautan = await qScoped<{ kodeDokumen: string }>(unit, SQL_TAUTAN_FAKTUR, [unit, kodeFaktur]);
  if (tautan.length === 0) return [];
  const kodeDokumen = tautan.map((t) => t.kodeDokumen);
  const buku = await qScoped<TagihanDokumenFaktur>(unit, SQL_BUKU_DOKUMEN, [unit, kodeDokumen]);
  const peta = new Map(buku.map((b) => [b.kodeDokumen, b]));
  return kodeDokumen
    .map((kode): TagihanDokumenFaktur => {
      const b = peta.get(kode);
      return { kodeDokumen: kode, tanggal: b?.tanggal ?? null, jumlah: b?.jumlah == null ? null : Number(b.jumlah) };
    })
    // Urut tanggal (yang tak ada di buku di akhir), lalu nomor dokumen.
    .sort((x, y) => x.tanggal === y.tanggal
      ? (x.kodeDokumen < y.kodeDokumen ? -1 : x.kodeDokumen > y.kodeDokumen ? 1 : 0)
      : x.tanggal === null ? 1 : y.tanggal === null ? -1 : x.tanggal < y.tanggal ? -1 : 1);
}

/**
 * Rincian satu faktur. `null` = kode tak dikenal, faktur milik unit lain
 * (tak terlihat: `unit_id` + RLS), atau unitnya belum punya siklus lengkap.
 * Faktur BATAL tetap dipulangkan, tanpa status.
 */
export async function getTagihanFaktur(
  unit: ScopedUnitId,
  kodeFaktur: string,
  hariIni: string = todayWib(),
): Promise<TagihanFakturRinci | null> {
  const kode = pangkas(kodeFaktur);
  if (kode === "") return null;
  const [kepala, dokumen, pembayaran, peta] = await Promise.all([
    qScoped<FakturRinciSql>(unit, SQL_FAKTUR_RINCI, [unit, kode]),
    muatDokumenFaktur(unit, kode),
    muatPembayaran(unit, SQL_PEMBAYARAN_FAKTUR, kode),
    getPetaTermin(unit),
  ]);
  const h = kepala[0];
  if (!h) return null;

  const kosong = h.tanggalFaktur === null;
  const faktur: TagihanFaktur = {
    kode: h.kode,
    customerCode: h.customerCode,
    tanggalFaktur: h.tanggalFaktur ?? "",
    jatuhTempoEasymax: h.jatuhTempoEasymax,
    nilai: Number(h.nilai),
    statusEasymax: h.statusEasymax === null ? null : Number(h.statusEasymax),
    sisaEasymax: h.sisaEasymax === null ? null : Number(h.sisaEasymax),
    batal: h.batal === true,
  };
  // Di sini model menerima baris pembayaran yang SEBENARNYA, batalnya ikut.
  const status = deriveTagihanStatus(
    kosong ? { ...faktur, jatuhTempoEasymax: null } : faktur,
    pembayaran.map((p) => ({ jumlah: p.jumlah, batal: p.batal })),
    kosong ? TANPA_TERMIN : terminUntuk(peta, h.customerCode),
    hariIni,
  );
  return {
    kesiapan: {
      tersedia: true,
      selesaiAt: h.selesaiAt,
      selesaiWib: h.selesaiWib,
      jumlahFaktur: h.jumlahFaktur,
      jumlahPembayaran: h.jumlahPembayaran,
      pembayaranTerakhir: h.pembayaranTerakhir,
    },
    faktur,
    namaPelanggan: h.namaPelanggan,
    tanggalFakturKosong: kosong,
    status,
    alasanBatal: h.alasanBatal,
    keterangan: h.keterangan,
    jenisTagihan: h.jenisTagihan === null ? null : Number(h.jenisTagihan),
    nilaiPokok: h.nilaiPokok === null ? null : Number(h.nilaiPokok),
    biayaAdmin: h.biayaAdmin === null ? null : Number(h.biayaAdmin),
    dokumen,
    totalDokumen: bulat(dokumen.reduce((t, d) => t + (d.jumlah ?? 0), 0)),
    dokumenTanpaBuku: dokumen.filter((d) => d.jumlah === null).length,
    pembayaran,
  };
}

// ---------------------------------------------------------------------------
// S6 — tab Tagihan & Pembayaran di halaman pelanggan
// ---------------------------------------------------------------------------

export interface TagihanPelanggan {
  tersedia: true;
  kesiapan: TagihanKesiapanSiap;
  customerCode: string;
  /** SELURUH faktur hidup pelanggan ini (lunas ikut), urutan bawaan model. */
  faktur: TagihanBaris[];
  /** Pembayaran lintas faktur, termasuk yang batal, terbaru dulu. */
  pembayaran: TagihanPembayaranBaris[];
  belumDitagihkan: { jumlahDokumen: number; total: number; tanggalTertua: string | null };
  cocokSaldo: CocokSaldoPelanggan;
  terpotong: boolean;
}

/** Kode boleh berpengisi spasi, bergaris miring, atau bertitik — dicocokkan sebagai `btrim(ckdplg)`. */
export async function getTagihanPelanggan(
  unit: ScopedUnitId,
  kodePelanggan: string,
  hariIni: string = todayWib(),
): Promise<TagihanBelumTersedia | TagihanPelanggan> {
  const kode = pangkas(kodePelanggan);
  const kesiapan = await getTagihanKesiapan(unit);
  if (!kesiapan.tersedia) return BELUM;
  const [faktur, peta, pembayaran, belum, terbit] = await Promise.all([
    muatFaktur([unit], { kodePelanggan: kode, semua: true }),
    getPetaTermin(unit),
    muatPembayaran(unit, SQL_PEMBAYARAN_PELANGGAN, kode),
    muatBelumDitagihkan([unit], kode),
    muatSaldoTerbit(unit, kode),
  ]);
  const baris = faktur.rows.map((r) => keBaris(r, peta, hariIni)).sort(compareTagihanRows);
  const belumDitagihkan = {
    jumlahDokumen: Number(belum[0]?.jumlahDokumen ?? 0),
    total: bulat(Number(belum[0]?.total ?? 0)),
    tanggalTertua: belum[0]?.tanggalTertua ?? null,
  };
  const sisaFaktur = baris.reduce((t, b) => t + b.status.sisa, 0);
  return {
    tersedia: true,
    kesiapan,
    customerCode: kode,
    faktur: baris,
    pembayaran,
    belumDitagihkan,
    cocokSaldo: cocokSaldo(kode, sisaFaktur, belumDitagihkan.total, terbit),
    terpotong: faktur.terpotong,
  };
}

// ---------------------------------------------------------------------------
// S5 — ringkasan lintas SPBU (R21)
// ---------------------------------------------------------------------------

export type RingkasanTagihanUnit =
  | { unitId: ScopedUnitId; tersedia: false }
  | {
      unitId: ScopedUnitId;
      tersedia: true;
      kesiapan: TagihanKesiapanSiap;
      ubin: TagihanUbin;
      /** Tanggal pembayaran hidup terakhir yang tercatat (= `kesiapan.pembayaranTerakhir`). */
      pembayaranTerakhir: string | null;
    };

export interface RingkasanTagihanLintasUnit {
  /** Satu baris per unit yang diserahkan, dalam urutan yang sama. */
  unit: RingkasanTagihanUnit[];
  /** Batas baris gabungan terlampaui: angka TIDAK lengkap. */
  terpotong: boolean;
}

interface TerminSql {
  unitId: number;
  kodePelanggan: string | null;
  terminHari: number;
}

/**
 * Termin berlaku untuk BANYAK unit dalam satu kueri — bentuk hasilnya sama
 * dengan `getPetaTermin` (yang hanya menerima satu unit), supaya ringkasan
 * tidak membuka satu kueri per unit.
 */
const SQL_TERMIN_BANYAK_UNIT = `
SELECT unit_id::int AS "unitId", NULL::text AS "kodePelanggan", termin_hari AS "terminHari"
  FROM app.termin_unit
 WHERE unit_id = ANY($1::int[]) AND NOT void
UNION ALL
SELECT unit_id::int, kode_pelanggan::text, termin_hari
  FROM app.termin_pelanggan
 WHERE unit_id = ANY($1::int[]) AND NOT void`;

async function muatPetaTerminBanyak(units: readonly ScopedUnitId[]): Promise<Map<number, PetaTermin>> {
  const sementara = new Map<number, { terminUnit: number | null; terminPelanggan: Map<string, number> }>();
  for (const u of units) sementara.set(Number(u), { terminUnit: null, terminPelanggan: new Map() });
  const rows = await qScoped<TerminSql>(units, SQL_TERMIN_BANYAK_UNIT, [units]);
  for (const r of rows) {
    const peta = sementara.get(Number(r.unitId));
    if (!peta) continue;
    if (r.kodePelanggan === null) peta.terminUnit = Number(r.terminHari);
    else peta.terminPelanggan.set(r.kodePelanggan, Number(r.terminHari));
  }
  return sementara;
}

/**
 * Empat angka ubin, pembayaran terakhir dan kesegaran untuk setiap unit dalam
 * larik — 4 kueri untuk seluruhnya (1 kesiapan, lalu 3 paralel hanya atas unit
 * yang SIAP). Unit tanpa siklus lengkap dipulangkan `tersedia: false`, tidak
 * pernah sebagai nol. Baris hasil hanya dibentuk dari larik yang diserahkan:
 * unit di luarnya tidak mungkin ikut, walau basis data memulangkannya.
 */
export async function getRingkasanTagihanLintasUnit(
  units: readonly ScopedUnitId[],
  hariIni: string = todayWib(),
): Promise<RingkasanTagihanLintasUnit> {
  if (units.length === 0) return { unit: [], terpotong: false };
  const kesiapan = await muatKesiapan(units);
  const siap = units.filter((u) => kesiapan.has(Number(u)));
  if (siap.length === 0) return { unit: units.map((unitId) => ({ unitId, tersedia: false })), terpotong: false };

  const [faktur, petaTermin, belum] = await Promise.all([
    muatFaktur(siap),
    muatPetaTerminBanyak(siap),
    muatBelumDitagihkan(siap),
  ]);
  const statusPerUnit = new Map<number, TagihanStatus[]>();
  const belumPerUnit = new Map<number, BelumDitagihkanSql[]>();
  for (const u of siap) {
    statusPerUnit.set(Number(u), []);
    belumPerUnit.set(Number(u), []);
  }
  for (const r of faktur.rows) {
    const peta = petaTermin.get(Number(r.unitId));
    const wadah = statusPerUnit.get(Number(r.unitId));
    if (!peta || !wadah) continue;
    wadah.push(keBaris(r, peta, hariIni).status);
  }
  for (const r of belum) belumPerUnit.get(Number(r.unitId))?.push(r);

  return {
    unit: units.map((unitId): RingkasanTagihanUnit => {
      const k = kesiapan.get(Number(unitId));
      if (!k) return { unitId, tersedia: false };
      return {
        unitId,
        tersedia: true,
        kesiapan: k,
        ubin: {
          ...summarizeTagihan(statusPerUnit.get(Number(unitId)) ?? []),
          belumDitagihkan: ubinBelumDitagihkan(belumPerUnit.get(Number(unitId)) ?? []),
        },
        pembayaranTerakhir: k.pembayaranTerakhir,
      };
    }),
    terpotong: faktur.terpotong,
  };
}
