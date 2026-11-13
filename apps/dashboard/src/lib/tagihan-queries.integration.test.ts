import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { ScopedUnitId } from "./scope";

/**
 * KUERI TAGIHAN di DB nyata (rencana 2026-11-13 U6) — SQL yang SAMA dengan
 * layar, dijalankan terhadap skema sebenarnya (migrasi 0063/0064/0037), di
 * dalam transaksi yang SELALU di-ROLLBACK (nol jejak), pada unit FIKTIF
 * 8801/8802/8803 (pola `termin.integration.test.ts`).
 *
 * Yang dibuktikan, dan tak bisa dibuktikan uji tiruan:
 *   · setiap kueri SAH terhadap skema (kolom, tipe, bpchar vs text);
 *   · AE10 dan tautan faktur batal pada kelompok "belum ditagihkan";
 *   · populasi piutang: kelas tunai (4) tak pernah ikut, kode bertitik ikut;
 *   · saringan lunas per periode pelunasan;
 *   · cocok-silang R20 terhadap pointer Saldo pelanggan TERBARU;
 *   · isolasi RLS antar unit lewat mekanisme `qScoped` (GUC `app.unit_ids`
 *     diturunkan dari argumen unit, transaction-local).
 *
 * ⚠️ Yang TIDAK diuji di sini: pemakaian index ekspresi atas
 * `btrim(vcref)` (dibatalkan dari 0063). Di bawah RLS index itu tak bisa melayani
 * `trim(vcref) = …` (`btrim` tidak leakproof) — lihat catatan di
 * `tagihan-queries.ts`. Mengasersikannya berarti mengasersikan keterbatasan.
 *
 * `qScoped` TIRUAN meneruskan ke klien transaksi uji dan — seperti aslinya —
 * menyetel `app.unit_ids` dari argumen `unit` sebelum tiap kueri, supaya yang
 * membatasi baris benar-benar RLS, bukan hanya WHERE.
 *
 * Gated: TAGIHAN_LIVE_DB=1 dan TAGIHAN_DB_URL = koneksi role PEMILIK tabel
 * (`ingest`) di tier TESTING, atau klaster Postgres 16 sekali pakai yang sudah
 * diberi seluruh migrasi. ⛔ Role itu TIDAK BOLEH superuser / BYPASSRLS — uji
 * isolasi akan hijau palsu; karena itu ia diperiksa dan uji RLS MERAH bila
 * demikian. ⛔ Jangan arahkan ke DB pilot live. Semua nilai ilustratif.
 */
const LIVE = process.env.TAGIHAN_LIVE_DB === "1" && !!process.env.TAGIHAN_DB_URL;
const d = LIVE ? describe : describe.skip;

const h = vi.hoisted(() => ({
  klien: null as PoolClient | null,
  panggilan: [] as { sql: string; params: unknown[] }[],
  antre: Promise.resolve() as Promise<unknown>,
}));
vi.mock("./db", () => ({
  qScoped: (unit: number | readonly number[], sql: string, params: unknown[] = []) => {
    // Satu klien transaksi dipakai bersama: kueri paralel (`Promise.all`) diantrekan
    // supaya set_config + kueri tiap panggilan tetap berpasangan.
    const jalan = h.antre.then(async () => {
      if (h.klien === null) throw new Error("qScoped tiruan dipanggil di luar transaksi uji");
      const ids = (Array.isArray(unit) ? unit : [unit]).map((u) => Number(u)).join(",");
      await h.klien.query("SELECT set_config('app.unit_ids', $1, true)", [ids]);
      h.panggilan.push({ sql, params });
      return (await h.klien.query(sql, params)).rows;
    });
    h.antre = jalan.catch(() => {});
    return jalan;
  },
}));

const {
  getBelumDitagihkan,
  getDokumenBelumDitagihkan,
  getRingkasanTagihanLintasUnit,
  getSaldoTerbitTerakhir,
  getTagihanDaftar,
  getTagihanEkspor,
  getTagihanFaktur,
  getTagihanKesiapan,
  getTagihanPelanggan,
  getTagihanRingkasanUnit,
} = await import("./tagihan-queries");

const UA = 8801 as ScopedUnitId;
const UB = 8802 as ScopedUnitId;
/** Unit tanpa siklus lengkap. */
const UC = 8803 as ScopedUnitId;
const SEMUA = `${UA},${UB},${UC}`;
const HARI_INI = "2026-11-13";
const PERIODE = { from: "2026-10-01", to: "2026-11-30" };

/** Kode ilustratif: bergaris miring (Lokal), bertitik (Online), kelas tunai. */
const P1 = "UJI/01";
const P2 = "UJI.02";
const PTUNAI = "UJITUNAI";

const SUM32 = `\\x${"00".repeat(32)}`;
const CYCLE_A = "aaaaaaaa-0000-4000-8000-000000008801";
const GEN_LAMA = "bbbbbbbb-0000-4000-8000-000000008801";
const GEN_BARU = "cccccccc-0000-4000-8000-000000008801";

d("0063 — kueri tagihan pelanggan terhadap skema nyata", () => {
  let pool: Pool;
  let applied = false;
  let melewatiRls = true;

  const scope = (c: PoolClient, ids: string) => c.query("SELECT set_config('app.unit_ids', $1, true)", [ids]);

  const fixture = async (c: PoolClient): Promise<void> => {
    await scope(c, SEMUA);
    // `source_cycle` ber-FK ke `public.unit`; unit fiktif hidup hanya di transaksi ini.
    const t = await c.query<{ id: string }>(
      `INSERT INTO app.tenant (name, slug) VALUES ('Tenant Uji Tagihan', 'uji-tagihan-8801') RETURNING id`,
    );
    await c.query(
      `INSERT INTO public.unit (unit_id, code, name, api_key_hash, tenant_id) VALUES
         ($1, 'UJI-8801', 'Unit Uji A', 'uji-hash-8801', $4),
         ($2, 'UJI-8802', 'Unit Uji B', 'uji-hash-8802', $4),
         ($3, 'UJI-8803', 'Unit Uji C', 'uji-hash-8803', $4)`,
      [UA, UB, UC, t.rows[0]!.id],
    );
    await c.query(
      `INSERT INTO public.tagihan_cycle (unit_id, cycle_id, completed_at, header_count, bayar_count) VALUES
         ($1, gen_random_uuid(), '2026-11-13T02:00:00Z', 6, 5),
         ($2, gen_random_uuid(), '2026-11-12T23:30:00Z', 1, 0)`,
      [UA, UB],
    );
    // CHAR(12): tersimpan berpengisi spasi, persis seperti cermin EasyMax.
    await c.query(
      `INSERT INTO public.pelanggan_master (unit_id, ckdplg, vcnmplg, sjenis, saktif) VALUES
         ($1, $3, 'PT Contoh Ilustrasi', 1, 1),
         ($1, $4, 'Pelanggan Online Contoh', 3, 1),
         ($1, $5, 'Pelanggan Tunai Contoh', 4, 1),
         ($2, $3, 'PT Contoh Ilustrasi (unit B)', 1, 1)`,
      [UA, UB, P1, P2, PTUNAI],
    );
    await c.query(
      `INSERT INTO public.tagihan_header
         (unit_id, ckdtagih, dtgl, dtgljt, ckdplg, ntotal, nadm, ngatot, nstatus, sbatal, vcalasan, nlastsaldo, sjenistag) VALUES
         ($1, 'UJI-F-01', '2026-10-01', '2026-10-01', 'UJI/01  ', 10000000, 0, 10000000, 0, 0, NULL, 6000000, 1),
         ($1, 'UJI-F-02', '2026-10-20', '2026-10-20', 'UJI/01',    5000000, 0,  5000000, 1, 0, NULL, 0, 1),
         ($1, 'UJI-F-03', '2026-11-01', '2026-11-15', 'UJI.02',    2000000, 0,  2000000, 1, 0, NULL, -50000, 1),
         ($1, 'UJI-F-04', '2026-11-02', '2026-11-02', 'UJI/01',     700000, 0,   700000, 0, 1, 'salah input', 700000, 1),
         ($1, 'UJI-F-05', '2026-07-15', '2026-07-15', 'UJI/01',    3000000, 0,  3000000, 1, 0, NULL, 0, 1),
         ($1, 'UJI-F-06', NULL,         NULL,         'UJI/01',     250000, 0,   250000, 0, 0, NULL, 250000, 1),
         ($2, 'UJI-F-01', '2026-11-03', '2026-11-03', 'UJI/01',     999000, 0,   999000, 0, 0, NULL, 999000, 1)`,
      [UA, UB],
    );
    await c.query(
      `INSERT INTO public.tagihan_bayar (unit_id, ckdbyr, dtgl, ckdtagih, vcbukti, ntotal, sbatal, vcalasan) VALUES
         ($1, 'UJI-B-01', '2026-10-10', 'UJI-F-01', 'BKT-01', 4000000, 0, NULL),
         ($1, 'UJI-B-02', '2026-10-11', 'UJI-F-01', 'BKT-02', 1000000, 1, 'dobel input'),
         ($1, 'UJI-B-03', '2026-11-05', 'UJI-F-02', 'BKT-03', 5000000, 0, NULL),
         ($1, 'UJI-B-04', '2026-11-06', 'UJI-F-03', 'BKT-04', 2050000, 0, NULL),
         ($1, 'UJI-B-05', '2026-08-10', 'UJI-F-05', 'BKT-05', 3000000, 0, NULL)`,
      [UA],
    );
    await c.query(
      `INSERT INTO public.tagihan_detail (unit_id, ckdtagih, ckdjualplg) VALUES
         ($1, 'UJI-F-01', 'JP-UJI-001'),
         ($1, 'UJI-F-01', 'JP-UJI-002'),
         ($1, 'UJI-F-01', 'JP-UJI-HILANG'),
         ($1, 'UJI-F-04', 'JP-UJI-BTL')`,
      [UA],
    );
    await c.query(
      `INSERT INTO public.bppiut (unit_id, ckdbppiut, dtgl, ckdplg, vcref, vcket, njumlah, sjnsbp, sbatal) VALUES
         ($1, 'UJI-BP-01', '2026-09-20', 'UJI/01',   'JP-UJI-001',   'Penjualan', 6000000, 1, 0),
         ($1, 'UJI-BP-02', '2026-09-25', 'UJI/01',   'JP-UJI-002  ', 'Penjualan', 4000000, 1, 0),
         ($1, 'UJI-BP-03', '2026-11-02', 'UJI/01 ',  'JP-UJI-BTL',   'Penjualan',  700000, 1, 0),
         ($1, 'UJI-BP-04', '2026-11-12', 'UJI/01',   'JP-UJI-NEW  ', 'Penjualan',  300000, 1, 0),
         ($1, 'UJI-BP-05', '2026-11-10', 'UJI.02',   'UV-UJI-01',    'Voucher',    150000, 1, 0),
         ($1, 'UJI-BP-06', '2026-11-11', 'UJITUNAI', 'JP-UJI-TUNAI', 'Penjualan Pelanggan Tunai', 80000, 1, 0),
         ($1, 'UJI-BP-07', '2026-11-11', 'UJI/01',   'JP-UJI-KREDIT','Pembayaran', 500000, 2, 0),
         ($1, 'UJI-BP-08', '2026-11-11', 'UJI/01',   'JP-UJI-BATAL', 'Penjualan',  900000, 1, 1),
         ($1, 'UJI-BP-09', '2026-11-11', 'UJI/01',   'XX-UJI-01',    'Lain-lain',  123000, 1, 0),
         ($1, 'UJI-BP-10', '2026-11-11', 'UJIYATIM', 'JP-UJI-YATIM', 'Penjualan',   77000, 1, 0),
         ($2, 'UJI-BP-01', '2026-11-09', 'UJI/01',   'JP-UJI-B01',   'Penjualan',  111000, 1, 0)`,
      [UA, UB],
    );
    await c.query(
      `INSERT INTO app.termin_unit (unit_id, termin_hari, created_by_user_id) VALUES ($1, 30, 1)`,
      [UA],
    );
    // Dua generasi Saldo pelanggan terbit di unit A: 10 Nov (lama) dan 12 Nov (terbaru).
    await c.query(
      `INSERT INTO app.saldo_pelanggan_source_cycle (
         unit_id, source_cycle_id, source_cycle_sequence, status, source_completed_at, promoted_at,
         pelanggan_row_count, pelanggan_keyed_checksum, bppiut_row_count, bppiut_keyed_checksum,
         bphut_row_count, bphut_keyed_checksum
       ) VALUES ($1, $2::uuid, 1, 'complete', clock_timestamp(), clock_timestamp(),
                 0, $3::bytea, 0, $3::bytea, 0, $3::bytea)`,
      [UA, CYCLE_A, SUM32],
    );
    const manifest = `
      INSERT INTO app.saldo_pelanggan_snapshot_manifest (
        unit_id, as_of_date, generation_id, formula_version, status,
        source_cycle_id, source_cycle_sequence, source_cycle_status, source_completed_at,
        computed_at, completed_at, published, published_at, validation_passed,
        customer_key_count, row_count, row_keyed_checksum,
        awal_piutang_lokal_total, akhir_piutang_lokal_total,
        awal_piutang_online_total, akhir_piutang_online_total,
        awal_hutang_lokal_total, akhir_hutang_lokal_total,
        awal_piutang_lokal_debet_total, awal_piutang_lokal_kredit_total,
        akhir_piutang_lokal_debet_total, akhir_piutang_lokal_kredit_total,
        awal_piutang_online_debet_total, awal_piutang_online_kredit_total,
        akhir_piutang_online_debet_total, akhir_piutang_online_kredit_total,
        awal_hutang_lokal_debet_total, awal_hutang_lokal_kredit_total,
        akhir_hutang_lokal_debet_total, akhir_hutang_lokal_kredit_total,
        source_pelanggan_row_count, source_pelanggan_keyed_checksum,
        source_bppiut_row_count, source_bppiut_keyed_checksum,
        source_bphut_row_count, source_bphut_keyed_checksum
      ) VALUES ($1, $2::date, $3::uuid, 'saldo-pelanggan-v2', 'complete',
                $4::uuid, 1, 'complete', clock_timestamp(),
                clock_timestamp(), clock_timestamp(), true, clock_timestamp(), true,
                2, 2, $5::bytea,
                $6, $6, $7, $7, 0, 0,
                $6, 0, $6, 0, $7, 0, $7, 0, 0, 0, 0, 0,
                0, $5::bytea, 0, $5::bytea, 0, $5::bytea)`;
    const baris = `
      INSERT INTO app.saldo_pelanggan_snapshot_row (
        unit_id, as_of_date, generation_id, customer_code,
        awal_piutang_lokal, akhir_piutang_lokal, awal_piutang_online, akhir_piutang_online,
        awal_hutang_lokal, akhir_hutang_lokal,
        awal_piutang_lokal_debet, awal_piutang_lokal_kredit,
        akhir_piutang_lokal_debet, akhir_piutang_lokal_kredit,
        awal_piutang_online_debet, awal_piutang_online_kredit,
        akhir_piutang_online_debet, akhir_piutang_online_kredit,
        awal_hutang_lokal_debet, awal_hutang_lokal_kredit,
        akhir_hutang_lokal_debet, akhir_hutang_lokal_kredit
      ) VALUES ($1, $2::date, $3::uuid, $4, $5, $5, $6, $6, 0, 0,
                $5, 0, $5, 0, $6, 0, $6, 0, 0, 0, 0, 0)`;
    const pointer = `
      INSERT INTO app.saldo_pelanggan_snapshot_pointer
        (unit_id, as_of_date, generation_id, source_cycle_sequence, rebuild_epoch)
      VALUES ($1, $2::date, $3::uuid, 1, 0)`;
    for (const [tanggal, gen, lokal, online] of [
      ["2026-11-10", GEN_LAMA, 1_000_000, 0],
      ["2026-11-12", GEN_BARU, 7_500_000, 100_000],
    ] as const) {
      await c.query(manifest, [UA, tanggal, gen, CYCLE_A, SUM32, lokal, online]);
      await c.query(baris, [UA, tanggal, gen, P1, lokal, 0]);
      await c.query(baris, [UA, tanggal, gen, P2, 0, online]);
      await c.query(pointer, [UA, tanggal, gen]);
    }
  };

  /** Jalankan fn dalam transaksi yang SELALU di-ROLLBACK, dengan fixture terpasang. */
  const tx = async (fn: (c: PoolClient) => Promise<void>): Promise<void> => {
    const c = await pool.connect();
    h.klien = c;
    h.panggilan.length = 0;
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout = '5s'");
      await fixture(c);
      // Buang scope fixture: sesudah ini hanya `qScoped` yang menentukan scope.
      await scope(c, "");
      await fn(c);
    } finally {
      h.klien = null;
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TAGIHAN_DB_URL, max: 2 });
    const r = await pool.query<{ ada: boolean }>(
      `SELECT to_regclass('public.tagihan_cycle') IS NOT NULL AND to_regclass('app.termin_unit') IS NOT NULL AS ada`,
    );
    applied = r.rows[0]?.ada === true;
    const p = await pool.query<{ lewat: boolean }>(
      `SELECT rolsuper OR rolbypassrls AS lewat FROM pg_roles WHERE rolname = current_user`,
    );
    melewatiRls = p.rows[0]?.lewat !== false;
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("kesiapan dari tagihan_cycle; unit tanpa siklus = belum tersedia, bukan nol", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(async () => {
      expect(await getTagihanKesiapan(UA)).toEqual({
        tersedia: true,
        selesaiAt: "2026-11-13T02:00:00Z",
        selesaiWib: "2026-11-13 09:00",
        jumlahFaktur: 6,
        jumlahPembayaran: 5,
        pembayaranTerakhir: "2026-11-06",
      });
      expect(await getTagihanKesiapan(UC)).toEqual({ tersedia: false });
      expect(await getTagihanRingkasanUnit(UC, HARI_INI)).toEqual({ tersedia: false });
      expect(await getTagihanDaftar(UC, { filter: "perlu_tindakan", periodeLunas: PERIODE, hariIni: HARI_INI }))
        .toEqual({ tersedia: false });
      expect(await getBelumDitagihkan(UC, { hariIni: HARI_INI })).toEqual({ tersedia: false });
      expect(await getTagihanPelanggan(UC, P1, HARI_INI)).toEqual({ tersedia: false });
    });
  });

  it("daftar unit: faktur terbuka + status model + ubin; faktur batal & lunas tak ikut", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(async () => {
      const hasil = await getTagihanDaftar(UA, { filter: "perlu_tindakan", periodeLunas: PERIODE, hariIni: HARI_INI });
      if (!hasil.tersedia) throw new Error("unit A seharusnya tersedia");
      // Urutan model: hari lewat menurun, lalu jatuh tempo menaik (tanpa tanggal di akhir).
      expect(hasil.halaman.rows.map((b) => b.faktur.kode)).toEqual(["UJI-F-01", "UJI-F-03", "UJI-F-06"]);

      const [f1, f3, f6] = hasil.halaman.rows;
      // Sebagian: 4 jt hidup, 1 jt batal tak dihitung; termin unit 30 hari → jatuh tempo 31 Okt.
      expect(f1!.faktur.customerCode).toBe(P1);
      expect(f1!.namaPelanggan).toBe("PT Contoh Ilustrasi");
      expect(f1!.status).toMatchObject({
        nilai: 10_000_000, dibayar: 4_000_000, sisa: 6_000_000, statusBayar: "sebagian",
        statusJatuhTempo: "lewat_jatuh_tempo", hariLewat: 13, jatuhTempo: "2026-10-31",
        sumber: "termin_unit", bedaStatus: false, bedaSisa: false,
      });
      expect(f1).toMatchObject({ jumlahPembayaran: 1, jumlahPembayaranBatal: 1, tanggalBayarTerakhir: "2026-10-10" });
      // Tanggal faktur kosong: tak pernah lewat jatuh tempo.
      expect(f6).toMatchObject({ tanggalFakturKosong: true });
      expect(f6!.status).toMatchObject({ statusBayar: "belum_dibayar", statusJatuhTempo: "termin_belum_diatur" });
      // Lebih bayar tetap tampil (R7), sisa negatif.
      expect(f3!.status).toMatchObject({ statusBayar: "lebih_bayar", sisa: -50_000, statusJatuhTempo: null });
      expect(f3!.namaPelanggan).toBe("Pelanggan Online Contoh");

      expect(hasil.ubin).toEqual({
        lewatJatuhTempo: { jumlah: 1, sisa: 6_000_000 },
        belumJatuhTempo: { jumlah: 0, sisa: 0 },
        terminBelumDiatur: { jumlah: 1, sisa: 250_000 },
        belumDitagihkan: { jumlahDokumen: 3, jumlahPelanggan: 2, total: 1_150_000 },
      });
      expect(hasil.fakturBergantungTermin).toBe(2);
      expect(hasil.terpotong).toBe(false);

      // Pencarian: nama atau kode, tak peka huruf besar.
      const cari = await getTagihanDaftar(UA, { filter: "perlu_tindakan", cari: "online", periodeLunas: PERIODE, hariIni: HARI_INI });
      if (!cari.tersedia) throw new Error("tak tersedia");
      expect(cari.halaman.rows.map((b) => b.faktur.kode)).toEqual(["UJI-F-03"]);
      // Ubin tak ikut tersaring.
      expect(cari.ubin).toEqual(hasil.ubin);
    });
  });

  it("lunas dibatasi PERIODE PELUNASAN; ekspor memuat baris yang sama tanpa halaman", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(async () => {
      const lunas = await getTagihanEkspor(UA, { filter: "lunas", periodeLunas: PERIODE, hariIni: HARI_INI });
      if (!lunas.tersedia) throw new Error("tak tersedia");
      // UJI-F-05 lunas 10 Agu — di luar periode; UJI-F-02 lunas 5 Nov.
      expect(lunas.baris.map((b) => b.faktur.kode)).toEqual(["UJI-F-02"]);
      expect(lunas.periodeLunas).toEqual(PERIODE);

      const agustus = await getTagihanEkspor(UA, {
        filter: "lunas", periodeLunas: { from: "2026-08-01", to: "2026-08-31" }, hariIni: HARI_INI,
      });
      if (!agustus.tersedia) throw new Error("tak tersedia");
      // Faktur 15 Jul yang dilunasi 10 Agu muncul di Agustus: periode = tanggal pelunasan.
      expect(agustus.baris.map((b) => b.faktur.kode)).toEqual(["UJI-F-05"]);
      expect(agustus.ubin).toEqual(lunas.ubin);
    });
  });

  it("rincian faktur: dokumen (yang tak ada di buku tetap tampil), pembayaran batal ikut, lintas unit = null", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(async () => {
      const r = await getTagihanFaktur(UA, " UJI-F-01 ", HARI_INI);
      expect(r).not.toBeNull();
      expect(r!.faktur).toMatchObject({ kode: "UJI-F-01", customerCode: P1, nilai: 10_000_000, batal: false });
      expect(r!.status).toMatchObject({ dibayar: 4_000_000, sisa: 6_000_000, statusBayar: "sebagian" });
      expect(r!.dokumen).toEqual([
        { kodeDokumen: "JP-UJI-001", tanggal: "2026-09-20", jumlah: 6_000_000 },
        { kodeDokumen: "JP-UJI-002", tanggal: "2026-09-25", jumlah: 4_000_000 },
        { kodeDokumen: "JP-UJI-HILANG", tanggal: null, jumlah: null },
      ]);
      expect(r!.totalDokumen).toBe(10_000_000);
      expect(r!.dokumenTanpaBuku).toBe(1);
      expect(r!.pembayaran.map((p) => [p.kode, p.jumlah, p.batal, p.alasanBatal])).toEqual([
        ["UJI-B-02", 1_000_000, true, "dobel input"],
        ["UJI-B-01", 4_000_000, false, null],
      ]);
      expect(r!.kesiapan.selesaiWib).toBe("2026-11-13 09:00");

      // Faktur batal: dipulangkan tanpa status, beserta alasannya.
      const batal = await getTagihanFaktur(UA, "UJI-F-04", HARI_INI);
      expect(batal).toMatchObject({ status: null, alasanBatal: "salah input" });
      expect(batal!.faktur.batal).toBe(true);

      expect(await getTagihanFaktur(UA, "UJI-F-TAKADA", HARI_INI)).toBeNull();
      // Kode yang sama ada di unit B — isinya milik unit B, bukan unit A.
      expect((await getTagihanFaktur(UB, "UJI-F-01", HARI_INI))!.faktur.nilai).toBe(999_000);
      // Faktur yang hanya ada di unit A tak terlihat dari unit B, dan unit tanpa siklus tak punya rincian.
      expect(await getTagihanFaktur(UB, "UJI-F-03", HARI_INI)).toBeNull();
      expect(await getTagihanFaktur(UC, "UJI-F-01", HARI_INI)).toBeNull();
    });
  });

  it("🔴 belum ditagihkan: AE10, tautan faktur batal tak menyembunyikan, kelas tunai tak pernah ikut", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(async (c) => {
      const hasil = await getBelumDitagihkan(UA, { hariIni: HARI_INI });
      if (!hasil.tersedia) throw new Error("tak tersedia");
      expect(hasil.kelompok.map((k) => [k.customerCode, k.jumlahDokumen, k.total, k.tanggalTertua])).toEqual([
        [P1, 2, 1_000_000, "2026-11-02"],
        [P2, 1, 150_000, "2026-11-10"],
      ]);
      expect(hasil.saldoPerTanggal).toBe("2026-11-12");
      // R20: sisa faktur hidup 6.000.000 + 250.000, belum ditagihkan 1.000.000, saldo 7.500.000.
      expect(hasil.kelompok[0]!.cocokSaldo).toEqual({
        sisaFaktur: 6_250_000, belumDitagihkan: 1_000_000, jumlah: 7_250_000,
        kelompokSaldo: "lokal", saldoPiutang: 7_500_000, saldoPerTanggal: "2026-11-12", selisih: -250_000,
      });
      // Online: lebih bayar ikut sebagai negatif.
      expect(hasil.kelompok[1]!.cocokSaldo).toEqual({
        sisaFaktur: -50_000, belumDitagihkan: 150_000, jumlah: 100_000,
        kelompokSaldo: "online", saldoPiutang: 100_000, saldoPerTanggal: "2026-11-12", selisih: 0,
      });

      const dok = await getDokumenBelumDitagihkan(UA, " UJI/01 ");
      expect(dok.terpotong).toBe(false);
      expect(dok.dokumen.map((x) => [x.kodeDokumen, x.tanggal, x.jumlah])).toEqual([
        ["JP-UJI-BTL", "2026-11-02", 700_000],
        ["JP-UJI-NEW", "2026-11-12", 300_000],
      ]);
      const semua = await getDokumenBelumDitagihkan(UA);
      expect(semua.dokumen.map((x) => x.kodeDokumen)).toEqual(["JP-UJI-BTL", "UV-UJI-01", "JP-UJI-NEW"]);
      expect(semua.dokumen.some((x) => x.customerCode === PTUNAI)).toBe(false);

      // AE10: begitu faktur HIDUP memuat dokumennya, ia keluar dari kelompok.
      await scope(c, String(UA));
      await c.query(
        `INSERT INTO public.tagihan_detail (unit_id, ckdtagih, ckdjualplg) VALUES ($1, 'UJI-F-01', 'JP-UJI-NEW')`,
        [UA],
      );
      const sesudah = await getDokumenBelumDitagihkan(UA, P1);
      expect(sesudah.dokumen.map((x) => x.kodeDokumen)).toEqual(["JP-UJI-BTL"]);
    });
  });

  it("tab pelanggan: kode berpengisi spasi / bergaris miring / bertitik; pembayaran lintas faktur", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(async () => {
      const p = await getTagihanPelanggan(UA, "  UJI/01 ", HARI_INI);
      if (!p.tersedia) throw new Error("tak tersedia");
      expect(p.customerCode).toBe(P1);
      // Seluruh faktur HIDUP (lunas ikut, batal tidak).
      expect(p.faktur.map((b) => b.faktur.kode).sort()).toEqual(["UJI-F-01", "UJI-F-02", "UJI-F-05", "UJI-F-06"]);
      expect(p.pembayaran.map((x) => x.kode)).toEqual(["UJI-B-03", "UJI-B-02", "UJI-B-01", "UJI-B-05"]);
      expect(p.belumDitagihkan).toEqual({ jumlahDokumen: 2, total: 1_000_000, tanggalTertua: "2026-11-02" });
      expect(p.cocokSaldo).toMatchObject({ sisaFaktur: 6_250_000, jumlah: 7_250_000, saldoPiutang: 7_500_000, selisih: -250_000 });

      const online = await getTagihanPelanggan(UA, P2, HARI_INI);
      if (!online.tersedia) throw new Error("tak tersedia");
      expect(online.faktur.map((b) => b.faktur.kode)).toEqual(["UJI-F-03"]);
      expect(online.cocokSaldo).toMatchObject({ kelompokSaldo: "online", saldoPiutang: 100_000, selisih: 0 });

      // Unit B tak punya snapshot terbit: "belum tersedia", bukan selisih.
      const b = await getTagihanPelanggan(UB, P1, HARI_INI);
      if (!b.tersedia) throw new Error("tak tersedia");
      expect(b.cocokSaldo).toMatchObject({ sisaFaktur: 999_000, belumDitagihkan: 111_000, saldoPiutang: null, saldoPerTanggal: null, selisih: null });
    });
  });

  it("pointer Saldo pelanggan: yang TERBARU, hanya generasi terbit", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(async () => {
      expect(await getSaldoTerbitTerakhir(UA)).toEqual({
        asOfDate: "2026-11-12", generationId: GEN_BARU, sedangDiperbarui: false,
      });
      expect(await getSaldoTerbitTerakhir(UB)).toBeNull();
    });
  });

  it("ringkasan lintas unit: satu baris per unit yang diserahkan; tanpa siklus = belum tersedia", async (ctx) => {
    if (!applied) return ctx.skip();
    await tx(async () => {
      const r = await getRingkasanTagihanLintasUnit([UA, UB, UC], HARI_INI);
      expect(r.terpotong).toBe(false);
      expect(r.unit.map((u) => [u.unitId, u.tersedia])).toEqual([[UA, true], [UB, true], [UC, false]]);
      const a = r.unit[0]!;
      const b = r.unit[1]!;
      if (!a.tersedia || !b.tersedia) throw new Error("tak tersedia");
      expect(a.ubin).toEqual({
        lewatJatuhTempo: { jumlah: 1, sisa: 6_000_000 },
        belumJatuhTempo: { jumlah: 0, sisa: 0 },
        terminBelumDiatur: { jumlah: 1, sisa: 250_000 },
        belumDitagihkan: { jumlahDokumen: 3, jumlahPelanggan: 2, total: 1_150_000 },
      });
      expect(a.pembayaranTerakhir).toBe("2026-11-06");
      // Unit B tanpa termin: fakturnya "termin belum diatur", bukan lewat jatuh tempo.
      expect(b.ubin).toEqual({
        lewatJatuhTempo: { jumlah: 0, sisa: 0 },
        belumJatuhTempo: { jumlah: 0, sisa: 0 },
        terminBelumDiatur: { jumlah: 1, sisa: 999_000 },
        belumDitagihkan: { jumlahDokumen: 1, jumlahPelanggan: 1, total: 111_000 },
      });
      expect(b.pembayaranTerakhir).toBeNull();

      // Hanya unit A yang diserahkan: unit B tak mungkin ikut.
      const hanyaA = await getRingkasanTagihanLintasUnit([UA], HARI_INI);
      expect(hanyaA.unit.map((u) => u.unitId)).toEqual([UA]);
      expect(await getRingkasanTagihanLintasUnit([], HARI_INI)).toEqual({ unit: [], terpotong: false });
    });
  });

  it("🔴 RLS: scope dari qScoped membatasi baris — unit lain dan tanpa scope = nol baris", async (ctx) => {
    if (!applied) return ctx.skip();
    expect(melewatiRls, "role uji superuser/BYPASSRLS — uji isolasi tak bermakna").toBe(false);
    await tx(async (c) => {
      // Daftar unit B hanya memuat faktur unit B, walau kode fakturnya kembar dengan unit A.
      const b = await getTagihanDaftar(UB, { filter: "perlu_tindakan", periodeLunas: PERIODE, hariIni: HARI_INI });
      if (!b.tersedia) throw new Error("tak tersedia");
      expect(b.halaman.rows.map((x) => [x.faktur.kode, x.status.nilai])).toEqual([["UJI-F-01", 999_000]]);

      // Kontrol: SELECT tanpa WHERE unit — yang membatasi murni RLS.
      const hitung = async (tabel: string) =>
        Number((await c.query<{ n: string }>(`SELECT count(*) AS n FROM ${tabel}`)).rows[0]!.n);
      const hitungSemua = async () => [
        await hitung("public.tagihan_header"), await hitung("public.tagihan_detail"),
        await hitung("public.tagihan_bayar"), await hitung("public.tagihan_cycle"),
      ];
      await scope(c, String(UB));
      expect(await hitungSemua()).toEqual([1, 0, 0, 1]);
      await scope(c, String(UA));
      expect(await hitungSemua()).toEqual([6, 4, 5, 1]);
      await scope(c, "");
      expect(await hitungSemua()).toEqual([0, 0, 0, 0]);

      // Scope yang SALAH melebarkan RLS (batas yang diketahui): kueri tetap aman karena unit_id di WHERE.
      h.panggilan.length = 0;
      await getTagihanFaktur(UB, "UJI-F-03", HARI_INI);
      await scope(c, SEMUA);
      const kepala = h.panggilan.find((p) => /tagihan_cycle c ON/.test(p.sql))!;
      expect((await c.query(kepala.sql, kepala.params)).rows).toEqual([]);
    });
  });
});
