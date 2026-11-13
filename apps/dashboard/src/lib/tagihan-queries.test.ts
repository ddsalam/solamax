import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope";

/**
 * Kueri tagihan (rencana 2026-11-13 U6) dengan `qScoped` TIRUAN: bentuk hasil,
 * kasus tepi, dan bahwa setiap kueri ter-scope unit tanpa nilai yang
 * disisipkan ke SQL. SQL-nya sendiri DIJALANKAN di
 * `tagihan-queries.integration.test.ts` — uji tiruan tak membuktikan SQL sah.
 * Semua nilai ilustratif.
 */
type Jenis =
  | "kesiapan" | "faktur" | "termin" | "terminBanyak" | "kelompok" | "dokumenBelum"
  | "saldo" | "pointer" | "rinci" | "tautan" | "buku" | "bayar";

const h = vi.hoisted(() => {
  const panggilan: { jenis: string; unit: unknown; sql: string; params: unknown[] }[] = [];
  const jawab: Record<string, unknown[] | ((params: unknown[]) => unknown[])> = {};
  const kenali = (sql: string): string => {
    if (/WITH terbit AS/.test(sql)) return "saldo";
    if (/"generationId"/.test(sql)) return "pointer";
    if (/JOIN public\.tagihan_cycle c ON/.test(sql)) return "rinci";
    if (/FROM public\.tagihan_cycle c\s+WHERE/.test(sql)) return "kesiapan";
    if (/FROM public\.tagihan_header h\s+LEFT JOIN/.test(sql)) return "faktur";
    if (/"jumlahDokumen"/.test(sql)) return "kelompok";
    if (/HAVING NOT bool_or/.test(sql)) return "dokumenBelum";
    if (/FROM public\.tagihan_detail d\s+WHERE/.test(sql)) return "tautan";
    if (/ANY\(\$2::text\[\]\)/.test(sql)) return "buku";
    if (/FROM public\.tagihan_bayar p\s+JOIN/.test(sql)) return "bayar";
    if (/FROM app\.termin_unit/.test(sql)) return /AS "unitId"/.test(sql) ? "terminBanyak" : "termin";
    throw new Error(`kueri tak dikenal: ${sql.slice(0, 80)}`);
  };
  const qScoped = vi.fn(async (unit: unknown, sql: string, params: unknown[] = []) => {
    const jenis = kenali(sql);
    panggilan.push({ jenis, unit, sql, params });
    const j = jawab[jenis];
    return typeof j === "function" ? j(params) : (j ?? []);
  });
  return { panggilan, jawab, qScoped };
});
vi.mock("./db", () => ({ qScoped: h.qScoped }));

const q = await import("./tagihan-queries");

const U = 8801 as ScopedUnitId;
const V = 8802 as ScopedUnitId;
const W = 8803 as ScopedUnitId;
const HARI_INI = "2026-11-13";
const PERIODE = { from: "2026-10-01", to: "2026-11-30" };

const SIAP = (unitId: number) => ({
  unitId, selesaiAt: "2026-11-13T02:00:00Z", selesaiWib: "2026-11-13 09:00",
  jumlahFaktur: 4, jumlahPembayaran: 3, pembayaranTerakhir: "2026-11-06",
});

interface FakturUji {
  unitId?: number; kode: string; customerCode?: string; namaPelanggan?: string | null;
  tanggalFaktur?: string | null; jatuhTempoEasymax?: string | null; nilai: number; dibayar?: number;
  statusEasymax?: number | null; sisaEasymax?: number | null; tanggalBayarTerakhir?: string | null;
}
const faktur = (f: FakturUji) => ({
  unitId: f.unitId ?? U, kode: f.kode, customerCode: f.customerCode ?? "UJI/01",
  namaPelanggan: f.namaPelanggan === undefined ? "PT Contoh Ilustrasi" : f.namaPelanggan,
  tanggalFaktur: f.tanggalFaktur === undefined ? "2026-10-01" : f.tanggalFaktur,
  jatuhTempoEasymax: f.jatuhTempoEasymax ?? null, nilai: f.nilai, dibayar: f.dibayar ?? 0,
  statusEasymax: f.statusEasymax ?? null, sisaEasymax: f.sisaEasymax ?? null,
  jumlahPembayaran: (f.dibayar ?? 0) > 0 ? 1 : 0, jumlahPembayaranBatal: 0,
  tanggalBayarTerakhir: f.tanggalBayarTerakhir ?? null, keterangan: null,
});

const jenis = () => h.panggilan.map((p) => p.jenis);
const panggilan = (j: Jenis) => h.panggilan.filter((p) => p.jenis === j);

beforeEach(() => {
  h.panggilan.length = 0;
  h.qScoped.mockClear();
  for (const k of Object.keys(h.jawab)) delete h.jawab[k];
});

describe("kesiapan (KTD11)", () => {
  it("tanpa baris tagihan_cycle = belum tersedia; dibaca dari tagihan_cycle, bukan sync_state", async () => {
    expect(await q.getTagihanKesiapan(U)).toEqual({ tersedia: false });
    expect(panggilan("kesiapan")[0]!.sql).toMatch(/FROM public\.tagihan_cycle/);
    expect(panggilan("kesiapan")[0]!.sql).not.toMatch(/sync_state/);

    h.jawab.kesiapan = [SIAP(U)];
    expect(await q.getTagihanKesiapan(U)).toEqual({
      tersedia: true, selesaiAt: "2026-11-13T02:00:00Z", selesaiWib: "2026-11-13 09:00",
      jumlahFaktur: 4, jumlahPembayaran: 3, pembayaranTerakhir: "2026-11-06",
    });
  });

  it("🔴 unit tanpa siklus lengkap: SEMUA pembaca memulangkan belum-tersedia, bukan nol — dan tak menarik data", async () => {
    h.jawab.faktur = [faktur({ kode: "UJI-F-01", nilai: 1_000_000 })];
    expect(await q.getTagihanDaftar(U, { filter: "perlu_tindakan", periodeLunas: PERIODE })).toEqual({ tersedia: false });
    expect(await q.getTagihanEkspor(U, { filter: "lunas", periodeLunas: PERIODE })).toEqual({ tersedia: false });
    expect(await q.getTagihanRingkasanUnit(U)).toEqual({ tersedia: false });
    expect(await q.getTagihanPelanggan(U, "UJI/01")).toEqual({ tersedia: false });
    expect(await q.getBelumDitagihkan(U)).toEqual({ tersedia: false });
    expect(jenis()).not.toContain("faktur");
    expect(jenis()).not.toContain("kelompok");
  });
});

describe("daftar unit (S1)", () => {
  beforeEach(() => {
    h.jawab.kesiapan = [SIAP(U)];
    h.jawab.termin = [{ kodePelanggan: null, terminHari: 30 }, { kodePelanggan: "UJI.02", terminHari: 7 }];
    h.jawab.faktur = [
      // Sebagian, lewat 13 hari (termin unit 30 → 31 Okt).
      faktur({ kode: "UJI-F-01", nilai: 10_000_000, dibayar: 4_000_000, statusEasymax: 0, sisaEasymax: 6_000_000 }),
      // Lebih bayar.
      faktur({ kode: "UJI-F-02", nilai: 2_000_000, dibayar: 2_050_000, customerCode: "UJI.02", namaPelanggan: "Pelanggan Online Contoh" }),
      // Belum jatuh tempo: termin pelanggan 7 hari menang → 17 Nov.
      faktur({ kode: "UJI-F-03", nilai: 500_000, tanggalFaktur: "2026-11-10", customerCode: "UJI.02", namaPelanggan: "Pelanggan Online Contoh" }),
      // Jatuh tempo EasyMax sah (14 hari) dipakai walau ada termin.
      faktur({ kode: "UJI-F-04", nilai: 750_000, tanggalFaktur: "2026-10-20", jatuhTempoEasymax: "2026-11-03" }),
      // Lolos saringan SQL (0,4 ≠ 0) tetapi LUNAS menurut model sesudah pembulatan rupiah.
      faktur({ kode: "UJI-F-05", nilai: 1_000_000.4, dibayar: 1_000_000, tanggalBayarTerakhir: "2026-11-05" }),
    ];
    h.jawab.kelompok = [
      { unitId: U, customerCode: "UJI/01", namaPelanggan: "PT Contoh Ilustrasi", jumlahDokumen: 2, total: 1_000_000.2, tanggalTertua: "2026-11-02" },
      { unitId: U, customerCode: "UJI.02", namaPelanggan: "Pelanggan Online Contoh", jumlahDokumen: 1, total: 150_000, tanggalTertua: "2026-11-10" },
    ];
  });

  it("1 kueri kesiapan + 3 kueri data, tanpa N+1; semuanya ter-scope unit", async () => {
    await q.getTagihanDaftar(U, { filter: "perlu_tindakan", periodeLunas: PERIODE, hariIni: HARI_INI });
    expect(jenis().sort()).toEqual(["faktur", "kelompok", "kesiapan", "termin"]);
    for (const p of h.panggilan) {
      expect(p.jenis === "termin" ? p.unit : (p.unit as number[])[0] ?? p.unit).toBe(U);
      expect(p.sql).toMatch(/unit_id = (ANY\(\$1::int\[\]\)|\$1)/);
    }
  });

  it("status dari model; urutan hari lewat menurun; lunas tak ikut `perlu_tindakan`", async () => {
    const r = await q.getTagihanDaftar(U, { filter: "perlu_tindakan", periodeLunas: PERIODE, hariIni: HARI_INI });
    if (!r.tersedia) throw new Error("tak tersedia");
    expect(r.halaman.rows.map((b) => b.faktur.kode)).toEqual(["UJI-F-01", "UJI-F-04", "UJI-F-02", "UJI-F-03"]);
    const [f1, f4, f2, f3] = r.halaman.rows;
    expect(f1!.status).toMatchObject({ statusBayar: "sebagian", sisa: 6_000_000, hariLewat: 13, sumber: "termin_unit", bedaStatus: false, bedaSisa: false });
    expect(f4!.status).toMatchObject({ statusBayar: "belum_dibayar", hariLewat: 10, sumber: "easymax", jatuhTempo: "2026-11-03" });
    expect(f2!.status).toMatchObject({ statusBayar: "lebih_bayar", sisa: -50_000, statusJatuhTempo: null });
    expect(f3!.status).toMatchObject({ statusJatuhTempo: "belum_jatuh_tempo", sumber: "termin_pelanggan", hariMenujuJatuhTempo: 4 });
    expect(r.halaman).toMatchObject({ page: 1, totalPages: 1, resultCount: 4, pageSize: 50 });
    expect(r.filter).toBe("perlu_tindakan");
    expect(r.periodeLunas).toBeNull();
  });

  it("empat ubin atas SEMUA faktur belum lunas, tak bergantung saringan & pencarian", async () => {
    const ubin = {
      lewatJatuhTempo: { jumlah: 2, sisa: 6_750_000 },
      belumJatuhTempo: { jumlah: 1, sisa: 500_000 },
      terminBelumDiatur: { jumlah: 0, sisa: 0 },
      belumDitagihkan: { jumlahDokumen: 3, jumlahPelanggan: 2, total: 1_150_000 },
    };
    for (const filter of ["perlu_tindakan", "lewat_jatuh_tempo", "sebagian", "lebih_bayar", "lunas"] as const) {
      const r = await q.getTagihanDaftar(U, { filter, cari: "online", periodeLunas: PERIODE, hariIni: HARI_INI });
      if (!r.tersedia) throw new Error("tak tersedia");
      expect(r.ubin, filter).toEqual(ubin);
      expect(r.fakturBergantungTermin, filter).toBe(2);
    }
    const ringkas = await q.getTagihanRingkasanUnit(U, HARI_INI);
    expect(ringkas).toMatchObject({ tersedia: true, ubin, fakturBergantungTermin: 2, terpotong: false });
  });

  it("saringan & pencarian (nama ATAU kode, tak peka huruf besar) diterapkan sebelum halaman", async () => {
    const lewat = await q.getTagihanEkspor(U, { filter: "lewat_jatuh_tempo", periodeLunas: PERIODE, hariIni: HARI_INI });
    if (!lewat.tersedia) throw new Error("tak tersedia");
    expect(lewat.baris.map((b) => b.faktur.kode)).toEqual(["UJI-F-01", "UJI-F-04"]);

    const nama = await q.getTagihanEkspor(U, { filter: "perlu_tindakan", cari: "  ONLINE ", periodeLunas: PERIODE, hariIni: HARI_INI });
    if (!nama.tersedia) throw new Error("tak tersedia");
    expect(nama.cari).toBe("ONLINE");
    expect(nama.baris.map((b) => b.faktur.kode)).toEqual(["UJI-F-02", "UJI-F-03"]);

    const kode = await q.getTagihanEkspor(U, { filter: "perlu_tindakan", cari: "uji/0", periodeLunas: PERIODE, hariIni: HARI_INI });
    if (!kode.tersedia) throw new Error("tak tersedia");
    expect(kode.baris.map((b) => b.faktur.kode)).toEqual(["UJI-F-01", "UJI-F-04"]);
  });

  it("🔴 periode lunas hanya dikirim untuk saringan `lunas`; faktur terbuka tak pernah dibatasi tanggal", async () => {
    await q.getTagihanDaftar(U, { filter: "perlu_tindakan", periodeLunas: PERIODE, hariIni: HARI_INI });
    expect(panggilan("faktur")[0]!.params.slice(1, 5)).toEqual([null, null, null, false]);

    const lunas = await q.getTagihanDaftar(U, { filter: "lunas", periodeLunas: PERIODE, hariIni: HARI_INI });
    expect(panggilan("faktur")[1]!.params.slice(1, 5)).toEqual(["2026-10-01", "2026-11-30", null, false]);
    if (!lunas.tersedia) throw new Error("tak tersedia");
    expect(lunas.halaman.rows.map((b) => b.faktur.kode)).toEqual(["UJI-F-05"]);
    expect(lunas.periodeLunas).toEqual(PERIODE);

    const sql = panggilan("faktur")[0]!.sql;
    // Periode diukur pada tanggal PELUNASAN (pembayaran hidup terakhir), cadangan tanggal faktur.
    expect(sql).toMatch(/COALESCE\(bay\.terakhir, h\.dtgl\) BETWEEN \$2::date AND \$3::date/);
    // Faktur batal tak ditarik; pembayaran batal tak dijumlahkan.
    expect(sql).toMatch(/COALESCE\(h\.sbatal, 0\) = 0/);
    expect(sql).toMatch(/sum\(ntotal\) FILTER \(WHERE COALESCE\(sbatal, 0\) = 0\) AS dibayar/);
    // Satu-satunya predikat tanggal ada di cabang periode lunas.
    expect(sql).not.toMatch(/h\.dtgl(jt)?\s*(>=|<=|<|>|=|BETWEEN)/);
    expect(sql.match(/BETWEEN/g)).toHaveLength(1);
  });

  it("halaman dijepit model; batas baris dilampaui = `terpotong`, bukan dipotong diam-diam", async () => {
    h.jawab.faktur = Array.from({ length: 120 }, (_, i) =>
      faktur({ kode: `UJI-F-${String(i).padStart(3, "0")}`, nilai: 100_000 + i }));
    const r = await q.getTagihanDaftar(U, { filter: "perlu_tindakan", halaman: "99", periodeLunas: PERIODE, hariIni: HARI_INI });
    if (!r.tersedia) throw new Error("tak tersedia");
    expect(r.halaman).toMatchObject({ page: 3, totalPages: 3, resultCount: 120 });
    expect(r.halaman.rows).toHaveLength(20);
    expect(r.terpotong).toBe(false);
    expect(panggilan("faktur")[0]!.params[5]).toBe(q.BATAS_BARIS_TAGIHAN + 1);

    h.jawab.faktur = Array.from({ length: q.BATAS_BARIS_TAGIHAN + 1 }, (_, i) => faktur({ kode: `F${i}`, nilai: 1000 }));
    const banyak = await q.getTagihanEkspor(U, { filter: "perlu_tindakan", periodeLunas: PERIODE, hariIni: HARI_INI });
    if (!banyak.tersedia) throw new Error("tak tersedia");
    expect(banyak.terpotong).toBe(true);
    expect(banyak.baris).toHaveLength(q.BATAS_BARIS_TAGIHAN);
  });

  it("tanggal faktur kosong di sumber: tidak melempar, tak pernah lewat jatuh tempo, tanpa penanda palsu", async () => {
    h.jawab.faktur = [faktur({ kode: "UJI-F-09", nilai: 250_000, tanggalFaktur: null, jatuhTempoEasymax: "2026-01-01" })];
    const r = await q.getTagihanEkspor(U, { filter: "perlu_tindakan", periodeLunas: PERIODE, hariIni: HARI_INI });
    if (!r.tersedia) throw new Error("tak tersedia");
    expect(r.baris[0]).toMatchObject({ tanggalFakturKosong: true });
    expect(r.baris[0]!.faktur).toMatchObject({ tanggalFaktur: "", jatuhTempoEasymax: "2026-01-01" });
    expect(r.baris[0]!.status).toMatchObject({ statusJatuhTempo: "termin_belum_diatur", hariLewat: 0, jtEasymaxTakWajar: false });
  });
});

describe("belum ditagihkan (R19, KTD8) + cocok-silang R20", () => {
  beforeEach(() => {
    h.jawab.kesiapan = [SIAP(U)];
    h.jawab.faktur = [
      faktur({ kode: "UJI-F-01", nilai: 10_000_000, dibayar: 4_000_000 }),
      faktur({ kode: "UJI-F-02", nilai: 2_000_000, dibayar: 2_050_000, customerCode: "UJI.02" }),
    ];
    h.jawab.kelompok = [
      { unitId: U, customerCode: "UJI/01", namaPelanggan: "PT Contoh Ilustrasi", jumlahDokumen: 2, total: 1_000_000, tanggalTertua: "2026-11-02" },
      { unitId: U, customerCode: "UJI.02", namaPelanggan: "Pelanggan Online Contoh", jumlahDokumen: 1, total: 150_000, tanggalTertua: "2026-11-10" },
      { unitId: U, customerCode: "UJI05", namaPelanggan: null, jumlahDokumen: 1, total: 90_000, tanggalTertua: "2026-11-11" },
    ];
  });

  it("🔴 bentuk SQL: populasi snapshot, hanya tautan faktur HIDUP, tanpa lantai tanggal (AE10)", async () => {
    await q.getBelumDitagihkan(U, { hariIni: HARI_INI });
    const sql = panggilan("kelompok")[0]!.sql;
    // Posting debet hidup, rujukan JP/UV.
    expect(sql).toMatch(/COALESCE\(b\.sbatal, 0\) = 0/);
    expect(sql).toMatch(/b\.sjnsbp = 1/);
    expect(sql).toMatch(/trim\(b\.vcref\) LIKE 'JP%' OR trim\(b\.vcref\) LIKE 'UV%'/);
    // Populasi = snapshot Saldo pelanggan: kode bertitik ATAU master kelas 1/5 — kelas tunai (4) tak pernah masuk.
    expect(sql).toMatch(/position\('\.' in btrim\(b\.ckdplg\)\) > 0\s+OR EXISTS/);
    expect(sql).toMatch(/lk\.sjenis IN \(1, 5\)/);
    expect(sql).not.toMatch(/sjenis\s*(=|<>|!=)\s*4/);
    // Tautan dibaca lewat header HIDUP: tautan faktur batal tak menyembunyikan penjualan,
    // dan dokumen keluar dari kelompok begitu faktur hidup memuatnya (AE10).
    expect(sql).toMatch(/JOIN public\.tagihan_header fh\s+ON fh\.unit_id = d\.unit_id AND fh\.ckdtagih = d\.ckdtagih/);
    expect(sql).toMatch(/COALESCE\(fh\.sbatal, 0\) = 0/);
    expect(sql).toMatch(/HAVING NOT bool_or\(z\.tertaut\)/);
    // Tanpa lantai tanggal: tak ada predikat atas b.dtgl.
    expect(sql).not.toMatch(/b\.dtgl\s*(>=|>|<|<=|BETWEEN)/);
    // Rujukan buku selalu dalam bentuk ber-trim (konvensi index 0063).
    expect(sql).not.toMatch(/[^(]b\.vcref\s*=/);
  });

  it("kelompok per pelanggan + R20: Σ sisa SEMUA faktur hidup (negatif ikut) + belum ditagihkan vs saldo terbit", async () => {
    h.jawab.saldo = [
      { asOfDate: "2026-11-12", sedangDiperbarui: false, kode: "UJI/01", lokal: 7_500_000, online: 0 },
      { asOfDate: "2026-11-12", sedangDiperbarui: false, kode: "UJI.02", lokal: 999, online: 100_000 },
    ];
    const r = await q.getBelumDitagihkan(U, { hariIni: HARI_INI });
    if (!r.tersedia) throw new Error("tak tersedia");
    expect(r.saldoPerTanggal).toBe("2026-11-12");
    expect(r.kelompok.map((k) => [k.customerCode, k.jumlahDokumen, k.total, k.tanggalTertua])).toEqual([
      ["UJI/01", 2, 1_000_000, "2026-11-02"], ["UJI.02", 1, 150_000, "2026-11-10"], ["UJI05", 1, 90_000, "2026-11-11"],
    ]);
    expect(r.kelompok[0]!.cocokSaldo).toEqual({
      sisaFaktur: 6_000_000, belumDitagihkan: 1_000_000, jumlah: 7_000_000,
      kelompokSaldo: "lokal", saldoPiutang: 7_500_000, saldoPerTanggal: "2026-11-12", selisih: -500_000,
    });
    // Kode bertitik dibandingkan dengan saldo ONLINE, bukan lokal.
    expect(r.kelompok[1]!.cocokSaldo).toEqual({
      sisaFaktur: -50_000, belumDitagihkan: 150_000, jumlah: 100_000,
      kelompokSaldo: "online", saldoPiutang: 100_000, saldoPerTanggal: "2026-11-12", selisih: 0,
    });
    // Tanpa faktur dan tanpa baris snapshot: sisa 0, saldo 0.
    expect(r.kelompok[2]!.cocokSaldo).toMatchObject({ sisaFaktur: 0, jumlah: 90_000, saldoPiutang: 0, selisih: 90_000 });
    expect(r.ubin.belumDitagihkan).toEqual({ jumlahDokumen: 4, jumlahPelanggan: 3, total: 1_240_000 });

    const cari = await q.getBelumDitagihkan(U, { cari: "contoh il", hariIni: HARI_INI });
    if (!cari.tersedia) throw new Error("tak tersedia");
    expect(cari.kelompok.map((k) => k.customerCode)).toEqual(["UJI/01"]);
    expect(cari.ubin).toEqual(r.ubin);
  });

  it("🔴 belum ada snapshot terbit: 'belum tersedia' — saldo & selisih null, bukan nol", async () => {
    const r = await q.getBelumDitagihkan(U, { hariIni: HARI_INI });
    if (!r.tersedia) throw new Error("tak tersedia");
    expect(r.saldoPerTanggal).toBeNull();
    expect(r.kelompok[0]!.cocokSaldo).toEqual({
      sisaFaktur: 6_000_000, belumDitagihkan: 1_000_000, jumlah: 7_000_000,
      kelompokSaldo: "lokal", saldoPiutang: null, saldoPerTanggal: null, selisih: null,
    });
  });

  it("pembaca pointer: generasi terbit & tervalidasi berformula v2, tanggal TERBESAR", async () => {
    expect(await q.getSaldoTerbitTerakhir(U)).toBeNull();
    const sql = panggilan("pointer")[0]!.sql;
    expect(sql).toMatch(/FROM app\.saldo_pelanggan_snapshot_pointer p/);
    expect(sql).toMatch(/m\.status = 'complete'\s+AND m\.published\s+AND m\.validation_passed\s+AND m\.formula_version = 'saldo-pelanggan-v2'/);
    expect(sql).toMatch(/ORDER BY p\.as_of_date DESC\s+LIMIT 1/);
    h.jawab.pointer = [{ asOfDate: "2026-11-12", generationId: "g", sedangDiperbarui: true }];
    expect(await q.getSaldoTerbitTerakhir(U)).toEqual({ asOfDate: "2026-11-12", generationId: "g", sedangDiperbarui: true });
  });

  it("dokumen satu pelanggan: kode dipangkas, dikirim sebagai parameter; batas baris ditandai", async () => {
    h.jawab.dokumenBelum = [
      { customerCode: "UJI/01", namaPelanggan: "PT Contoh Ilustrasi", kodeDokumen: "JP-UJI-NEW", tanggal: "2026-11-12", jumlah: 300_000, keterangan: "Penjualan" },
    ];
    const r = await q.getDokumenBelumDitagihkan(U, "  UJI/01 ");
    expect(r).toEqual({
      dokumen: [{ customerCode: "UJI/01", namaPelanggan: "PT Contoh Ilustrasi", kodeDokumen: "JP-UJI-NEW", tanggal: "2026-11-12", jumlah: 300_000, keterangan: "Penjualan" }],
      terpotong: false,
    });
    const p = panggilan("dokumenBelum")[0]!;
    expect(p.params).toEqual([[U], "UJI/01", q.BATAS_BARIS_TAGIHAN + 1]);
    expect(p.sql).not.toContain("UJI/01");
    await q.getDokumenBelumDitagihkan(U);
    expect(panggilan("dokumenBelum")[1]!.params[1]).toBeNull();
  });
});

describe("rincian faktur (S2, R17)", () => {
  const kepala = (lain: Record<string, unknown> = {}) => ({
    ...SIAP(U), kode: "UJI-F-01", customerCode: "UJI/01", namaPelanggan: "PT Contoh Ilustrasi",
    tanggalFaktur: "2026-10-01", jatuhTempoEasymax: "2026-10-01", nilai: 10_000_000,
    statusEasymax: 1, sisaEasymax: 6_000_000, batal: false, alasanBatal: null, keterangan: null,
    jenisTagihan: 1, nilaiPokok: 10_000_000, biayaAdmin: 0, ...lain,
  });
  const bayar = (kode: string, jumlah: number, batal: boolean, alasanBatal: string | null = null) => ({
    kode, kodeFaktur: "UJI-F-01", tanggal: "2026-10-10", bukti: "BKT", keterangan: null, tempatKas: null,
    jumlah, batal, alasanBatal, fakturBatal: false,
  });

  it("kode tak dikenal / faktur unit lain / unit tanpa siklus = null", async () => {
    expect(await q.getTagihanFaktur(U, "UJI-F-TAKADA", HARI_INI)).toBeNull();
    expect(await q.getTagihanFaktur(U, "   ", HARI_INI)).toBeNull();
    const p = panggilan("rinci")[0]!;
    expect(p.unit).toBe(U);
    expect(p.params).toEqual([U, "UJI-F-TAKADA"]);
    // Unit + kode di WHERE, dan wajib punya siklus lengkap.
    expect(p.sql).toMatch(/h\.unit_id = \$1::smallint\s+AND h\.ckdtagih = \$2::bpchar/);
    expect(p.sql).toMatch(/JOIN public\.tagihan_cycle c ON c\.unit_id = h\.unit_id/);
    expect(p.sql).not.toContain("UJI-F-TAKADA");
  });

  it("🔴 pembayaran batal ditampilkan beserta alasannya, tetapi tak dihitung (AE4); penanda beda status menyala", async () => {
    h.jawab.rinci = [kepala()];
    h.jawab.termin = [{ kodePelanggan: null, terminHari: 30 }];
    h.jawab.bayar = [bayar("UJI-B-02", 6_000_000, true, "dobel input"), bayar("UJI-B-01", 4_000_000, false)];
    h.jawab.tautan = [{ kodeDokumen: "JP-UJI-HILANG" }, { kodeDokumen: "JP-UJI-002" }, { kodeDokumen: "JP-UJI-001" }];
    h.jawab.buku = [
      { kodeDokumen: "JP-UJI-002", tanggal: "2026-09-25", jumlah: 4_000_000 },
      { kodeDokumen: "JP-UJI-001", tanggal: "2026-09-20", jumlah: 6_000_000 },
    ];
    const r = await q.getTagihanFaktur(U, " UJI-F-01 ", HARI_INI);
    expect(r!.status).toMatchObject({
      dibayar: 4_000_000, sisa: 6_000_000, statusBayar: "sebagian", hariLewat: 13,
      bedaStatus: true, bedaSisa: false,
    });
    expect(r!.pembayaran.map((p) => [p.kode, p.batal, p.alasanBatal])).toEqual([
      ["UJI-B-02", true, "dobel input"], ["UJI-B-01", false, null],
    ]);
    // Dokumen yang tak ada di buku tetap tampil, jumlah null, di akhir.
    expect(r!.dokumen).toEqual([
      { kodeDokumen: "JP-UJI-001", tanggal: "2026-09-20", jumlah: 6_000_000 },
      { kodeDokumen: "JP-UJI-002", tanggal: "2026-09-25", jumlah: 4_000_000 },
      { kodeDokumen: "JP-UJI-HILANG", tanggal: null, jumlah: null },
    ]);
    expect(r).toMatchObject({ totalDokumen: 10_000_000, dokumenTanpaBuku: 1, namaPelanggan: "PT Contoh Ilustrasi" });
    expect(r!.kesiapan).toMatchObject({ tersedia: true, selesaiWib: "2026-11-13 09:00" });
    // Lima kueri, berapa pun banyaknya dokumen; buku dicocokkan lewat trim(vcref) = ANY(larik).
    expect(jenis().sort()).toEqual(["bayar", "buku", "rinci", "tautan", "termin"]);
    expect(panggilan("buku")[0]!.params).toEqual([U, ["JP-UJI-HILANG", "JP-UJI-002", "JP-UJI-001"]]);
    expect(panggilan("buku")[0]!.sql).toMatch(/trim\(b\.vcref\) = ANY\(\$2::text\[\]\)/);
    expect(panggilan("bayar")[0]!.params.slice(0, 2)).toEqual([U, "UJI-F-01"]);
  });

  it("faktur batal: dipulangkan tanpa status; tanpa tautan = tanpa kueri buku", async () => {
    h.jawab.rinci = [kepala({ batal: true, alasanBatal: "salah input" })];
    const r = await q.getTagihanFaktur(U, "UJI-F-01", HARI_INI);
    expect(r).toMatchObject({ status: null, alasanBatal: "salah input", dokumen: [], totalDokumen: 0 });
    expect(r!.faktur.batal).toBe(true);
    expect(jenis()).not.toContain("buku");
  });
});

describe("tab pelanggan (S6)", () => {
  it("🔴 kode bergaris miring, bertitik, dan berpengisi spasi dicocokkan sebagai btrim(ckdplg)", async () => {
    h.jawab.kesiapan = [SIAP(U)];
    for (const [mentah, kunci] of [["  NOL/02 ", "NOL/02"], ["9.1.2  ", "9.1.2"], ["UJI05", "UJI05"]] as const) {
      h.panggilan.length = 0;
      const r = await q.getTagihanPelanggan(U, mentah, HARI_INI);
      if (!r.tersedia) throw new Error("tak tersedia");
      expect(r.customerCode).toBe(kunci);
      expect(panggilan("faktur")[0]!.params.slice(1, 5)).toEqual([null, null, kunci, true]);
      expect(panggilan("faktur")[0]!.sql).toMatch(/btrim\(h\.ckdplg\) = \$4::text/);
      expect(panggilan("kelompok")[0]!.params).toEqual([[U], kunci]);
      expect(panggilan("kelompok")[0]!.sql).toMatch(/btrim\(b\.ckdplg\) = \$2::text/);
      expect(panggilan("bayar")[0]!.params.slice(0, 2)).toEqual([U, kunci]);
      expect(panggilan("bayar")[0]!.sql).toMatch(/btrim\(h\.ckdplg\) = \$2::text/);
      expect(panggilan("saldo")[0]!.params).toEqual([U, kunci]);
      for (const p of h.panggilan) expect(p.sql).not.toContain(kunci);
      expect(r.cocokSaldo.kelompokSaldo).toBe(kunci.includes(".") ? "online" : "lokal");
    }
  });

  it("seluruh faktur hidup (lunas ikut) + pembayaran lintas faktur + cocok-silang", async () => {
    h.jawab.kesiapan = [SIAP(U)];
    h.jawab.termin = [{ kodePelanggan: null, terminHari: 30 }];
    h.jawab.faktur = [
      faktur({ kode: "UJI-F-02", nilai: 5_000_000, dibayar: 5_000_000, tanggalBayarTerakhir: "2026-11-05" }),
      faktur({ kode: "UJI-F-01", nilai: 10_000_000, dibayar: 4_000_000 }),
    ];
    h.jawab.bayar = [
      { kode: "UJI-B-03", kodeFaktur: "UJI-F-02", tanggal: "2026-11-05", bukti: null, keterangan: null, tempatKas: null, jumlah: 5_000_000, batal: false, alasanBatal: null, fakturBatal: false },
    ];
    h.jawab.kelompok = [{ unitId: U, customerCode: "UJI/01", namaPelanggan: null, jumlahDokumen: 2, total: 1_000_000, tanggalTertua: "2026-11-02" }];
    h.jawab.saldo = [{ asOfDate: "2026-11-12", sedangDiperbarui: false, kode: "UJI/01", lokal: 7_000_000, online: 0 }];
    const r = await q.getTagihanPelanggan(U, "UJI/01", HARI_INI);
    if (!r.tersedia) throw new Error("tak tersedia");
    expect(r.faktur.map((b) => [b.faktur.kode, b.status.statusBayar])).toEqual([["UJI-F-01", "sebagian"], ["UJI-F-02", "lunas"]]);
    expect(r.pembayaran).toHaveLength(1);
    expect(r.belumDitagihkan).toEqual({ jumlahDokumen: 2, total: 1_000_000, tanggalTertua: "2026-11-02" });
    expect(r.cocokSaldo).toEqual({
      sisaFaktur: 6_000_000, belumDitagihkan: 1_000_000, jumlah: 7_000_000,
      kelompokSaldo: "lokal", saldoPiutang: 7_000_000, saldoPerTanggal: "2026-11-12", selisih: 0,
    });
  });
});

describe("ringkasan lintas SPBU (S5, R21, R23)", () => {
  it("larik kosong = tanpa kueri", async () => {
    expect(await q.getRingkasanTagihanLintasUnit([], HARI_INI)).toEqual({ unit: [], terpotong: false });
    expect(h.qScoped).toHaveBeenCalledTimes(0);
  });

  it("🔴 4 kueri untuk semua unit; unit tanpa siklus = belum tersedia (bukan nol) dan tak ikut ditarik", async () => {
    h.jawab.kesiapan = [SIAP(U), { ...SIAP(V), pembayaranTerakhir: null }];
    h.jawab.terminBanyak = [
      { unitId: U, kodePelanggan: null, terminHari: 30 },
      { unitId: V, kodePelanggan: "UJI/01", terminHari: 60 },
    ];
    h.jawab.faktur = [
      faktur({ unitId: U, kode: "UJI-F-01", nilai: 10_000_000, dibayar: 4_000_000 }),
      faktur({ unitId: V, kode: "UJI-F-01", nilai: 999_000 }),
      faktur({ unitId: V, kode: "UJI-F-02", nilai: 400_000, customerCode: "UJI/09" }),
    ];
    h.jawab.kelompok = [
      { unitId: U, customerCode: "UJI/01", namaPelanggan: null, jumlahDokumen: 2, total: 1_000_000, tanggalTertua: "2026-11-02" },
      { unitId: V, customerCode: "UJI/01", namaPelanggan: null, jumlahDokumen: 1, total: 111_000, tanggalTertua: "2026-11-09" },
    ];
    const r = await q.getRingkasanTagihanLintasUnit([U, W, V], HARI_INI);
    expect(h.qScoped).toHaveBeenCalledTimes(4);
    expect(r.unit.map((u) => [u.unitId, u.tersedia])).toEqual([[U, true], [W, false], [V, true]]);
    expect(r.unit[1]).toEqual({ unitId: W, tersedia: false });

    const [a, , b] = r.unit;
    if (!a?.tersedia || !b?.tersedia) throw new Error("tak tersedia");
    expect(a.ubin).toEqual({
      lewatJatuhTempo: { jumlah: 1, sisa: 6_000_000 },
      belumJatuhTempo: { jumlah: 0, sisa: 0 },
      terminBelumDiatur: { jumlah: 0, sisa: 0 },
      belumDitagihkan: { jumlahDokumen: 2, jumlahPelanggan: 1, total: 1_000_000 },
    });
    expect(a.pembayaranTerakhir).toBe("2026-11-06");
    // Termin TIAP unit dipakai untuk fakturnya sendiri: unit V tanpa bawaan, satu pengecualian 60 hari.
    expect(b.ubin).toEqual({
      lewatJatuhTempo: { jumlah: 0, sisa: 0 },
      belumJatuhTempo: { jumlah: 1, sisa: 999_000 },
      terminBelumDiatur: { jumlah: 1, sisa: 400_000 },
      belumDitagihkan: { jumlahDokumen: 1, jumlahPelanggan: 1, total: 111_000 },
    });
    expect(b.pembayaranTerakhir).toBeNull();

    // Kesiapan ditanyakan untuk SEMUA unit; data hanya untuk yang siap — scope & parameter sama.
    expect(panggilan("kesiapan")[0]!.unit).toEqual([U, W, V]);
    for (const j of ["faktur", "terminBanyak", "kelompok"] as const) {
      expect(panggilan(j)[0]!.unit, j).toEqual([U, V]);
      expect(panggilan(j)[0]!.params[0], j).toEqual([U, V]);
    }
  });

  it("🔴 unit di luar larik tak pernah ikut, walau basis data memulangkan barisnya", async () => {
    h.jawab.kesiapan = [SIAP(U), SIAP(V)];
    h.jawab.faktur = [
      faktur({ unitId: U, kode: "UJI-F-01", nilai: 100_000 }),
      faktur({ unitId: V, kode: "UJI-F-ASING", nilai: 9_000_000 }),
    ];
    h.jawab.terminBanyak = [{ unitId: V, kodePelanggan: null, terminHari: 1 }];
    h.jawab.kelompok = [{ unitId: V, customerCode: "UJI/01", namaPelanggan: null, jumlahDokumen: 9, total: 9_000_000, tanggalTertua: "2026-01-01" }];
    const r = await q.getRingkasanTagihanLintasUnit([U], HARI_INI);
    expect(r.unit).toHaveLength(1);
    const a = r.unit[0]!;
    if (!a.tersedia) throw new Error("tak tersedia");
    expect(a.unitId).toBe(U);
    expect(a.ubin).toEqual({
      lewatJatuhTempo: { jumlah: 0, sisa: 0 },
      belumJatuhTempo: { jumlah: 0, sisa: 0 },
      terminBelumDiatur: { jumlah: 1, sisa: 100_000 },
      belumDitagihkan: { jumlahDokumen: 0, jumlahPelanggan: 0, total: 0 },
    });
    for (const p of h.panggilan) expect(p.unit).toEqual([U]);
  });

  it("semua unit belum siap: hanya kueri kesiapan yang jalan", async () => {
    const r = await q.getRingkasanTagihanLintasUnit([U, V], HARI_INI);
    expect(r).toEqual({ unit: [{ unitId: U, tersedia: false }, { unitId: V, tersedia: false }], terpotong: false });
    expect(h.qScoped).toHaveBeenCalledTimes(1);
  });
});

describe("tak ada nilai yang disisipkan ke SQL", () => {
  it("setiap teks SQL konstan terhadap masukan — unit, kode, tanggal, pencarian hanya lewat parameter", async () => {
    const jalankan = async (unit: ScopedUnitId, kode: string, periode: { from: string; to: string }, cari: string) => {
      h.panggilan.length = 0;
      h.jawab.kesiapan = [SIAP(unit)];
      h.jawab.rinci = [{ ...SIAP(unit), kode, customerCode: kode, namaPelanggan: null, tanggalFaktur: "2026-10-01",
        jatuhTempoEasymax: null, nilai: 1, statusEasymax: null, sisaEasymax: null, batal: false, alasanBatal: null,
        keterangan: null, jenisTagihan: null, nilaiPokok: null, biayaAdmin: null }];
      h.jawab.tautan = [{ kodeDokumen: kode }];
      await q.getTagihanDaftar(unit, { filter: "lunas", cari, periodeLunas: periode, hariIni: periode.to });
      await q.getBelumDitagihkan(unit, { cari, hariIni: periode.to });
      await q.getDokumenBelumDitagihkan(unit, kode);
      await q.getTagihanFaktur(unit, kode, periode.to);
      await q.getTagihanPelanggan(unit, kode, periode.to);
      await q.getRingkasanTagihanLintasUnit([unit], periode.to);
      await q.getSaldoTerbitTerakhir(unit);
      return new Set(h.panggilan.map((p) => p.sql));
    };
    const satu = await jalankan(U, "UJI/01", PERIODE, "contoh");
    const dua = await jalankan(V, "X'; DROP--", { from: "2025-01-01", to: "2025-01-31" }, "lain");
    expect([...dua].sort()).toEqual([...satu].sort());
    expect(satu.size).toBeGreaterThanOrEqual(11);
  });
});
