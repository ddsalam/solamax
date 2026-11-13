import { qScoped } from "./db";
import { todayWib } from "./periods";
import { getSaldoSnapshot } from "./saldo-snapshot";
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
import { getPetaTermin, kunciTermin, terminUntuk, type PetaTermin } from "./termin-queries";

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
 * posting buku piutang + tautan faktur unit itu, dibayar setiap kali ubinnya
 * tampil (angka terukurnya di catatan kuerinya). Karena itu ia dibaca PALING
 * BANYAK SEKALI per permintaan: kelompok dan dokumennya keluar dari satu kueri
 * yang sama, dan pemanggil yang tak memerlukannya (layar Atur termin) tidak
 * menjalankannya sama sekali.
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
  /** `null` = sumber tak memberi nilai (lihat {@link SQL_NILAI_FAKTUR}). */
  nilai: number | null;
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

/**
 * Nilai faktur = grand total BILA TERISI (bukan nol); bila tidak, total
 * (admin tak pernah dipakai — probe 13 Nov — jadi keduanya sama bila sama-sama
 * terisi). Grand total nol dengan total terisi TIDAK boleh menang: fakturnya
 * akan bernilai nol, dihitung lunas, dan lenyap dari daftar.
 *
 * Keduanya nol/kosong → `NULL`, bukan nol: model menandainya `nilaiKosong`,
 * fakturnya tetap "Perlu tindakan" dan tak pernah lunas diam-diam.
 */
const SQL_NILAI_FAKTUR = "COALESCE(NULLIF(h.ngatot, 0), NULLIF(h.ntotal, 0))";

/**
 * $1 unit[], $2/$3 periode lunas (atau NULL), $4 kode pelanggan (atau NULL),
 * $5 sertakan SEMUA faktur hidup, $6 batas baris.
 *
 * Faktur TERBUKA tidak pernah dibatasi tanggal (R7). Saringan SQL-nya sengaja
 * KONSERVATIF — "jumlah bayar hidup berbeda dari nilai faktur" pada numerik
 * eksak: ia hanya membuang faktur yang PASTI lunas, tidak pernah yang mungkin
 * belum. Yang lolos tetapi lunas sesudah pembulatan rupiah diputuskan model.
 * Faktur tanpa nilai (`NULL`) selalu lolos: `IS DISTINCT FROM NULL` benar.
 *
 * Faktur LUNAS hanya ikut bila periodenya diminta, dan periodenya diukur pada
 * TANGGAL PELUNASAN = pembayaran hidup terakhir (cadangan: tanggal faktur,
 * untuk faktur lunas tanpa pembayaran). Bukan tanggal faktur: yang
 * ditanyakan keuangan adalah "apa yang dibayar bulan ini", dan faktur tiga
 * bulan lalu yang dilunasi kemarin harus muncul di bulan ini — sama dengan
 * cara menu "Pembayaran Tagihan Pelanggan" EasyMax dibaca per periode.
 *
 * ⚠️ Cabang periode di SQL ini TIDAK cukup sendirian: faktur yang lunas hanya
 * SESUDAH pembulatan rupiah lolos lewat cabang "berbeda dari nilai faktur",
 * tanpa melihat periode. Karena itu periode yang sama diterapkan sekali lagi
 * di JS ({@link dalamPeriodeLunas}) untuk saringan `lunas`.
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
    nilai: r.nilai === null ? null : Number(r.nilai),
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

/**
 * Periode pelunasan, diterapkan di JS dengan aturan yang SAMA dengan SQL:
 * tanggal pembayaran hidup terakhir, cadangan tanggal faktur. Tanpa keduanya
 * (tanggal faktur kosong dan tak ada pembayaran) = di luar periode mana pun.
 */
function dalamPeriodeLunas(b: TagihanBaris, periode: PeriodeTagihan): boolean {
  const tanggal = b.tanggalBayarTerakhir ?? (b.tanggalFakturKosong ? null : b.faktur.tanggalFaktur);
  return tanggal !== null && tanggal >= periode.from && tanggal <= periode.to;
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
 * menyembunyikan penjualan. Tanpa lantai tanggal (KTD8).
 *
 * Tiga aturan yang mudah keliru:
 *   · **Satu dokumen = (unit, rujukan, PELANGGAN).** Rujukan yang sama bisa
 *     diposting ke dua pelanggan; masing-masing membawa jumlahnya sendiri —
 *     tidak dilebur ke satu kode. "Tertaut ke faktur hidup" tetap diputuskan
 *     per (unit, rujukan): tautan faktur tak menyimpan kode pelanggan, jadi
 *     satu tautan menutup rujukan itu untuk semua pelanggannya.
 *   · **Kredit hidup ber-rujukan sama, milik pelanggan yang sama, mengurangi
 *     debetnya** (`sjnsbp = 2`: retur/pembalikan penjualan). Dokumen yang
 *     netonya ≤ 0 sudah dibalik dan BUKAN "belum ditagihkan". Kredit tanpa
 *     debet (pembayaran biasa) tidak pernah menjadi dokumen.
 *   · **Awalan JP/UV tidak peka huruf besar/kecil** (`ILIKE`), seperti
 *     EasyMax membandingkannya. Rujukan dan kode pelanggan sendiri tetap
 *     dicocokkan PERSIS (sesudah dipangkas).
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
 * Bentuk di bawah menyatukan kedua sumber, mengelompokkannya per (rujukan,
 * pelanggan), lalu menyebarkan "tertaut" ke seluruh rujukan lewat fungsi
 * jendela; ongkosnya satu lintasan atas posting + tautan unit itu ditambah
 * satu pengurutan hasil kelompoknya, dan TIDAK bergantung pada taksiran
 * perencana.
 *
 * ⏱️ Terukur di Postgres 16 lokal, role ber-RLS, 300 ribu posting + 255 ribu
 * tautan ilustratif satu unit: ±0,70 dtk (tiga kali jalan 0,69–0,72 dtk), sama
 * dengan dan tanpa `ANALYZE`, sama dengan dan tanpa dokumen. Bentuk sebelumnya
 * (kelompok per rujukan saja) ±0,47 dtk pada data yang sama; selisihnya adalah
 * harga fungsi jendela atas ±470 ribu kelompok. Dulu membuka satu kelompok
 * atau mengekspor menjalankannya DUA kali; sekarang sekali.
 *
 * Rujukan tetap dibandingkan dalam bentuk `trim(b.vcref)` — konvensi repo.
 * $1 unit[], $2 kode pelanggan (atau NULL).
 */
const SQL_BELUM_DITAGIHKAN_DOKUMEN_DASAR = `
    SELECT g.unit_id, g.ref, g.kode, g.tanggal, g.jumlah, g.keterangan
      FROM (
        SELECT z.unit_id, z.ref, z.kode,
               min(z.dtgl) FILTER (WHERE z.debet) AS tanggal,
               COALESCE(sum(z.njumlah) FILTER (WHERE z.debet), 0)
                 - COALESCE(sum(z.njumlah) FILTER (WHERE NOT z.debet), 0) AS jumlah,
               max(z.vcket) FILTER (WHERE z.debet) AS keterangan,
               COALESCE(bool_or(z.debet), false) AS ada_debet,
               bool_or(bool_or(z.tertaut)) OVER (PARTITION BY z.unit_id, z.ref) AS tertaut
          FROM (
            SELECT b.unit_id, trim(b.vcref) AS ref, btrim(b.ckdplg) AS kode,
                   b.dtgl, b.njumlah, b.vcket, (b.sjnsbp = 1) AS debet, false AS tertaut
              FROM public.bppiut b
             WHERE b.unit_id = ANY($1::int[])
               AND COALESCE(b.sbatal, 0) = 0
               AND b.sjnsbp IN (1, 2)
               AND (trim(b.vcref) ILIKE 'JP%' OR trim(b.vcref) ILIKE 'UV%')
               AND ($2::text IS NULL OR btrim(b.ckdplg) = $2::text)
               AND ${SQL_POPULASI_PIUTANG}
            UNION ALL
            SELECT d.unit_id, btrim(d.ckdjualplg), NULL::text,
                   NULL::date, NULL::numeric, NULL::text, NULL::boolean, true
              FROM public.tagihan_detail d
              JOIN public.tagihan_header fh
                ON fh.unit_id = d.unit_id AND fh.ckdtagih = d.ckdtagih
             WHERE d.unit_id = ANY($1::int[])
               AND COALESCE(fh.sbatal, 0) = 0
          ) z
         GROUP BY z.unit_id, z.ref, z.kode
      ) g
     WHERE NOT g.tertaut
       AND g.ada_debet
       AND g.jumlah > 0`;

/**
 * Kelompok per pelanggan DAN (bila diminta) dokumennya — SATU kueri, supaya
 * buku piutang dipindai sekali saja: `dok` dimaterialkan, lalu dibaca dua kali.
 * Baris `jenis = 'kelompok'` selalu ada; baris `jenis = 'dokumen'` hanya bila
 * $3 benar.
 *
 * $1 unit[], $2 kode pelanggan (atau NULL), $3 sertakan dokumen,
 * $4 kode pelanggan dokumennya (atau NULL = semua), $5 batas baris dokumen.
 */
const SQL_BELUM_DITAGIHKAN = `
WITH dok AS MATERIALIZED (${SQL_BELUM_DITAGIHKAN_DOKUMEN_DASAR}
), nama AS (${SQL_NAMA_PELANGGAN}
)
SELECT s.jenis, s."unitId", s."customerCode", s."namaPelanggan", s."jumlahDokumen", s.total,
       s."tanggalTertua", s."kodeDokumen", s.tanggal, s.jumlah, s.keterangan
  FROM (
    SELECT 'kelompok'::text AS jenis,
           x.unit_id::int AS "unitId",
           x.kode AS "customerCode",
           pm.nama AS "namaPelanggan",
           x.n::int AS "jumlahDokumen",
           x.total::float8 AS total,
           to_char(x.tertua, 'YYYY-MM-DD') AS "tanggalTertua",
           NULL::text AS "kodeDokumen",
           NULL::text AS tanggal,
           NULL::float8 AS jumlah,
           NULL::text AS keterangan,
           row_number() OVER (ORDER BY x.unit_id, x.tertua, x.kode) AS urut
      FROM (
        SELECT dok.unit_id, dok.kode, count(*) AS n, sum(dok.jumlah) AS total, min(dok.tanggal) AS tertua
          FROM dok
         GROUP BY dok.unit_id, dok.kode
      ) x
      LEFT JOIN nama pm ON pm.unit_id = x.unit_id AND pm.kode = x.kode
    UNION ALL
    SELECT 'dokumen'::text,
           y.unit_id::int,
           y.kode,
           pm.nama,
           NULL::int,
           NULL::float8,
           NULL::text,
           y.ref,
           to_char(y.tanggal, 'YYYY-MM-DD'),
           y.jumlah::float8,
           y.keterangan,
           y.urut
      FROM (
        SELECT dok.unit_id, dok.kode, dok.ref, dok.tanggal, dok.jumlah, dok.keterangan,
               row_number() OVER (ORDER BY dok.tanggal, dok.kode, dok.ref) AS urut
          FROM dok
         WHERE $3::boolean
           AND ($4::text IS NULL OR dok.kode = $4::text)
         ORDER BY dok.tanggal, dok.kode, dok.ref
         LIMIT $5::int
      ) y
      LEFT JOIN nama pm ON pm.unit_id = y.unit_id AND pm.kode = y.kode
  ) s
 ORDER BY s.jenis, s.urut`;

interface BelumDitagihkanSql {
  unitId: number;
  customerCode: string;
  namaPelanggan: string | null;
  jumlahDokumen: number;
  total: number;
  tanggalTertua: string | null;
}

export interface BelumDitagihkanDokumen {
  customerCode: string;
  namaPelanggan: string | null;
  /** Nomor dokumen penjualan / pemakaian voucher (rujukan buku piutang). */
  kodeDokumen: string;
  tanggal: string;
  /** Debet dikurangi kredit hidup ber-rujukan sama milik pelanggan yang sama. */
  jumlah: number;
  keterangan: string | null;
}

/**
 * Dokumen mana yang ikut ditarik bersama kelompoknya: `"semua"` (ekspor), atau
 * milik satu pelanggan (membuka satu kelompok di S3).
 */
export type PilihanDokumenBelumDitagihkan = "semua" | { kodePelanggan: string };

/** Dokumen belum ditagihkan, tertua dulu; `terpotong` = batas baris terlampaui. */
export interface DokumenBelumDitagihkan {
  dokumen: BelumDitagihkanDokumen[];
  terpotong: boolean;
}

interface BelumDitagihkanGabungSql extends BelumDitagihkanSql {
  jenis?: "kelompok" | "dokumen";
  kodeDokumen: string | null;
  tanggal: string | null;
  jumlah: number | null;
  keterangan: string | null;
}

interface BelumDitagihkanMuatan {
  kelompok: BelumDitagihkanSql[];
  /** `null` = dokumen tidak diminta. */
  dokumen: DokumenBelumDitagihkan | null;
}

const TANPA_BELUM_DITAGIHKAN: BelumDitagihkanMuatan = { kelompok: [], dokumen: null };

/** SATU lintasan buku piutang, berapa pun yang diminta darinya. */
async function muatBelumDitagihkan(
  units: readonly ScopedUnitId[],
  opsi: { kodePelanggan?: string | null; dokumen?: PilihanDokumenBelumDitagihkan } = {},
): Promise<BelumDitagihkanMuatan> {
  if (units.length === 0) return TANPA_BELUM_DITAGIHKAN;
  const pilih = opsi.dokumen;
  const rows = await qScoped<BelumDitagihkanGabungSql>(units, SQL_BELUM_DITAGIHKAN, [
    units,
    opsi.kodePelanggan ?? null,
    pilih !== undefined,
    pilih === undefined || pilih === "semua" ? null : pangkas(pilih.kodePelanggan),
    BATAS_BARIS_TAGIHAN + 1,
  ]);
  const kelompok: BelumDitagihkanSql[] = [];
  const dokumen: BelumDitagihkanDokumen[] = [];
  for (const r of rows) {
    if (r.jenis === "dokumen") {
      dokumen.push({
        customerCode: r.customerCode,
        namaPelanggan: r.namaPelanggan,
        kodeDokumen: r.kodeDokumen ?? "",
        tanggal: r.tanggal ?? "",
        jumlah: Number(r.jumlah ?? 0),
        keterangan: r.keterangan,
      });
    } else {
      kelompok.push({
        unitId: r.unitId,
        customerCode: r.customerCode,
        namaPelanggan: r.namaPelanggan,
        jumlahDokumen: r.jumlahDokumen,
        total: r.total,
        tanggalTertua: r.tanggalTertua,
      });
    }
  }
  return {
    kelompok,
    dokumen: pilih === undefined
      ? null
      : { dokumen: dokumen.slice(0, BATAS_BARIS_TAGIHAN), terpotong: dokumen.length > BATAS_BARIS_TAGIHAN },
  };
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

interface SaldoTerbit {
  asOfDate: string;
  sedangDiperbarui: boolean;
  saldo: Map<string, { lokal: number; online: number }>;
}

/**
 * Saldo akhir piutang per pelanggan dari snapshot TERBIT terakhir — dibaca
 * lewat pembaca yang sama dengan layar Saldo pelanggan (`getSaldoSnapshot`),
 * bukan lewat kueri sendiri. Pointer terbit saja BELUM bukti: pembaca itu
 * mensyaratkan bukti integritas generasinya (`saldo-snapshot.ts:231-255`
 * `verified`: jumlah baris, checksum ber-kunci dan delapan belas total harus
 * sama dengan manifest; `:367-390` baris penjaga `integrityVerified` harus ada
 * dan jumlah baris harus sama dengan `rowCount` pointer). Rowset yang tak
 * lengkap memulangkan `not_ready` di sana, dan di sini menjadi `null` —
 * "belum tersedia", TIDAK PERNAH "saldo 0".
 *
 * Bukti itu butuh seluruh rowset, jadi tak ada varian satu-pelanggan: halaman
 * pelanggan membaca rowset yang sama lalu mengambil satu kuncinya.
 */
async function muatSaldoTerbit(unit: ScopedUnitId): Promise<SaldoTerbit | null> {
  const terakhir = await getSaldoTerbitTerakhir(unit);
  if (terakhir === null) return null;
  const snapshot = await getSaldoSnapshot(unit, terakhir.asOfDate);
  if (snapshot.status !== "ready") return null;
  const saldo = new Map<string, { lokal: number; online: number }>();
  for (const r of snapshot.rows) {
    saldo.set(pangkas(r.customerCode), { lokal: Number(r.akhirPiutangLokal), online: Number(r.akhirPiutangOnline) });
  }
  return { asOfDate: terakhir.asOfDate, sedangDiperbarui: snapshot.metadata.pendingReplacement === true, saldo };
}

/**
 * $1 unit, $2 kode pelanggan. Tanggal snapshot terbit terakhir BILA pelanggan
 * itu punya baris di generasinya — satu baris, atau tidak ada.
 */
const SQL_TANGGAL_SALDO_PELANGGAN = `
SELECT to_char(t.as_of_date, 'YYYY-MM-DD') AS "asOfDate"
  FROM (${SQL_POINTER_TERBIT_TERAKHIR}) t
 WHERE EXISTS (
   SELECT 1
     FROM app.saldo_pelanggan_snapshot_row r
    WHERE r.unit_id = $1::smallint
      AND r.as_of_date = t.as_of_date
      AND r.generation_id = t.generation_id
      AND btrim(r.customer_code) = $2::text)`;

/**
 * Tanggal Saldo pelanggan tempat halaman pelanggan ini PASTI ada: halaman itu
 * (`piutang/[date]/pelanggan/[...customerCode]`) menjawab 404 untuk pelanggan
 * yang tak punya baris di snapshot tanggalnya. `null` = kode kosong, unit belum
 * punya snapshot terbit, atau pelanggannya tak ada di snapshot terbit terakhir
 * — pemanggil menampilkan teks biasa, bukan tautan.
 */
export async function getTanggalSaldoPelanggan(unit: ScopedUnitId, kodePelanggan: string): Promise<string | null> {
  const kode = pangkas(kodePelanggan);
  if (kode === "") return null;
  const rows = await qScoped<{ asOfDate: string }>(unit, SQL_TANGGAL_SALDO_PELANGGAN, [unit, kode]);
  return rows[0]?.asOfDate ?? null;
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
  /**
   * Saldo akhir piutang kelompok itu di snapshot terbit terakhir; `null` = belum
   * tersedia (belum ada snapshot terbit, atau rowset-nya tak lolos bukti integritas).
   */
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

interface BahanUnit<Belum> {
  kesiapan: TagihanKesiapanSiap;
  /** Seluruh faktur yang ditarik: semua yang belum lunas (+ lunas pada periode bila diminta). */
  baris: TagihanBaris[];
  /** Tiga ubin model — atas SEMUA faktur belum lunas. */
  ringkasan: TagihanRingkasan;
  /** Apa pun yang dipulangkan `muatBelum`; `null` bila pemanggil tak memintanya. */
  belum: Belum;
  fakturBergantungTermin: number;
  terpotong: boolean;
}

/** Pemanggil yang tak butuh "belum ditagihkan": buku piutang tidak dipindai. */
const tanpaBelum = (): Promise<null> => Promise.resolve(null);

/**
 * Bahan satu unit. `muatBelum` menentukan APAKAH dan SEBERAPA BANYAK "belum
 * ditagihkan" dibaca; ia baru dipanggil sesudah unitnya terbukti siap, paralel
 * dengan faktur dan termin.
 */
async function muatUnit<Belum>(
  unit: ScopedUnitId,
  hariIni: string,
  periodeLunas: PeriodeTagihan | null,
  muatBelum: () => Promise<Belum>,
): Promise<BahanUnit<Belum> | null> {
  const kesiapan = await getTagihanKesiapan(unit);
  if (!kesiapan.tersedia) return null;
  const [faktur, peta, belum] = await Promise.all([
    muatFaktur([unit], { periodeLunas }),
    getPetaTermin(unit),
    muatBelum(),
  ]);
  const baris = faktur.rows.map((r) => keBaris(r, peta, hariIni));
  return {
    kesiapan,
    baris,
    // Lunas dan lebih bayar tak masuk ubin mana pun (model), jadi ubin tak
    // bergantung pada saringan aktif maupun pada periode lunas.
    ringkasan: summarizeTagihan(baris.map((b) => b.status)),
    belum,
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

/** Ringkasan TANPA "belum ditagihkan": ubinnya hanya tiga ubin model — tak ada nol palsu untuk yang tak dibaca. */
export interface TagihanRingkasanUnitRingan extends Omit<TagihanRingkasanUnit, "ubin"> {
  ubin: TagihanRingkasan;
}

/**
 * Ubin + kesiapan satu unit tanpa daftar — untuk S4 dan kepala layar lain.
 *
 * `tanpaBelumDitagihkan: true` melewati pindaian buku piutang (kueri termahal
 * modul ini) dan memulangkan ubin TANPA kunci `belumDitagihkan`. Layar Atur
 * termin hanya butuh `fakturBergantungTermin` dan memakainya.
 */
export function getTagihanRingkasanUnit(
  unit: ScopedUnitId,
  hariIni: string | undefined,
  opsi: { tanpaBelumDitagihkan: true },
): Promise<TagihanBelumTersedia | TagihanRingkasanUnitRingan>;
export function getTagihanRingkasanUnit(
  unit: ScopedUnitId,
  hariIni?: string,
  opsi?: { tanpaBelumDitagihkan?: false },
): Promise<TagihanBelumTersedia | TagihanRingkasanUnit>;
export async function getTagihanRingkasanUnit(
  unit: ScopedUnitId,
  hariIni: string = todayWib(),
  opsi: { tanpaBelumDitagihkan?: boolean } = {},
): Promise<TagihanBelumTersedia | TagihanRingkasanUnit | TagihanRingkasanUnitRingan> {
  if (opsi.tanpaBelumDitagihkan === true) {
    const bahan = await muatUnit(unit, hariIni, null, tanpaBelum);
    if (bahan === null) return BELUM;
    const { kesiapan, ringkasan, fakturBergantungTermin, terpotong } = bahan;
    return { tersedia: true, kesiapan, ubin: ringkasan, fakturBergantungTermin, terpotong };
  }
  const bahan = await muatUnit(unit, hariIni, null, () => muatBelumDitagihkan([unit]));
  if (bahan === null) return BELUM;
  const { kesiapan, ringkasan, belum, fakturBergantungTermin, terpotong } = bahan;
  return {
    tersedia: true,
    kesiapan,
    ubin: { ...ringkasan, belumDitagihkan: ubinBelumDitagihkan(belum.kelompok) },
    fakturBergantungTermin,
    terpotong,
  };
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
  const bahan = await muatUnit(unit, input.hariIni ?? todayWib(), periodeLunas, () => muatBelumDitagihkan([unit]));
  if (bahan === null) return BELUM;
  const cari = (input.cari ?? "").trim();
  const kunci = kunciCari(cari);
  const baris = bahan.baris
    .filter((b) => matchesTagihanFilter(b.status, input.filter)
      // Lunas sesudah pembulatan lolos saringan SQL tanpa melihat periode;
      // periodenya ditegakkan di sini untuk SETIAP faktur lunas.
      && (periodeLunas === null || dalamPeriodeLunas(b, periodeLunas))
      && cocokCari(kunci, b.faktur.customerCode, b.namaPelanggan))
    .sort(compareTagihanRows);
  return {
    tersedia: true,
    kesiapan: bahan.kesiapan,
    ubin: { ...bahan.ringkasan, belumDitagihkan: ubinBelumDitagihkan(bahan.belum.kelompok) },
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
  /**
   * Dokumen yang diminta lewat `input.dokumen`, tertua dulu, TANPA disaring
   * pencarian; `null` = tidak diminta. Ditarik dari kueri yang sama dengan
   * kelompoknya — buku piutang dipindai sekali.
   */
  dokumen: DokumenBelumDitagihkan | null;
}

export async function getBelumDitagihkan(
  unit: ScopedUnitId,
  input: { cari?: string | null; hariIni?: string; dokumen?: PilihanDokumenBelumDitagihkan } = {},
): Promise<TagihanBelumTersedia | BelumDitagihkanDaftar> {
  const [bahan, terbit] = await Promise.all([
    muatUnit(unit, input.hariIni ?? todayWib(), null, () => muatBelumDitagihkan([unit], { dokumen: input.dokumen })),
    muatSaldoTerbit(unit),
  ]);
  if (bahan === null) return BELUM;
  const cari = (input.cari ?? "").trim();
  const kunci = kunciCari(cari);
  const sisa = sisaPerPelanggan(bahan.baris);
  const kelompok = bahan.belum.kelompok
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
    ubin: { ...bahan.ringkasan, belumDitagihkan: ubinBelumDitagihkan(bahan.belum.kelompok) },
    fakturBergantungTermin: bahan.fakturBergantungTermin,
    terpotong: bahan.terpotong,
    cari,
    kelompok,
    saldoPerTanggal: terbit?.asOfDate ?? null,
    saldoSedangDiperbarui: terbit?.sedangDiperbarui ?? false,
    dokumen: bahan.belum.dokumen,
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

/** Satu baris lebih dari batas ditarik sebagai penguji: terlampaui = `terpotong`, tidak pernah dipotong diam-diam. */
async function muatPembayaran(
  unit: ScopedUnitId,
  sql: string,
  kunci: string,
): Promise<{ rows: TagihanPembayaranBaris[]; terpotong: boolean }> {
  const rows = await qScoped<TagihanPembayaranBaris>(unit, sql, [unit, kunci, BATAS_BARIS_TAGIHAN + 1]);
  return {
    rows: rows.slice(0, BATAS_BARIS_TAGIHAN)
      .map((r) => ({ ...r, jumlah: Number(r.jumlah), batal: r.batal === true, fakturBatal: r.fakturBatal === true })),
    terpotong: rows.length > BATAS_BARIS_TAGIHAN,
  };
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
  /**
   * Pembayaran faktur ini melampaui batas baris: daftarnya TIDAK lengkap, dan
   * karena status dihitung dari daftar itu, dibayar/sisa/status ikut tak lengkap.
   */
  pembayaranTerpotong: boolean;
}

interface FakturRinciSql extends KesiapanSql {
  kode: string;
  customerCode: string;
  namaPelanggan: string | null;
  tanggalFaktur: string | null;
  jatuhTempoEasymax: string | null;
  nilai: number | null;
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
  const [kepala, dokumen, bayar, peta] = await Promise.all([
    qScoped<FakturRinciSql>(unit, SQL_FAKTUR_RINCI, [unit, kode]),
    muatDokumenFaktur(unit, kode),
    muatPembayaran(unit, SQL_PEMBAYARAN_FAKTUR, kode),
    getPetaTermin(unit),
  ]);
  const h = kepala[0];
  if (!h) return null;
  const pembayaran = bayar.rows;

  const kosong = h.tanggalFaktur === null;
  const faktur: TagihanFaktur = {
    kode: h.kode,
    customerCode: h.customerCode,
    tanggalFaktur: h.tanggalFaktur ?? "",
    jatuhTempoEasymax: h.jatuhTempoEasymax,
    nilai: h.nilai === null ? null : Number(h.nilai),
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
    pembayaranTerpotong: bayar.terpotong,
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
  /** Snapshot Saldo pelanggan pembandingnya sedang menunggu pengganti. */
  saldoSedangDiperbarui: boolean;
  /** Batas baris FAKTUR terlampaui. */
  terpotong: boolean;
  /** Batas baris PEMBAYARAN terlampaui: daftar dan total pembayarannya tidak lengkap. */
  pembayaranTerpotong: boolean;
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
    muatBelumDitagihkan([unit], { kodePelanggan: kode }),
    muatSaldoTerbit(unit),
  ]);
  const baris = faktur.rows.map((r) => keBaris(r, peta, hariIni)).sort(compareTagihanRows);
  const kelompok = belum.kelompok[0];
  const belumDitagihkan = {
    jumlahDokumen: Number(kelompok?.jumlahDokumen ?? 0),
    total: bulat(Number(kelompok?.total ?? 0)),
    tanggalTertua: kelompok?.tanggalTertua ?? null,
  };
  const sisaFaktur = baris.reduce((t, b) => t + b.status.sisa, 0);
  return {
    tersedia: true,
    kesiapan,
    customerCode: kode,
    faktur: baris,
    pembayaran: pembayaran.rows,
    belumDitagihkan,
    cocokSaldo: cocokSaldo(kode, sisaFaktur, belumDitagihkan.total, terbit),
    saldoSedangDiperbarui: terbit?.sedangDiperbarui ?? false,
    terpotong: faktur.terpotong,
    pembayaranTerpotong: pembayaran.terpotong,
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
    // Kunci tak peka huruf besar/kecil — sama dengan `getPetaTermin`.
    else peta.terminPelanggan.set(kunciTermin(r.kodePelanggan), Number(r.terminHari));
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
  for (const r of belum.kelompok) belumPerUnit.get(Number(r.unitId))?.push(r);

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
