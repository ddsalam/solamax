import { qScoped } from "./db";
import { addDays } from "./periods";
import type { ScopedUnitId } from "./scope";
import {
  getHargaBeliRows,
  getHargaJualHistory,
  getProdukUnit,
} from "./keuangan-input-queries";
import { barisHargaBeli, type BarisHargaBeli } from "./keuangan-harga-model";
import { sqlTitipanBright } from "./titipan-bright";

/**
 * Bahan mentah Layar "Pemantauan pemakaian keuangan" — SELURUHNYA BACA.
 *
 * Pertanyaan layar ini BUKAN "berapa labanya", melainkan **apakah tim keuangan
 * benar-benar memakai modulnya, dan di mana pemakaiannya menyimpang**. Karena
 * itu yang dibaca di sini adalah JEJAK pekerjaan — siapa menulis apa, kapan,
 * apa yang dibatalkan — bukan angka laporan.
 *
 * ⛔ **Tidak ada satu pun aturan penilaian di berkas ini.** Semua vonis
 * (merah/kuning/hijau, ambang hari) tinggal di `keuangan-pantau-model.ts` yang
 * murni dan teruji. Berkas ini hanya menarik fakta — satu pembuat vonis.
 *
 * 📏 **Ongkosnya dibatasi dengan sengaja.** Tujuh kueri agregat dijalankan
 * SEKALI untuk seluruh unit dalam cakupan (`qScoped` menerima larik unit), jadi
 * ongkosnya tidak tumbuh bersama jumlah unit. Yang tumbuh per unit hanya tiga
 * kueri penjaga harga beli — dan itu sengaja memakai fungsi yang SAMA dengan
 * Layar 3 (`barisHargaBeli`), supaya "harga beli perlu diperbarui" di sini
 * tidak pernah berselisih dengan yang dilihat tim keuangan di layarnya.
 *
 * ⚠️ RLS berlaku: setiap kueri lewat `qScoped` dengan unit dari
 * `getDataScope()`. `app.users` di-JOIN hanya untuk menamai pelaku baris yang
 * memang sudah terlihat oleh pembaca — ia tidak membuka direktori pengguna.
 */

/** Panjang jendela pemantauan, dalam hari (termasuk tanggal akhir). */
export const JENDELA_PANTAU_HARI = 14;

/**
 * Mutasi kas ketikan tangan sebesar ini atau lebih ditandai untuk dicek.
 * Setoran terbesar yang teramati (IB, Sep 2026) ±Rp 330 jt; satu miliar dari
 * ketikan tangan lebih mungkin salah ketik daripada transaksi.
 */
export const NOMINAL_BESAR_RP = 1_000_000_000;

/** Zona waktu bisnis SPBU — sama dengan `periods.ts`. */
const TZ = "Asia/Pontianak";

export interface AkunPantau {
  unitId: number;
  nama: string;
  kind: "kas" | "bank" | "edc_penampungan";
  active: boolean;
  adaSaldoAwal: boolean;
  /** §10.26 — titik awal yang ada masih ditandai sementara. */
  saldoAwalSementara: boolean;
}

export interface BukuKasPantau {
  unitId: number;
  /** Tanggal bisnis berbeda yang punya mutasi (tanpa saldo pembuka) dalam jendela. */
  hariBermutasi: number;
  jumlahMutasi: number;
  /** Mutasi terakhir SEPANJANG MASA (bukan hanya dalam jendela). */
  mutasiTerakhir: string | null;
}

export interface SetoranTertundaPantau {
  unitId: number;
  n: number;
  rp: number;
  tertua: string | null;
}

export interface TutupHariPantau {
  unitId: number;
  ditutup: number;
  dibukaBelumDitutup: number;
  diLuarToleransi: number;
}

export interface ProdukTanpaHarga {
  unitId: number;
  productKey: string;
  nama: string;
  hari: number;
  terakhir: string;
}

export type JenisKejadian =
  | "batal_mutasi_kas"
  | "batal_kaki_edc"
  | "nominal_besar"
  | "batal_saldo_awal"
  | "batal_harga_beli"
  | "batal_settlement"
  | "batal_beban_nonkas"
  | "mutasi_terlambat"
  | "harga_beli_di_atas_jual"
  | "selisih_settlement"
  | "tutup_di_luar_toleransi"
  | "tutup_dengan_selisih"
  | "keterangan_janggal"
  | "selisih_slip_edc"
  | "rekening_edc_diubah"
  | "rekening_pencairan_beda"
  | "reklasifikasi_biaya";

export interface KejadianPantau {
  unitId: number;
  jenis: JenisKejadian;
  /** Waktu kejadian, WIB, `YYYY-MM-DD HH24:MI`. */
  waktu: string;
  /** Tanggal bisnis yang disentuh kejadian itu. */
  tanggalBisnis: string | null;
  pelaku: string | null;
  keterangan: string;
  nominal: number | null;
  /** Untuk `mutasi_terlambat`: selisih hari antara dicatat dan tanggal bisnisnya. */
  hariTerlambat: number | null;
}

export interface AktivitasPantau {
  userId: number;
  email: string | null;
  nama: string | null;
  jenis: string;
  n: number;
  terakhir: string;
}

export interface BahanPantau {
  dari: string;
  sampai: string;
  /** Hari dalam jendela yang punya penjualan, per unit — penyebut buku kas & tutup hari. */
  hariPenjualan: Map<number, number>;
  /** §10.25 — hari berpenjualan EDC vs hari yang penjualan EDC-nya sudah dibukukan. */
  edc: Map<number, { hariEdc: number; hariDibukukan: number }>;
  akun: AkunPantau[];
  bukuKas: BukuKasPantau[];
  setoran: SetoranTertundaPantau[];
  tutupHari: TutupHariPantau[];
  tanpaHarga: ProdukTanpaHarga[];
  kejadian: KejadianPantau[];
  aktivitas: AktivitasPantau[];
  /** Penjaga harga beli per unit pada tanggal akhir — dari fungsi Layar 3. */
  harga: Map<number, BarisHargaBeli[]>;
  /** §10.28 — kode kartu yang BERJUALAN dalam jendela, dengan EDC & rekening pencairannya. */
  edcPengaturan: EdcPengaturanPantau[];
}

export interface EdcPengaturanPantau {
  unitId: number;
  ckdkartu: string;
  /** `null` = kode belum dipetakan ke EDC. */
  acquirer: string | null;
  /** EDC-nya punya rekening pencairan yang berlaku pada tanggal akhir jendela. */
  adaRekening: boolean;
}

/** Batas jendela `[dari, sampai]` inklusif, dengan `sampai` = tanggal akhir. */
export function jendelaPantau(sampai: string, hari: number = JENDELA_PANTAU_HARI) {
  return { dari: addDays(sampai, -(hari - 1)), sampai };
}

/**
 * Batas waktu (timestamptz) jendela: awal hari `dari` s.d. akhir hari `sampai`,
 * dalam WIB. Dipakai kueri yang menilai KAPAN sesuatu dilakukan (dibatalkan,
 * dicatat), bukan tanggal bisnis yang disentuhnya.
 */
const SAAT_DALAM_JENDELA = (kolom: string) =>
  `${kolom} >= ($2::date)::timestamp AT TIME ZONE '${TZ}'
   AND ${kolom} <  ($3::date + 1)::timestamp AT TIME ZONE '${TZ}'`;

const WIB_TEKS = (kolom: string) =>
  `to_char(${kolom} AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI')`;

export async function getBahanPantau(
  units: readonly ScopedUnitId[],
  sampai: string,
): Promise<BahanPantau> {
  const { dari } = jendelaPantau(sampai);
  const ids = units.map(Number);
  const p = [ids, dari, sampai];

  const [hariJual, edcHari, akun, bukuKas, setoran, tutupHari, tanpaHarga, kejadian, aktivitas, harga, edcPengaturan] =
    await Promise.all([
      // Penyebut: hari yang PUNYA penjualan. Hari tanpa penjualan (unit tutup,
      // agent mati) tidak boleh dihitung sebagai "hari yang lupa dibukukan".
      qScoped<{ unitId: number; n: number }>(
        units,
        `SELECT unit_id::int AS "unitId", count(DISTINCT dtgljual)::int AS n
           FROM sales_header
          WHERE unit_id = ANY($1::int[]) AND dtgljual BETWEEN $2::date AND $3::date
          GROUP BY unit_id`,
        p,
      ),
      // §10.25 — penjualan EDC per shift yang sudah masuk EDC Penampungan.
      qScoped<{ unitId: number; hariEdc: number; hariDibukukan: number }>(
        units,
        // "Dibukukan" = SELURUH bruto EDC hari itu sudah masuk buku, bukan
        // "ada satu shift yang masuk" — hitungan per hari yang lebih longgar
        // menghijaukan hari yang shift terakhirnya terlupa (terlihat di uji lokal).
        `WITH e AS (
           SELECT unit_id, business_date AS d, sum(total) AS rp
             FROM public.edc
            WHERE unit_id = ANY($1::int[]) AND business_date BETWEEN $2::date AND $3::date
              AND ckdkartu IS NOT NULL AND trim(ckdkartu) <> ''
            GROUP BY 1, 2
           HAVING COALESCE(sum(total), 0) <> 0
         ), b AS (
           SELECT unit_id, business_date AS d, sum(amount) AS rp
             FROM app.cash_ledger
            WHERE unit_id = ANY($1::int[]) AND business_date BETWEEN $2::date AND $3::date
              AND edc_shift_cek_id IS NOT NULL AND NOT void
            GROUP BY 1, 2
         )
         SELECT e.unit_id::int AS "unitId",
                count(*)::int AS "hariEdc",
                count(*) FILTER (WHERE COALESCE(b.rp, 0) >= e.rp - 1)::int AS "hariDibukukan"
           FROM e LEFT JOIN b ON b.unit_id = e.unit_id AND b.d = e.d
          GROUP BY e.unit_id`,
        p,
      ),
      qScoped<AkunPantau>(
        units,
        `SELECT a.unit_id::int                  AS "unitId",
                a.nama,
                a.kind::text                    AS kind,
                a.active,
                EXISTS (
                  SELECT 1 FROM app.cash_ledger l
                   WHERE l.account_id = a.id AND l.saldo_awal AND NOT l.void
                )                               AS "adaSaldoAwal",
                EXISTS (
                  SELECT 1 FROM app.cash_ledger l
                   WHERE l.account_id = a.id AND l.saldo_awal AND l.saldo_awal_sementara AND NOT l.void
                )                               AS "saldoAwalSementara"
           FROM app.cash_account a
          WHERE a.unit_id = ANY($1::int[])
          ORDER BY a.unit_id, (a.kind <> 'kas'), a.nama`,
        [ids],
      ),
      qScoped<BukuKasPantau>(
        units,
        `SELECT unit_id::int AS "unitId",
                count(DISTINCT business_date)
                  FILTER (WHERE NOT saldo_awal AND business_date BETWEEN $2::date AND $3::date)::int
                                                AS "hariBermutasi",
                count(*)
                  FILTER (WHERE NOT saldo_awal AND business_date BETWEEN $2::date AND $3::date)::int
                                                AS "jumlahMutasi",
                to_char(max(business_date) FILTER (WHERE NOT saldo_awal), 'YYYY-MM-DD')
                                                AS "mutasiTerakhir"
           FROM app.cash_ledger
          WHERE unit_id = ANY($1::int[]) AND NOT void
          GROUP BY unit_id`,
        p,
      ),
      // Setoran pengawas yang BELUM dibukukan — dicocokkan lewat id sumber
      // (0033), bukan nominal; sama dengan `tawaranSetoran` di Layar 3.
      qScoped<SetoranTertundaPantau>(
        units,
        `SELECT m.unit_id::int                   AS "unitId",
                count(*)::int                    AS n,
                COALESCE(sum(m.amount), 0)::float8 AS rp,
                to_char(min(m.business_date), 'YYYY-MM-DD') AS tertua
           FROM app.manual_entry m
          WHERE m.unit_id = ANY($1::int[])
            AND m.business_date BETWEEN $2::date AND $3::date
            AND m.section = 'setoran_tunai'::app.manual_entry_section
            AND NOT m.void
            AND NOT EXISTS (
                  SELECT 1 FROM app.cash_ledger l
                   WHERE l.source_manual_entry_id = m.id AND NOT l.void
                )
          GROUP BY m.unit_id`,
        p,
      ),
      qScoped<TutupHariPantau>(
        units,
        `SELECT unit_id::int                     AS "unitId",
                count(*) FILTER (WHERE status = 'closed')::int AS ditutup,
                count(*) FILTER (WHERE status = 'open')::int   AS "dibukaBelumDitutup",
                count(*) FILTER (WHERE status = 'closed' AND tier <> 'within_tolerance')::int
                                                 AS "diLuarToleransi"
           FROM app.day_close
          WHERE unit_id = ANY($1::int[])
            AND business_date BETWEEN $2::date AND $3::date
          GROUP BY unit_id`,
        p,
      ),
      // Produk yang MENYUMBANG OMZET tanpa harga beli berlaku — hanya itu yang
      // membuat laba kotor jadi null (§10.23). Produk master yang tak terjual
      // (mis. PREMIUM lama) sengaja TIDAK ikut: menagihnya adalah alarm palsu.
      qScoped<ProdukTanpaHarga>(
        units,
        `WITH jual AS (
           SELECT h.unit_id, trim(sd.ckdbbm) AS pk, h.dtgljual AS d
             FROM sales_detail sd
             JOIN sales_header h
               ON h.unit_id = sd.unit_id AND h.ckdjualbbm = sd.ckdjualbbm
            WHERE sd.unit_id = ANY($1::int[])
              AND h.dtgljual BETWEEN $2::date AND $3::date
            GROUP BY h.unit_id, trim(sd.ckdbbm), h.dtgljual
           HAVING COALESCE(sum(sd.nsubtotal), 0) <> 0
         )
         SELECT j.unit_id::int                  AS "unitId",
                j.pk                            AS "productKey",
                COALESCE(max(p.vcnmbbm), j.pk)  AS nama,
                count(*)::int                   AS hari,
                to_char(max(j.d), 'YYYY-MM-DD') AS terakhir
           FROM jual j
           LEFT JOIN product p ON p.unit_id = j.unit_id AND trim(p.ckdbbm) = j.pk
          WHERE NOT EXISTS (
                  SELECT 1 FROM app.purchase_price pp
                   WHERE pp.unit_id = j.unit_id AND pp.product_key = j.pk
                     AND NOT pp.void AND pp.effective_from <= j.d
                )
          GROUP BY j.unit_id, j.pk
          ORDER BY j.unit_id, j.pk`,
        p,
      ),
      qScoped<KejadianPantau>(units, KUERI_KEJADIAN, p),
      qScoped<AktivitasPantau>(units, KUERI_AKTIVITAS, p),
      hargaPerUnit(units, sampai),
      // §10.28 — kesiapan pengaturan EDC: hanya kode yang BERJUALAN di jendela.
      // Kode sepi tak menagih apa pun; EDC tanpa penjualan tak butuh rekening.
      qScoped<EdcPengaturanPantau>(
        units,
        `SELECT j.unit_id::int                  AS "unitId",
                j.ckdkartu,
                m.acquirer,
                (m.acquirer IS NOT NULL AND EXISTS (
                   SELECT 1 FROM app.edc_rekening_pencairan r
                    WHERE r.unit_id = j.unit_id AND r.acquirer = upper(btrim(m.acquirer))
                      AND NOT r.void AND r.berlaku_sejak <= $3::date
                ))                              AS "adaRekening"
           FROM (
             SELECT e.unit_id, trim(e.ckdkartu) AS ckdkartu
               FROM public.edc e
              WHERE e.unit_id = ANY($1::int[]) AND e.business_date BETWEEN $2::date AND $3::date
                AND e.ckdkartu IS NOT NULL AND trim(e.ckdkartu) <> ''
              GROUP BY 1, 2
             HAVING COALESCE(sum(e.total), 0) <> 0
           ) j
           LEFT JOIN app.edc_kartu_acquirer m ON m.unit_id = j.unit_id AND m.ckdkartu = j.ckdkartu
          ORDER BY 1, 2`,
        p,
      ),
    ]);

  return {
    dari,
    sampai,
    hariPenjualan: new Map(hariJual.map((r) => [r.unitId, r.n])),
    edc: new Map(edcHari.map((r) => [r.unitId, { hariEdc: r.hariEdc, hariDibukukan: r.hariDibukukan }])),
    akun,
    bukuKas,
    setoran,
    tutupHari,
    tanpaHarga,
    kejadian,
    aktivitas,
    harga,
    edcPengaturan,
  };
}

/**
 * Penjaga harga beli per unit — memanggil fungsi yang SAMA dengan Layar 3.
 * Kalau aturan P2 berubah di `harga-beli.ts`, layar ini ikut berubah tanpa
 * disentuh; itulah alasan ia tidak menulis ulang aturannya di SQL.
 */
async function hargaPerUnit(
  units: readonly ScopedUnitId[],
  sampai: string,
): Promise<Map<number, BarisHargaBeli[]>> {
  const pasangan = await Promise.all(
    units.map(async (u) => {
      const [produk, beli, jual] = await Promise.all([
        getProdukUnit(u),
        getHargaBeliRows(u),
        getHargaJualHistory(u, sampai),
      ]);
      return [Number(u), barisHargaBeli(produk, beli, jual, sampai)] as const;
    }),
  );
  return new Map(pasangan);
}

/**
 * Daftar kejadian yang layak dilihat pemilik, dalam jendela.
 *
 * Setiap cabang UNION menjawab satu pertanyaan, dan tak satu pun menilai —
 * tingkat (merah/kuning) diberikan model. Yang diambil hanyalah fakta yang
 * sudah tercatat oleh jejak audit tiap tabel (kolom `*_by_user_id`/`*_at`).
 *
 * ⚠️ `keterangan_janggal` adalah PENANDA, bukan vonis: pengawas memiliki fakta
 * transaksinya (§2). Yang ditandai adalah baris biaya/pendapatan lain yang
 * keterangannya berbunyi seperti setoran, prive, pindah buku, atau pinjaman —
 * pos yang, bila memang itu isinya, TIDAK boleh ikut membentuk laba — dan yang
 * BELUM ditinjau Finance. Tugas Finance adalah memeriksanya, bukan menghapusnya.
 */
const KUERI_KEJADIAN = `
  SELECT * FROM (
    SELECT l.unit_id::int AS "unitId",
           (CASE WHEN l.saldo_awal THEN 'batal_saldo_awal'
                 WHEN l.edc_settlement_id IS NOT NULL THEN 'batal_kaki_edc'
                 ELSE 'batal_mutasi_kas' END) AS jenis,
           ${WIB_TEKS("l.voided_at")} AS waktu,
           to_char(l.business_date, 'YYYY-MM-DD') AS "tanggalBisnis",
           u.email AS pelaku,
           (a.nama || ' — ' || l.keterangan) AS keterangan,
           l.amount::float8 AS nominal,
           NULL::int AS "hariTerlambat"
      FROM app.cash_ledger l
      JOIN app.cash_account a ON a.id = l.account_id
      LEFT JOIN app.users u ON u.id = l.voided_by_user_id
     WHERE l.unit_id = ANY($1::int[]) AND l.void AND ${SAAT_DALAM_JENDELA("l.voided_at")}

    UNION ALL
    SELECT pp.unit_id::int, 'batal_harga_beli', ${WIB_TEKS("pp.voided_at")},
           to_char(pp.effective_from, 'YYYY-MM-DD'), u.email,
           (COALESCE(pr.vcnmbbm, pp.product_key) || ' @ ' || to_char(pp.price, 'FM999G999G990D00')),
           pp.price::float8, NULL
      FROM app.purchase_price pp
      LEFT JOIN product pr ON pr.unit_id = pp.unit_id AND trim(pr.ckdbbm) = pp.product_key
      LEFT JOIN app.users u ON u.id = pp.voided_by_user_id
     WHERE pp.unit_id = ANY($1::int[]) AND pp.void AND ${SAAT_DALAM_JENDELA("pp.voided_at")}

    UNION ALL
    SELECT s.unit_id::int, 'batal_settlement', ${WIB_TEKS("s.voided_at")},
           to_char(s.business_date, 'YYYY-MM-DD'), u.email,
           (s.acquirer || ' ' || s.settlement_no), s.gross_rp::float8, NULL
      FROM app.edc_settlement s
      LEFT JOIN app.users u ON u.id = s.voided_by_user_id
     WHERE s.unit_id = ANY($1::int[]) AND s.void AND ${SAAT_DALAM_JENDELA("s.voided_at")}

    UNION ALL
    SELECT n.unit_id::int, 'batal_beban_nonkas', ${WIB_TEKS("n.voided_at")},
           to_char(n.business_date, 'YYYY-MM-DD'), u.email,
           (n.accounting_account || ' — ' || n.keterangan), n.amount_rp::float8, NULL
      FROM app.noncash_expense n
      LEFT JOIN app.users u ON u.id = n.voided_by_user_id
     WHERE n.unit_id = ANY($1::int[]) AND n.void AND ${SAAT_DALAM_JENDELA("n.voided_at")}

    UNION ALL
    SELECT l.unit_id::int, 'mutasi_terlambat', ${WIB_TEKS("l.created_at")},
           to_char(l.business_date, 'YYYY-MM-DD'), u.email,
           (a.nama || ' — ' || l.keterangan), l.amount::float8,
           ((l.created_at AT TIME ZONE '${TZ}')::date - l.business_date)::int
      FROM app.cash_ledger l
      JOIN app.cash_account a ON a.id = l.account_id
      LEFT JOIN app.users u ON u.id = l.created_by_user_id
     WHERE l.unit_id = ANY($1::int[]) AND NOT l.void AND NOT l.saldo_awal
       AND ${SAAT_DALAM_JENDELA("l.created_at")}
       AND (l.created_at AT TIME ZONE '${TZ}')::date - l.business_date > 2

    UNION ALL
    -- Nominal raksasa yang DIKETIK (bukan setoran/EDC yang nilainya dari sistem).
    -- Formulir membuang semua non-digit, jadi "1.500.000,50" tersimpan sebagai
    -- 150.000.050 — seratus kali lipat, tanpa pesan apa pun.
    SELECT l.unit_id::int, 'nominal_besar', ${WIB_TEKS("l.created_at")},
           to_char(l.business_date, 'YYYY-MM-DD'), u.email,
           (a.nama || ' — ' || l.keterangan), l.amount::float8, NULL
      FROM app.cash_ledger l
      JOIN app.cash_account a ON a.id = l.account_id
      LEFT JOIN app.users u ON u.id = l.created_by_user_id
     WHERE l.unit_id = ANY($1::int[]) AND NOT l.void AND NOT l.saldo_awal
       AND l.source_manual_entry_id IS NULL AND l.edc_settlement_id IS NULL
       AND abs(l.amount) >= ${NOMINAL_BESAR_RP}
       AND ${SAAT_DALAM_JENDELA("l.created_at")}

    UNION ALL
    SELECT pp.unit_id::int, 'harga_beli_di_atas_jual', ${WIB_TEKS("pp.created_at")},
           to_char(pp.effective_from, 'YYYY-MM-DD'), u.email,
           (COALESCE(pr.vcnmbbm, pp.product_key) || ' beli ' || to_char(pp.price, 'FM999G999G990D00')
             || ' > jual ' || to_char(pp.p1_sell_price, 'FM999G999G990D00')
             || ' · alasan: ' || COALESCE(pp.p1_reason, '-')),
           pp.price::float8, NULL
      FROM app.purchase_price pp
      LEFT JOIN product pr ON pr.unit_id = pp.unit_id AND trim(pr.ckdbbm) = pp.product_key
      LEFT JOIN app.users u ON u.id = pp.created_by_user_id
     WHERE pp.unit_id = ANY($1::int[]) AND NOT pp.void AND pp.p1_triggered
       AND ${SAAT_DALAM_JENDELA("pp.created_at")}

    UNION ALL
    SELECT s.unit_id::int, 'selisih_settlement', ${WIB_TEKS("s.created_at")},
           to_char(s.business_date, 'YYYY-MM-DD'), u.email,
           (s.acquirer || ' ' || s.settlement_no || COALESCE(' · ' || s.reason_code, ' · tanpa reason code')),
           s.selisih_rp::float8, NULL
      FROM app.edc_settlement s
      LEFT JOIN app.users u ON u.id = s.created_by_user_id
     WHERE s.unit_id = ANY($1::int[]) AND NOT s.void
       AND s.selisih_rp IS NOT NULL AND s.selisih_rp <> 0
       AND ${SAAT_DALAM_JENDELA("s.created_at")}

    UNION ALL
    SELECT dc.unit_id::int,
           (CASE WHEN dc.tier <> 'within_tolerance' THEN 'tutup_di_luar_toleransi'
                 ELSE 'tutup_dengan_selisih' END),
           ${WIB_TEKS("dc.closed_at")},
           to_char(dc.business_date, 'YYYY-MM-DD'), u.email,
           (dc.tier::text || COALESCE(' · ' || dc.reason_code, '')), dc.difference_rp::float8, NULL
      FROM app.day_close dc
      LEFT JOIN app.users u ON u.id = dc.closed_by_user_id
     WHERE dc.unit_id = ANY($1::int[]) AND dc.status = 'closed' AND dc.difference_rp <> 0
       AND ${SAAT_DALAM_JENDELA("dc.closed_at")}

    UNION ALL
    SELECT m.unit_id::int, 'keterangan_janggal',
           ${WIB_TEKS("m.created_at")},
           to_char(m.business_date, 'YYYY-MM-DD'), NULL,
           (m.section::text || ' — ' || m.keterangan), m.amount::float8, NULL
      FROM app.manual_entry m
     WHERE m.unit_id = ANY($1::int[]) AND NOT m.void
       AND m.section IN ('pengeluaran', 'pendapatan_lain')
       AND m.status = 'submitted'
       AND m.business_date BETWEEN $2::date AND $3::date
       AND m.keterangan ~* '(setor|prive|pindah ?buku|pinjam|kasbon|transfer)'
       -- §10.27 — titipan outlet Bright sudah DIKENALI (liabilitas, bukan laba):
       -- bukan lagi pos janggal. Tanpa ini 105 baris produksi 12–25 Sep tetap menjerit.
       AND NOT ${sqlTitipanBright("m")}
       -- §10.29 — sudah ditinjau Finance lewat reklasifikasi: bukan lagi pos
       -- yang menunggu, melainkan kejadian 'reklasifikasi_biaya' di bawah.
       AND NOT EXISTS (
             SELECT 1 FROM app.reclassification rc
              WHERE rc.source_kind = 'manual_entry' AND rc.source_txn_id = m.id
           )

    -- §10.29 — setiap reklasifikasi biaya pengawas terlihat: memindahkan pos
    -- keluar dari laba MENAIKKAN laba, jadi pemilik harus bisa melihatnya.
    UNION ALL
    SELECT r.unit_id::int, 'reklasifikasi_biaya', ${WIB_TEKS("r.created_at")},
           to_char(m.business_date, 'YYYY-MM-DD'), u.email,
           (m.keterangan || ' · ' || r.from_account || ' → ' || r.to_account
             || ' · ' || r.reason_code || COALESCE(' · ' || r.note, '')),
           abs(m.amount)::float8, NULL
      FROM app.reclassification r
      JOIN app.manual_entry m ON m.id = r.source_txn_id AND m.unit_id = r.unit_id
      LEFT JOIN app.users u ON u.id = r.created_by_user_id
     WHERE r.unit_id = ANY($1::int[]) AND r.source_kind = 'manual_entry'
       AND ${SAAT_DALAM_JENDELA("r.created_at")}

    UNION ALL
    SELECT k.unit_id::int, 'selisih_slip_edc', ${WIB_TEKS("k.checked_at")},
           to_char(k.business_date, 'YYYY-MM-DD'), u.email,
           ('shift ' || k.cshift || ' ' || k.acquirer || ' · slip ' || to_char(k.slip_rp, 'FM999G999G990')
             || ' vs EasyMax ' || to_char(k.easymax_rp, 'FM999G999G990')
             || COALESCE(' · ' || k.reason_code, '')),
           (k.slip_rp - k.easymax_rp)::float8, NULL
      FROM app.edc_shift_cek k
      LEFT JOIN app.users u ON u.id = k.checked_by_user_id
     WHERE k.unit_id = ANY($1::int[]) AND NOT k.void
       AND abs(k.slip_rp - k.easymax_rp) >= 1
       AND ${SAAT_DALAM_JENDELA("k.checked_at")}

    -- §10.28 — SETIAP perubahan rekening pencairan EDC terlihat, bukan hanya
    -- bisa ditelusuri: mengganti rekening tujuan dana adalah celah klasik.
    UNION ALL
    SELECT r.unit_id::int, 'rekening_edc_diubah', ${WIB_TEKS("r.created_at")},
           to_char(r.berlaku_sejak, 'YYYY-MM-DD'), u.email,
           (r.acquirer || ' → ' || a.nama || ' mulai ' || to_char(r.berlaku_sejak, 'YYYY-MM-DD')
             || COALESCE(' · sebelumnya ' || (
                  SELECT a0.nama FROM app.edc_rekening_pencairan r0
                    JOIN app.cash_account a0 ON a0.id = r0.to_account_id AND a0.unit_id = r0.unit_id
                   WHERE r0.unit_id = r.unit_id AND r0.acquirer = r.acquirer AND r0.id <> r.id
                     AND NOT r0.void AND r0.berlaku_sejak <= r.berlaku_sejak
                   ORDER BY r0.berlaku_sejak DESC LIMIT 1), ' · pertama kali')
             || COALESCE(' · ' || r.catatan, '')),
           NULL::float8, NULL
      FROM app.edc_rekening_pencairan r
      JOIN app.cash_account a ON a.id = r.to_account_id AND a.unit_id = r.unit_id
      LEFT JOIN app.users u ON u.id = r.created_by_user_id
     WHERE r.unit_id = ANY($1::int[])
       AND ${SAAT_DALAM_JENDELA("r.created_at")}

    UNION ALL
    SELECT r.unit_id::int, 'rekening_edc_diubah', ${WIB_TEKS("r.voided_at")},
           to_char(r.berlaku_sejak, 'YYYY-MM-DD'), u.email,
           (r.acquirer || ' → ' || a.nama || ' mulai ' || to_char(r.berlaku_sejak, 'YYYY-MM-DD')
             || ' · DIBATALKAN'),
           NULL::float8, NULL
      FROM app.edc_rekening_pencairan r
      JOIN app.cash_account a ON a.id = r.to_account_id AND a.unit_id = r.unit_id
      LEFT JOIN app.users u ON u.id = r.voided_by_user_id
     WHERE r.unit_id = ANY($1::int[]) AND r.void
       AND ${SAAT_DALAM_JENDELA("r.voided_at")}

    -- §10.28 — batch settlement yang dananya dicatat masuk ke rekening LAIN dari
    -- Pengaturan EDC yang berlaku pada tanggal uang masuk. Bisa sah (bank
    -- memindahkan tanpa pemberitahuan) — itulah sebabnya ia ditandai, bukan ditolak.
    UNION ALL
    SELECT s.unit_id::int, 'rekening_pencairan_beda', ${WIB_TEKS("s.created_at")},
           to_char(s.business_date, 'YYYY-MM-DD'), u.email,
           (s.acquirer || ' ' || s.settlement_no || ' · masuk ke ' || a.nama
             || ' · pengaturan: ' || ap.nama),
           s.net_rp::float8, NULL
      FROM app.edc_settlement s
      JOIN LATERAL (
             SELECT r.to_account_id FROM app.edc_rekening_pencairan r
              WHERE r.unit_id = s.unit_id AND r.acquirer = upper(btrim(s.acquirer))
                AND NOT r.void AND r.berlaku_sejak <= s.settlement_date
              ORDER BY r.berlaku_sejak DESC
              LIMIT 1
           ) p ON true
      JOIN app.cash_account a  ON a.id  = s.to_account_id AND a.unit_id  = s.unit_id
      JOIN app.cash_account ap ON ap.id = p.to_account_id AND ap.unit_id = s.unit_id
      LEFT JOIN app.users u ON u.id = s.created_by_user_id
     WHERE s.unit_id = ANY($1::int[]) AND NOT s.void
       AND s.to_account_id <> p.to_account_id
       AND ${SAAT_DALAM_JENDELA("s.created_at")}
  ) k
  ORDER BY k.waktu DESC NULLS LAST
  LIMIT 300`;

/**
 * Aktivitas tulis per orang dalam jendela — dari kolom pelaku tiap tabel.
 *
 * Ini yang menjawab "apakah tim keuangan benar-benar memakai SolaMax": orang
 * yang tidak pernah muncul di sini tidak mengerjakan apa pun di modul ini,
 * apa pun yang dikatakan laporannya.
 */
const KUERI_AKTIVITAS = `
  WITH aksi AS (
    SELECT created_by_user_id AS uid,
           (CASE WHEN saldo_awal THEN 'saldo pembuka' ELSE 'mutasi kas' END) AS jenis,
           created_at AS ts
      FROM app.cash_ledger
     WHERE unit_id = ANY($1::int[]) AND ${SAAT_DALAM_JENDELA("created_at")}
    UNION ALL
    SELECT voided_by_user_id, 'pembatalan', voided_at
      FROM app.cash_ledger
     WHERE unit_id = ANY($1::int[]) AND void AND ${SAAT_DALAM_JENDELA("voided_at")}
    UNION ALL
    SELECT created_by_user_id, 'harga beli', created_at
      FROM app.purchase_price
     WHERE unit_id = ANY($1::int[]) AND ${SAAT_DALAM_JENDELA("created_at")}
    UNION ALL
    SELECT voided_by_user_id, 'pembatalan', voided_at
      FROM app.purchase_price
     WHERE unit_id = ANY($1::int[]) AND void AND ${SAAT_DALAM_JENDELA("voided_at")}
    UNION ALL
    SELECT created_by_user_id, 'settlement EDC', created_at
      FROM app.edc_settlement
     WHERE unit_id = ANY($1::int[]) AND ${SAAT_DALAM_JENDELA("created_at")}
    UNION ALL
    SELECT voided_by_user_id, 'pembatalan', voided_at
      FROM app.edc_settlement
     WHERE unit_id = ANY($1::int[]) AND void AND ${SAAT_DALAM_JENDELA("voided_at")}
    UNION ALL
    SELECT checked_by_user_id, 'cek slip EDC', checked_at
      FROM app.edc_shift_cek
     WHERE unit_id = ANY($1::int[]) AND ${SAAT_DALAM_JENDELA("checked_at")}
    UNION ALL
    SELECT posted_by_user_id, 'pencairan EDC', posted_at
      FROM app.edc_settlement
     WHERE unit_id = ANY($1::int[]) AND posted_by_user_id IS NOT NULL
       AND ${SAAT_DALAM_JENDELA("posted_at")}
    UNION ALL
    SELECT created_by_user_id, 'biaya (pintu finance)', created_at
      FROM app.manual_entry
     WHERE unit_id = ANY($1::int[]) AND source_door = 'finance'
       AND ${SAAT_DALAM_JENDELA("created_at")}
    UNION ALL
    SELECT closed_by_user_id, 'tutup hari', closed_at
      FROM app.day_close
     WHERE unit_id = ANY($1::int[]) AND closed_by_user_id IS NOT NULL
       AND ${SAAT_DALAM_JENDELA("closed_at")}
  )
  SELECT a.uid::int                         AS "userId",
         u.email,
         u.name                             AS nama,
         a.jenis,
         count(*)::int                      AS n,
         ${WIB_TEKS("max(a.ts)")}           AS terakhir
    FROM aksi a
    LEFT JOIN app.users u ON u.id = a.uid
   WHERE a.uid IS NOT NULL
   GROUP BY a.uid, u.email, u.name, a.jenis
   ORDER BY max(a.ts) DESC`;
