import { POS_PERJALANAN, type BarisKliring, type MasukanCekBukuBesar, type RekeningBankBukuBesar, type TemuanHargaBeli } from "./buku-besar-cek";
import { kueriScoped, PREDIKAT_KAS_DICOCOKKAN, PREDIKAT_MUTASI_DICOCOKKAN, type Kueri } from "./cocok-bank-queries";
import { qScoped } from "./db";
import { KATEGORI_PENAMPUNG } from "./keuangan-sisi-kas";
import { teksKeSen } from "./pihak-lawan-model";
import type { ScopedUnitId } from "./scope";
import type { KasKandidat } from "./tutup-bulan-penjelasan";
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

/**
 * Ekspresi kunci advisory (unit $1, bulan `YYYY-MM` $2). SATU salinan: dipakai
 * penutup (eksklusif), jalur tulis (bersama), dan pembentukan ulang buku besar
 * (`buku-besar-tulis.ts`, bersama). Di sesi yang SAMA, kunci bersama sesudah
 * kunci eksklusif langsung didapat (lock manager Postgres tak pernah membuat
 * sesi menunggu kuncinya sendiri) — `tutupBulan` memanggil `bentukUlangHari`
 * sambil memegang kunci eksklusif bulan itu.
 */
export const KUNCI_BULAN_SQL = "hashtextextended('tutup-bulan:' || $1::text || ':' || $2::text, 0)";

/**
 * Kunci saldo awal pos per unit. `simpanSaldoAwalPos` memegangnya EKSKLUSIF;
 * `tutupBulan` BERSAMA, sesudah kunci bulannya — saldo awal tak bisa diganti di
 * tengah tutup bulan (tinjauan PR #448). Urutan selalu bulan → saldo awal; jalur
 * saldo awal tak pernah mengambil kunci bulan, jadi tak ada siklus.
 */
export const KUNCI_SALDO_AWAL_POS_SQL = "hashtextextended('saldo-awal-pos:' || $1::text, 0)";

/** Penutup: kunci EKSKLUSIF (unit, bulan `YYYY-MM`). Dipakai `tutupBulan`. */
export async function kunciBulanEksklusif(c: Kueri, unitId: ScopedUnitId, bulan: string): Promise<void> {
  await c.query(`SELECT pg_advisory_xact_lock(${KUNCI_BULAN_SQL})`, [unitId, bulan]);
  await c.query(`SELECT pg_advisory_xact_lock_shared(${KUNCI_SALDO_AWAL_POS_SQL})`, [unitId]);
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

/**
 * Rekening yang ikut tutup bulan (K6 U11, R28): SEMUA rekening bank aktif —
 * BCA, BRI, BNI, Mandiri; bernomor atau belum. Fragmen atas `app.cash_account`
 * tanpa alias. Rekening bersaldo nol tanpa mutasi bulan itu dikecualikan oleh
 * model (`periksaTutupBulan`), bukan di sini.
 */
export const PREDIKAT_REKENING_BANK = `kind = 'bank' AND active`;

/**
 * Rekening bank aktif + rekening koran bulan itu (aktif / `menunggu` HoF) +
 * ada-tidaknya mutasi + saldo akhir — keduanya menurut TANGGAL EFEKTIF
 * (tanggal asal ?? hari buku), sama dengan syarat 4. $1 unit, $2 'YYYY-MM-01'.
 */
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
                       AND r.status = 'aktif' AND r.periode = $2::date) AS "rekeningKoranAktif",
            EXISTS (SELECT 1 FROM app.rekening_koran r
                     WHERE r.unit_id = cash_account.unit_id AND r.account_id = cash_account.id
                       AND r.status = 'menunggu' AND r.periode = $2::date) AS "rekeningKoranMenunggu",
            (EXISTS (SELECT 1 FROM app.cash_ledger l
                      WHERE l.unit_id = cash_account.unit_id AND l.account_id = cash_account.id
                        AND NOT l.void AND NOT l.saldo_awal
                        AND COALESCE(l.tanggal_asal, l.business_date) >= $2::date
                        AND COALESCE(l.tanggal_asal, l.business_date) < ($2::date + interval '1 month'))
             OR EXISTS (SELECT 1 FROM app.mutasi_bank m
                         WHERE m.unit_id = cash_account.unit_id AND m.account_id = cash_account.id
                           AND m.rk_status IN ('aktif', 'menunggu')
                           AND m.tanggal_bank >= $2::date AND m.tanggal_bank < ($2::date + interval '1 month'))
            ) AS "adaMutasi",
            COALESCE((SELECT sum(l.amount) FROM app.cash_ledger l
                       WHERE l.unit_id = cash_account.unit_id AND l.account_id = cash_account.id AND NOT l.void
                         AND COALESCE(l.tanggal_asal, l.business_date) < ($2::date + interval '1 month')), 0)::text AS "saldoAkhir"
       FROM app.cash_account
      WHERE unit_id = $1 AND ${PREDIKAT_REKENING_BANK}
      ORDER BY nama`;

/**
 * Baris impor rekening koran AKTIF bertanggal bank bulan itu (nominal &
 * keterangan hanya untuk penjelasan butir terbuka, R32). $1 unit, $2 'YYYY-MM-01'.
 */
export const SQL_IMPOR_BULAN = `SELECT m.id::text AS id, m.account_id::text AS "accountId",
            to_char(m.tanggal_bank, 'YYYY-MM-DD') AS "tanggalBank", m.pra_cutover AS "praCutover",
            m.amount::text AS amount, m.keterangan,
            ${PREDIKAT_MUTASI_DICOCOKKAN} AS dicocokkan
       FROM app.mutasi_bank m
      WHERE m.unit_id = $1 AND m.rk_status = 'aktif'
        AND m.tanggal_bank >= $2::date AND m.tanggal_bank < ($2::date + interval '1 month')`;

/**
 * Baris kas non-void di rekening bank aktif dengan tanggal asal ?? hari buku di
 * bulan itu, PLUS baris yang bertaut dengannya (kelompok cocok pelahir yang
 * sama, atau `pasangan_uuid` sama) di bulan mana pun — supaya pembalik maju
 * yang jatuh di bulan berikutnya tetap terlihat oleh model untuk dipasangkan.
 * $1 unit, $2 'YYYY-MM-01'.
 */
export const SQL_BUKU_BULAN = `WITH rek AS (
       SELECT id FROM app.cash_account WHERE unit_id = $1 AND ${PREDIKAT_REKENING_BANK}
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

// ---------------------------------------------------------------------------
// Pemeriksaan buku besar (K6 U11, R33) — saldo menurut TANGGAL EFEKTIF
// ---------------------------------------------------------------------------

/**
 * Ringkas saldo awal pos + apakah unit sudah punya bulan yang ditutup dengan
 * buku besar (aturan aktif `bukuBesarAktif`). $1 unit.
 */
export const SQL_BB_STATUS = `SELECT
            (SELECT count(*) FROM app.saldo_awal_pos s WHERE s.unit_id = $1 AND NOT s.void)::int AS "jumlahBaris",
            (SELECT COALESCE(sum(s.saldo_sen), 0) FROM app.saldo_awal_pos s WHERE s.unit_id = $1 AND NOT s.void)::text AS "totalSaldoAwal",
            EXISTS (SELECT 1 FROM app.tutup_bulan t WHERE t.unit_id = $1 AND t.buku_besar) AS "adaTutupBukuBesar"`;

/**
 * Saldo per pos s.d. akhir bulan: saldo awal pos + jurnal AKTIF (bukan jenis
 * `saldo_awal` — keduanya tak boleh dijumlah, sama dengan `SQL_SALDO_SEBELUM`)
 * bertanggal EFEKTIF sebelum awal bulan berikutnya. $1 unit, $2 'YYYY-MM-01'.
 */
export const SQL_BB_SALDO_POS = `WITH gerak AS (
       SELECT s.pos_kode, s.saldo_sen AS sen
         FROM app.saldo_awal_pos s
        WHERE s.unit_id = $1 AND NOT s.void
       UNION ALL
       SELECT b.pos_kode, b.debet_sen - b.kredit_sen
         FROM app.jurnal_baris b
         JOIN app.jurnal j ON j.id = b.jurnal_id AND j.unit_id = b.unit_id
        WHERE b.unit_id = $1 AND j.status = 'aktif' AND j.jenis <> 'saldo_awal'
          AND j.tanggal_efektif < ($2::date + interval '1 month')
     )
     SELECT pos_kode AS "posKode", sum(sen)::text AS saldo
       FROM gerak GROUP BY pos_kode ORDER BY pos_kode`;

/**
 * Setiap sub-pos bank unit (pos_unit bertaut rekening) + saldo akhir rekening
 * koran AKTIF bulan itu (`menunggu` HoF belum dihitung). $1 unit, $2 'YYYY-MM-01'.
 */
export const SQL_BB_BANK = `SELECT u.kode AS "posKode", a.id::text AS "accountId", a.nama,
            (SELECT r.saldo_akhir::text FROM app.rekening_koran r
              WHERE r.unit_id = a.unit_id AND r.account_id = a.id
                AND r.status = 'aktif' AND r.periode = $2::date) AS "saldoRekeningKoran"
       FROM app.pos_unit u
       JOIN app.cash_account a ON a.id = u.cash_account_id AND a.unit_id = u.unit_id
      WHERE u.unit_id = $1 AND u.cash_account_id IS NOT NULL
      ORDER BY u.kode`;

/**
 * Net per jurnal AKTIF pada pos kliring $3 (1103, 1190), bertanggal efektif
 * dari awal bulan s.d. hari ke-3 bulan berikutnya — calon butir dalam
 * perjalanan dan kaki pasangannya. $1 unit, $2 'YYYY-MM-01', $3 text[].
 */
export const SQL_BB_KLIRING = `SELECT j.id::text AS "jurnalId", b.pos_kode AS "posKode",
            to_char(j.tanggal_efektif, 'YYYY-MM-DD') AS "tanggalEfektif", j.keterangan,
            sum(b.debet_sen - b.kredit_sen)::text AS net
       FROM app.jurnal_baris b
       JOIN app.jurnal j ON j.id = b.jurnal_id AND j.unit_id = b.unit_id
      WHERE b.unit_id = $1 AND j.status = 'aktif' AND j.jenis <> 'saldo_awal'
        AND b.pos_kode = ANY($3::text[])
        AND j.tanggal_efektif >= $2::date
        AND j.tanggal_efektif < ($2::date + interval '1 month' + interval '3 days')
      GROUP BY j.id, b.pos_kode
     HAVING sum(b.debet_sen - b.kredit_sen) <> 0
      ORDER BY j.tanggal_efektif, j.id`;

/** BIGINT sen (teks) → number, gagal keras di luar jangkauan aman. */
function senBulat(t: string): number {
  if (!/^-?\d+$/.test(t.trim())) throw new Error(`Sen DB tak terbaca: "${t}".`);
  const n = Number(t);
  if (!Number.isSafeInteger(n)) throw new Error(`Sen DB di luar jangkauan: "${t}".`);
  return n;
}

/**
 * Bahan `periksaBukuBesar` untuk (unit, bulan), dibaca lewat `k` — klien
 * transaksi (`tutupBulan`, SESUDAH pembentukan ulang, di bawah kunci) atau
 * `kueriScoped` (halaman, jurnal tersimpan apa adanya). Berurutan: `k` bisa
 * satu klien transaksi. `temuanHargaBeli` = temuan pembentukan ulang; `null`
 * di halaman (belum diperiksa).
 */
export async function bacaBahanBukuBesar(
  k: Kueri,
  unitId: ScopedUnitId,
  bulan: string,
  temuanHargaBeli: readonly TemuanHargaBeli[] | null,
): Promise<MasukanCekBukuBesar> {
  const awal = `${bulan}-01`;
  const st = (
    await k.query<{ jumlahBaris: number; totalSaldoAwal: string; adaTutupBukuBesar: boolean }>(SQL_BB_STATUS, [unitId])
  ).rows[0];
  const saldo = await k.query<{ posKode: string; saldo: string }>(SQL_BB_SALDO_POS, [unitId, awal]);
  const bank = await k.query<Omit<RekeningBankBukuBesar, "saldoRekeningKoranSen"> & { saldoRekeningKoran: string | null }>(SQL_BB_BANK, [
    unitId,
    awal,
  ]);
  const kliring = await k.query<Omit<BarisKliring, "netSen"> & { net: string }>(SQL_BB_KLIRING, [unitId, awal, [...POS_PERJALANAN]]);
  return {
    bulan,
    // Tanpa baris status (pembaca tiruan) ⇒ saldo awal kosong ⇒ pemeriksaan tak aktif.
    saldoAwal: { jumlahBaris: Number(st?.jumlahBaris ?? 0), totalSen: senBulat(st?.totalSaldoAwal ?? "0") },
    adaTutupBukuBesar: st?.adaTutupBukuBesar === true,
    saldoPos: saldo.rows.map((r) => ({ posKode: r.posKode, saldoSen: senBulat(r.saldo) })),
    bank: bank.rows.map(({ saldoRekeningKoran, ...r }) => ({
      ...r,
      saldoRekeningKoranSen: saldoRekeningKoran === null ? null : teksKeSen(saldoRekeningKoran),
    })),
    kliring: kliring.rows.map(({ net, ...r }) => ({ ...r, netSen: senBulat(net) })),
    temuanHargaBeli,
  };
}

type BarisParkirSql = Omit<BarisParkirBulan, "amountSen"> & { amount: string; rekening: string };

export interface BarisParkirTampil extends BarisParkirBulan {
  rekening: string;
}

const keParkir = ({ amount, ...r }: BarisParkirSql): BarisParkirTampil => ({ ...r, amountSen: teksKeSen(amount) });

type BahanTutupBulan = MasukanTutupBulan & { parkir: BarisParkirTampil[]; bukuBesar: MasukanCekBukuBesar };

type RekeningSql = Omit<RekeningWajib, "saldoAkhirSen"> & { saldoAkhir?: string };
type BarisImporSql = Omit<BarisImporBulan, "amountSen"> & { amount?: string };

// Kolom tambahan K6 U11 dibaca bila ada (pembaca tiruan lama tak mengirimnya —
// model menganggap keterangan yang hilang sebagai "wajib", gagal tertutup).
const keRekening = ({ saldoAkhir, ...r }: RekeningSql): RekeningWajib =>
  saldoAkhir === undefined ? r : { ...r, saldoAkhirSen: teksKeSen(saldoAkhir) };
const keImpor = ({ amount, ...m }: BarisImporSql): BarisImporBulan =>
  amount === undefined ? m : { ...m, amountSen: teksKeSen(amount) };

/** Kelima bacaan masukan tutup bulan — SATU salinan SQL+parameter untuk kedua jalur di bawah. */
function bacaanBahan(k: Kueri, unitId: ScopedUnitId, awal: string) {
  return {
    hari: () => k.query<{ d: string }>(SQL_HARI_TERTUTUP, [unitId, awal]),
    // Hari buku ≥ awal bulan: tanggal bank tak pernah sesudah hari bukunya
    // (pembukuan hanya maju), jadi baris parkir bertanggal bank bulan ini tak
    // mungkin berhari buku sebelum bulan ini.
    parkir: () => k.query<BarisParkirSql>(SQL_PARKIR, [unitId, KATEGORI_PENAMPUNG, awal, "9999-12-31"]),
    rekening: () => k.query<RekeningSql>(SQL_REKENING_WAJIB, [unitId, awal]),
    impor: () => k.query<BarisImporSql>(SQL_IMPOR_BULAN, [unitId, awal]),
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
): Omit<BahanTutupBulan, "bukuBesar"> {
  return {
    bulan,
    hariTertutup: hari.rows.map((r) => r.d),
    parkir: parkir.rows.map(keParkir),
    rekening: rekening.rows.map(keRekening),
    impor: impor.rows.map(keImpor),
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
  // Jurnal TERSIMPAN; `tutupBulan` membaca ulang bagian ini sesudah membentuk ulang.
  const bukuBesar = await bacaBahanBukuBesar(k, unitId, bulan, null);
  return { ...susunBahan(bulan, hari, parkir, rekening, impor, buku), bukuBesar };
}

/**
 * Jalur HALAMAN saja: `kueriScoped` membuka satu koneksi per kueri, jadi kelima
 * bacaan aman berjalan paralel. ⛔ Aksi `tutupBulan` tetap memakai
 * {@link bacaBahanTutupBulan} dengan klien transaksinya (berurutan).
 */
export async function getBahanTutupBulan(unit: ScopedUnitId, bulan: string): Promise<BahanTutupBulan> {
  const q = bacaanBahan(kueriScoped(unit), unit, `${bulan}-01`);
  const [hari, parkir, rekening, impor, buku, bukuBesar] = await Promise.all([
    q.hari(),
    q.parkir(),
    q.rekening(),
    q.impor(),
    q.buku(),
    // Halaman tidak membentuk ulang: jurnal tersimpan, harga beli belum diperiksa.
    bacaBahanBukuBesar(kueriScoped(unit), unit, bulan, null),
  ]);
  return { ...susunBahan(bulan, hari, parkir, rekening, impor, buku), bukuBesar };
}

/**
 * R32 — baris kas unit (semua akun) yang BELUM dicocokkan, tanggal efektif
 * ∈ [awal bulan − 3 hari, akhir bulan + 3 hari]: calon kandidat untuk
 * penjelasan AI butir terbuka. Hanya dibaca saat penjelasan diminta; TIDAK
 * dipakai vonis. Keterangan ketikan sengaja tak dibaca (tak dikirim ke AI).
 * $1 unit, $2 'YYYY-MM-01'.
 */
export const SQL_KAS_KANDIDAT_PENJELASAN = `SELECT l.id::text AS id, l.account_id::text AS "accountId",
            l.category_label AS "categoryLabel",
            to_char(COALESCE(l.tanggal_asal, l.business_date), 'YYYY-MM-DD') AS "tanggalEfektif",
            l.amount::text AS amount
       FROM app.cash_ledger l
      WHERE l.unit_id = $1 AND NOT l.void AND NOT l.saldo_awal
        AND COALESCE(l.tanggal_asal, l.business_date) >= ($2::date - 3)
        AND COALESCE(l.tanggal_asal, l.business_date) < ($2::date + interval '1 month' + interval '3 days')
        AND NOT ${PREDIKAT_KAS_DICOCOKKAN}
      ORDER BY COALESCE(l.tanggal_asal, l.business_date), l.created_at
      LIMIT 5000`;

export async function getKasKandidatPenjelasan(unit: ScopedUnitId, bulan: string): Promise<KasKandidat[]> {
  const rows = await qScoped<Omit<KasKandidat, "amountSen"> & { amount: string }>(unit, SQL_KAS_KANDIDAT_PENJELASAN, [unit, `${bulan}-01`]);
  return rows.map(({ amount, ...r }) => ({ ...r, amountSen: teksKeSen(amount) }));
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
