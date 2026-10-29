import { kueriScoped, PREDIKAT_KAS_DICOCOKKAN, PREDIKAT_MUTASI_DICOCOKKAN, type Kueri } from "./cocok-bank-queries";
import { qScoped } from "./db";
import { PREDIKAT_REKENING_BCA } from "./impor-bank-queries";
import { KATEGORI_PENAMPUNG } from "./keuangan-sisi-kas";
import { teksKeSen } from "./pihak-lawan-model";
import type { ScopedUnitId } from "./scope";
import {
  parkirTerbuka,
  type BarisBukuBulan,
  type BarisImporBulan,
  type BarisParkirBulan,
  type MasukanTutupBulan,
  type RekeningWajib,
} from "./tutup-bulan-model";

/**
 * Bacaan TUTUP BULAN (rencana 2026-10-29 U12; R24, R25; KTD14) — SQL yang
 * dipakai BERSAMA `tutupBulan` (di dalam transaksinya, sesudah kunci) dan
 * halaman (lewat `qScoped`). Satu rumus, bukan dua salinan. Sengaja BUKAN
 * berkas "use server".
 *
 * ⛔ URUTAN DI JALUR TULIS: kunci bulan DULU, baru baca. `tutupBulan` memegang
 *    kunci advisory EKSKLUSIF per (unit, bulan); jalur yang bisa membuat syarat
 *    bulan tertutup kembali gagal (tarik rekening koran, batalkan cocok)
 *    memegang kunci BERSAMA yang sama sebelum memeriksa `tutup_bulan`. Siapa
 *    pun yang kedua menunggu, lalu membaca ULANG (READ COMMITTED: pernyataan
 *    baru, snapshot baru) — penutup melihat rekening koran yang sudah ditarik,
 *    penarik melihat bulan yang sudah ditutup.
 */

const KUNCI_BULAN_SQL = "hashtextextended('tutup-bulan:' || $1::text || ':' || $2::text, 0)";

/** Penutup: kunci EKSKLUSIF (unit, bulan `YYYY-MM`). Dipakai `tutupBulan`. */
export async function kunciBulanEksklusif(c: Kueri, unitId: ScopedUnitId, bulan: string): Promise<void> {
  await c.query(`SELECT pg_advisory_xact_lock(${KUNCI_BULAN_SQL})`, [unitId, bulan]);
}

/**
 * Hook jalur tulis (U12 di `tarikRekeningKoran` & `batalkanCocok`): ambil kunci
 * BERSAMA tiap bulan (urut — tak ada siklus antar penulis), LALU baca bulan
 * mana yang sudah ditutup. Dipanggil di dalam transaksi pemanggil sesudah
 * `set_config('app.unit_ids', …)`. Mengembalikan bulan tertutup (`YYYY-MM`).
 */
export async function bulanTertutupTerkunci(c: Kueri, unitId: ScopedUnitId, bulan: readonly string[]): Promise<string[]> {
  const urut = [...new Set(bulan)].sort();
  if (urut.length === 0) return [];
  for (const b of urut) await c.query(`SELECT pg_advisory_xact_lock_shared(${KUNCI_BULAN_SQL})`, [unitId, b]);
  const r = await c.query<{ bulan: string }>(
    `SELECT to_char(bulan, 'YYYY-MM') AS bulan
       FROM app.tutup_bulan
      WHERE unit_id = $1 AND bulan = ANY($2::date[])
      ORDER BY bulan`,
    [unitId, urut.map((b) => `${b}-01`)],
  );
  return r.rows.map((x) => x.bulan);
}

/** Hari tertutup bulan itu. $1 unit, $2 'YYYY-MM-01'. */
export const SQL_HARI_TERTUTUP = `SELECT to_char(business_date, 'YYYY-MM-DD') AS d
       FROM app.day_close
      WHERE unit_id = $1 AND status = 'closed'
        AND business_date >= $2::date AND business_date < ($2::date + interval '1 month')`;

/**
 * Baris penampung SUMBER (bukan pemindahan) dengan hari buku ∈ [$3, $4], beserta
 * tanggal bank mutasi yang diparkirnya: anggota mutasi kelompok cocok AKTIF
 * baris itu, jatuh ke tanggal asal ?? hari buku bila kelompoknya sudah tak
 * aktif. Pembalik & yang sudah dipindahkan ikut dibaca — `parkirTerbuka`
 * (model) yang memutuskan. $1 unit, $2 kategori penampung, $3 dari, $4 sampai.
 */
export const SQL_PARKIR = `SELECT l.id::text AS id, l.account_id::text AS "accountId",
            to_char(COALESCE(
              (SELECT min(m.tanggal_bank)
                 FROM app.cocok_bank_baris b
                 JOIN app.cocok_bank_baris bm ON bm.cocok_id = b.cocok_id AND bm.unit_id = b.unit_id
                                             AND bm.aktif AND bm.mutasi_bank_id IS NOT NULL
                 JOIN app.mutasi_bank m ON m.id = bm.mutasi_bank_id AND m.unit_id = bm.unit_id
                WHERE b.cash_ledger_id = l.id AND b.unit_id = l.unit_id AND b.aktif),
              l.tanggal_asal, l.business_date), 'YYYY-MM-DD') AS "tanggalBank",
            to_char(l.business_date, 'YYYY-MM-DD') AS "businessDate",
            l.amount::text AS amount, l.keterangan,
            EXISTS (SELECT 1 FROM app.cash_ledger x
                     WHERE x.unit_id = l.unit_id AND x.parkir_sumber_id = l.id AND NOT x.void) AS "sudahDipindah",
            l.alasan_maju AS "alasanMaju", l.lahir_dari_cocok_id::text AS "lahirDariCocokId",
            a.nama AS rekening
       FROM app.cash_ledger l
       JOIN app.cash_account a ON a.id = l.account_id AND a.unit_id = l.unit_id
      WHERE l.unit_id = $1 AND NOT l.void AND l.category_label = $2 AND l.parkir_sumber_id IS NULL
        AND l.business_date >= $3::date AND l.business_date <= $4::date
      ORDER BY l.business_date, l.created_at`;

/** Rekening BCA wajib + rekening koran aktif bulan itu. $1 unit, $2 'YYYY-MM-01'. */
export const SQL_REKENING_WAJIB = `SELECT id::text AS id, nama,
            to_char(COALESCE(
              (SELECT min(l.business_date) FROM app.cash_ledger l
                WHERE l.unit_id = cash_account.unit_id AND l.account_id = cash_account.id
                  AND l.saldo_awal AND NOT l.void),
              (SELECT min(l.business_date) FROM app.cash_ledger l
                WHERE l.unit_id = cash_account.unit_id AND l.saldo_awal AND NOT l.void)
            ), 'YYYY-MM-DD') AS "cutOver",
            EXISTS (SELECT 1 FROM app.rekening_koran r
                     WHERE r.unit_id = cash_account.unit_id AND r.account_id = cash_account.id
                       AND r.status = 'aktif' AND r.periode = $2::date) AS "rekeningKoranAktif"
       FROM app.cash_account
      WHERE unit_id = $1 AND ${PREDIKAT_REKENING_BCA}
      ORDER BY nama`;

/** Baris impor rekening koran AKTIF bertanggal bank bulan itu. $1 unit, $2 'YYYY-MM-01'. */
export const SQL_IMPOR_BULAN = `SELECT m.id::text AS id, m.account_id::text AS "accountId",
            to_char(m.tanggal_bank, 'YYYY-MM-DD') AS "tanggalBank", m.pra_cutover AS "praCutover",
            ${PREDIKAT_MUTASI_DICOCOKKAN} AS dicocokkan
       FROM app.mutasi_bank m
      WHERE m.unit_id = $1 AND m.rk_status = 'aktif'
        AND m.tanggal_bank >= $2::date AND m.tanggal_bank < ($2::date + interval '1 month')`;

/**
 * Baris kas non-void di rekening BCA wajib dengan tanggal asal ?? hari buku di
 * bulan itu, PLUS baris yang bertaut dengannya (kelompok cocok pelahir yang
 * sama, atau `pasangan_uuid` sama) di bulan mana pun — supaya pembalik maju
 * yang jatuh di bulan berikutnya tetap terlihat oleh model untuk dipasangkan.
 * $1 unit, $2 'YYYY-MM-01'.
 */
export const SQL_BUKU_BULAN = `WITH rek AS (
       SELECT id FROM app.cash_account WHERE unit_id = $1 AND ${PREDIKAT_REKENING_BCA}
     ), inti AS (
       SELECT l.id, l.lahir_dari_cocok_id, l.pasangan_uuid
         FROM app.cash_ledger l
        WHERE l.unit_id = $1 AND l.account_id IN (SELECT id FROM rek) AND NOT l.void AND NOT l.saldo_awal
          AND COALESCE(l.tanggal_asal, l.business_date) >= $2::date
          AND COALESCE(l.tanggal_asal, l.business_date) < ($2::date + interval '1 month')
     )
     SELECT l.id::text AS id, l.account_id::text AS "accountId",
            to_char(l.business_date, 'YYYY-MM-DD') AS "businessDate",
            to_char(l.tanggal_asal, 'YYYY-MM-DD') AS "tanggalAsal",
            l.amount::text AS amount, l.void, l.saldo_awal AS "saldoAwal",
            ${PREDIKAT_KAS_DICOCOKKAN} AS dicocokkan,
            l.alasan_maju AS "alasanMaju", l.lahir_dari_cocok_id::text AS "lahirDariCocokId",
            l.pasangan_uuid::text AS "pasanganUuid", l.keterangan, l.category_label AS "categoryLabel"
       FROM app.cash_ledger l
      WHERE l.unit_id = $1 AND NOT l.void AND l.account_id IN (SELECT id FROM rek)
        AND (l.id IN (SELECT id FROM inti)
             OR l.lahir_dari_cocok_id IN (SELECT lahir_dari_cocok_id FROM inti)
             OR l.pasangan_uuid IN (SELECT pasangan_uuid FROM inti))
      ORDER BY COALESCE(l.tanggal_asal, l.business_date), l.created_at`;

type BarisParkirSql = Omit<BarisParkirBulan, "amountSen"> & { amount: string; rekening: string };

export interface BarisParkirTampil extends BarisParkirBulan {
  rekening: string;
}

const keParkir = ({ amount, ...r }: BarisParkirSql): BarisParkirTampil => ({ ...r, amountSen: teksKeSen(amount) });

type BahanTutupBulan = MasukanTutupBulan & { parkir: BarisParkirTampil[] };

/** Kelima bacaan masukan tutup bulan — SATU salinan SQL+parameter untuk kedua jalur di bawah. */
function bacaanBahan(k: Kueri, unitId: ScopedUnitId, awal: string) {
  return {
    hari: () => k.query<{ d: string }>(SQL_HARI_TERTUTUP, [unitId, awal]),
    // Hari buku ≥ awal bulan: tanggal bank tak pernah sesudah hari bukunya
    // (pembukuan hanya maju), jadi baris parkir bertanggal bank bulan ini tak
    // mungkin berhari buku sebelum bulan ini.
    parkir: () => k.query<BarisParkirSql>(SQL_PARKIR, [unitId, KATEGORI_PENAMPUNG, awal, "9999-12-31"]),
    rekening: () => k.query<RekeningWajib>(SQL_REKENING_WAJIB, [unitId, awal]),
    impor: () => k.query<BarisImporBulan>(SQL_IMPOR_BULAN, [unitId, awal]),
    buku: () => k.query<Omit<BarisBukuBulan, "amountSen"> & { amount: string }>(SQL_BUKU_BULAN, [unitId, awal]),
  };
}

type Hasil<K extends keyof ReturnType<typeof bacaanBahan>> = Awaited<ReturnType<ReturnType<typeof bacaanBahan>[K]>>;

function susunBahan(
  bulan: string,
  hari: Hasil<"hari">,
  parkir: Hasil<"parkir">,
  rekening: Hasil<"rekening">,
  impor: Hasil<"impor">,
  buku: Hasil<"buku">,
): BahanTutupBulan {
  return {
    bulan,
    hariTertutup: hari.rows.map((r) => r.d),
    parkir: parkir.rows.map(keParkir),
    rekening: rekening.rows,
    impor: impor.rows,
    buku: buku.rows.map(({ amount, ...r }) => ({ ...r, amountSen: teksKeSen(amount) })),
  };
}

/**
 * Semua masukan `periksaTutupBulan` untuk (unit, bulan) — dibaca lewat `k`:
 * klien transaksi (aksi, sesudah kunci) atau `kueriScoped` (halaman).
 */
export async function bacaBahanTutupBulan(k: Kueri, unitId: ScopedUnitId, bulan: string): Promise<BahanTutupBulan> {
  const q = bacaanBahan(k, unitId, `${bulan}-01`);
  // Berurutan, bukan Promise.all: `k` bisa SATU klien transaksi.
  const hari = await q.hari();
  const parkir = await q.parkir();
  const rekening = await q.rekening();
  const impor = await q.impor();
  const buku = await q.buku();
  return susunBahan(bulan, hari, parkir, rekening, impor, buku);
}

/**
 * Jalur HALAMAN saja: `kueriScoped` membuka satu koneksi per kueri, jadi kelima
 * bacaan aman berjalan paralel. ⛔ Aksi `tutupBulan` tetap memakai
 * {@link bacaBahanTutupBulan} dengan klien transaksinya (berurutan).
 */
export async function getBahanTutupBulan(unit: ScopedUnitId, bulan: string): Promise<BahanTutupBulan> {
  const q = bacaanBahan(kueriScoped(unit), unit, `${bulan}-01`);
  const [hari, parkir, rekening, impor, buku] = await Promise.all([q.hari(), q.parkir(), q.rekening(), q.impor(), q.buku()]);
  return susunBahan(bulan, hari, parkir, rekening, impor, buku);
}

export interface TutupBulanRow {
  ditutupAt: string;
  ditutupOleh: string | null;
}

export async function getTutupBulan(unit: ScopedUnitId, bulan: string): Promise<TutupBulanRow | null> {
  const r = await qScoped<TutupBulanRow>(
    unit,
    `SELECT to_char(t.ditutup_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') AS "ditutupAt",
            u.email AS "ditutupOleh"
       FROM app.tutup_bulan t
       LEFT JOIN app.users u ON u.id = t.ditutup_by_user_id
      WHERE t.unit_id = $1 AND t.bulan = $2::date`,
    [unit, `${bulan}-01`],
  );
  return r[0] ?? null;
}

// ---------------------------------------------------------------------------
// Layar tutup hari (R24, R32)
// ---------------------------------------------------------------------------

/**
 * R24 — baris yang MASIH diparkir (keadaan kini, `parkirTerbuka`) dan
 * dibukukan s.d. `date`. Dibaca tanpa batas atas lebih dulu: pembalik yang
 * dibukukan sesudah `date` tetap harus terlihat untuk dipasangkan.
 */
export async function getParkirTerbukaSampai(unit: ScopedUnitId, date: string): Promise<BarisParkirTampil[]> {
  const rows = await qScoped<BarisParkirSql>(unit, SQL_PARKIR, [unit, KATEGORI_PENAMPUNG, "0001-01-01", "9999-12-31"]);
  return parkirTerbuka(rows.map(keParkir)).filter((p) => p.businessDate <= date);
}

export interface BarisMaju {
  id: string;
  rekening: string;
  tanggalAsal: string;
  amountSen: number;
  keterangan: string;
  categoryLabel: string | null;
  alasanMaju: string | null;
  alasanLabel: string | null;
  /** `YYYY-MM` tanggal bank mutasi sumbernya (tautan ke layar klasifikasi), bila ada. */
  bulanBank: string | null;
  pasanganUuid: string | null;
}

/**
 * Baris yang DIBUKUKAN MAJU ke `date` — hari bukunya `date`, tanggal asalnya
 * lebih awal (`barisSusulan`, KTD15). Sumbernya: kelompok cocok yang memuatnya
 * (aktif) atau yang melahirkannya. $1 unit, $2 tanggal.
 */
export async function getBarisMajuKe(unit: ScopedUnitId, date: string): Promise<BarisMaju[]> {
  const rows = await qScoped<Omit<BarisMaju, "amountSen"> & { amount: string }>(
    unit,
    `SELECT l.id::text AS id, a.nama AS rekening,
            to_char(l.tanggal_asal, 'YYYY-MM-DD') AS "tanggalAsal",
            l.amount::text AS amount, l.keterangan, l.category_label AS "categoryLabel",
            l.alasan_maju AS "alasanMaju", rc.label AS "alasanLabel",
            (SELECT to_char(min(m.tanggal_bank), 'YYYY-MM')
               FROM app.cocok_bank_baris bm
               JOIN app.mutasi_bank m ON m.id = bm.mutasi_bank_id AND m.unit_id = bm.unit_id
              WHERE bm.unit_id = l.unit_id AND bm.cocok_id = COALESCE(
                      (SELECT b.cocok_id FROM app.cocok_bank_baris b
                        WHERE b.cash_ledger_id = l.id AND b.unit_id = l.unit_id AND b.aktif LIMIT 1),
                      l.lahir_dari_cocok_id)) AS "bulanBank",
            l.pasangan_uuid::text AS "pasanganUuid"
       FROM app.cash_ledger l
       JOIN app.cash_account a ON a.id = l.account_id AND a.unit_id = l.unit_id
       LEFT JOIN app.reason_code rc ON rc.code = l.alasan_maju AND rc.applies_to = 'adjustment'
      WHERE l.unit_id = $1 AND l.business_date = $2::date AND NOT l.void
        AND l.tanggal_asal IS NOT NULL AND l.tanggal_asal < l.business_date
      ORDER BY l.tanggal_asal, l.created_at`,
    [unit, date],
  );
  return rows.map(({ amount, ...r }) => ({ ...r, amountSen: teksKeSen(amount) }));
}
