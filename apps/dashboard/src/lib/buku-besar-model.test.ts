import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ATURAN_KATEGORI_KAS,
  ATURAN_KOMPONEN_RINCIAN,
  ATURAN_SEKSI_MANUAL,
  deltaMaju,
  jurnalKas,
  jurnalManual,
  modeBentukUlang,
  p1Penjualan,
  p5PencairanEdc,
  p8Penerimaan,
  p9Hpp,
  p10LossesGain,
  p23Revaluasi,
  p24SelisihKas,
  p28Pelanggan,
  periksaRentangBackfill,
  seimbang,
  senDariRupiah,
  senLiterKaliHarga,
  tentukanTanggalBukuBesar,
  turunkanHari,
  type BarisJurnal,
  type BarisKas,
  type BarisManual,
  type JurnalTurunan,
  type MasukanHari,
  type ProdukHari,
} from "./buku-besar-model";

/**
 * Aturan posting buku besar (rencana 2026-11-02 K6 U8; R6, R7, R11, R13,
 * KTD3–KTD5, Tabel Aturan Posting P1–P28). Semua angka ilustrasi; nilai yang
 * diharapkan dihitung TANGAN di tes ini, bukan dari fungsi yang diuji.
 */

const T = "2026-10-14";
const rp = (n: number) => n * 100; // rupiah → sen

/** Saldo per pos (debet − kredit) dari baris jurnal — penilai hasil, bukan kode yang diuji. */
function saldo(baris: readonly BarisJurnal[]): Record<string, number> {
  const s: Record<string, number> = {};
  for (const b of baris) s[b.posKode] = (s[b.posKode] ?? 0) + b.debetSen - b.kreditSen;
  for (const k of Object.keys(s)) if (s[k] === 0) delete s[k];
  return s;
}
const semuaBaris = (js: readonly (JurnalTurunan | null)[]) => js.flatMap((j) => j?.baris ?? []);
const harusSeimbang = (j: JurnalTurunan | null) => {
  expect(j).not.toBeNull();
  const d = j!.baris.reduce((s, b) => s + b.debetSen, 0);
  const k = j!.baris.reduce((s, b) => s + b.kreditSen, 0);
  expect(d).toBe(k);
  expect(d).toBeGreaterThan(0);
};

const produk = (o: Partial<ProdukHari> = {}): ProdukHari => ({
  produk: "PERTALITE",
  volumeL: 4_000,
  teraL: 0,
  hargaJual: 10_000,
  hargaBeli: 9_000,
  stokL: 20_000,
  lossesGainL: 0,
  penerimaanL: 0,
  sisaSoAktifL: 0,
  ...o,
});

const kas = (o: Partial<BarisKas> & { amountSen: number; kategori: string | null }): BarisKas => ({
  id: `kas-${o.kategori}-${o.amountSen}`,
  accountId: "akun-bank",
  keterangan: "mutasi",
  tanggalAsal: null,
  edcSettlementId: null,
  pasanganUuid: null,
  pihakLawanJenis: null,
  tertaut: [],
  penebusan: null,
  ...o,
});

const POS_AKUN: Record<string, string | null> = {
  "akun-kas": "1101",
  "akun-edc": "1102",
  "akun-bank": "1111",
  "akun-bni": "1112",
  "akun-tanpa-pos": null,
};

const manual = (o: Partial<BarisManual> & Pick<BarisManual, "section">): BarisManual => ({
  id: `me-${o.section}`,
  sourceDoor: "pengawas",
  amountSen: rp(150_000),
  posKode: "5700",
  titipan: false,
  keterangan: "baris rincian",
  ...o,
});

// ---------------------------------------------------------------------------
// Aritmetika sen
// ---------------------------------------------------------------------------

describe("aritmetika sen — bulat setengah ke atas, sekali", () => {
  it("rupiah desimal dibaca persis", () => {
    expect(senDariRupiah("1234567.89")).toBe(123_456_789);
    expect(senDariRupiah("-20000000.00")).toBe(-2_000_000_000);
    expect(senDariRupiah("15.5")).toBe(1_550);
  });
  it("liter × harga dibulatkan setengah ke atas pada sen, simetris untuk negatif", () => {
    // 1,005 L × Rp 1 = Rp 1,005 = 100,5 sen → 101 sen
    expect(senLiterKaliHarga(1.005, 1)).toBe(101);
    expect(senLiterKaliHarga(-1.005, 1)).toBe(-101);
    // 3 L × Rp 9.123,4567 = Rp 27.370,3701 → 2.737.037 sen
    expect(senLiterKaliHarga(3, 9_123.4567)).toBe(2_737_037);
  });
});

// ---------------------------------------------------------------------------
// Setiap aturan seimbang
// ---------------------------------------------------------------------------

describe("R6 — setiap aturan P menghasilkan jurnal seimbang sampai Rp 0", () => {
  it("P1 penjualan: 1103 + 4110 = 4100, tera terpisah", () => {
    const j = p1Penjualan(T, produk({ volumeL: 4_000, teraL: 20, hargaJual: 10_000 }));
    harusSeimbang(j);
    expect(saldo(j!.baris)).toEqual({ "1103": rp(39_800_000), "4110": rp(200_000), "4100": -rp(40_000_000) });
  });
  it("P8, P9, P10 seimbang", () => {
    harusSeimbang(p8Penerimaan(T, produk({ penerimaanL: 8_000 })));
    harusSeimbang(p9Hpp(T, produk()));
    harusSeimbang(p10LossesGain(T, produk({ lossesGainL: -12 })));
    expect(saldo(p10LossesGain(T, produk({ lossesGainL: -12 }))!.baris)).toEqual({ "5110": rp(108_000), "1131": -rp(108_000) });
    expect(saldo(p10LossesGain(T, produk({ lossesGainL: 5 }))!.baris)).toEqual({ "1131": rp(45_000), "5110": -rp(45_000) });
  });

  const kasan: [string, BarisKas, Record<string, number>][] = [
    ["P2 setoran tunai", kas({ accountId: "akun-kas", amountSen: rp(20_000_000), kategori: "Setoran Hasil Penjualan" }), { "1101": rp(20_000_000), "1103": -rp(20_000_000) }],
    ["P3 EDC per shift", kas({ accountId: "akun-edc", amountSen: rp(8_000_000), kategori: "Penjualan EDC" }), { "1102": rp(8_000_000), "1103": -rp(8_000_000) }],
    ["P6 setoran ke bank (kaki keluar)", kas({ accountId: "akun-kas", amountSen: -rp(5_000_000), kategori: "Setoran ke Bank" }), { "1190": rp(5_000_000), "1101": -rp(5_000_000) }],
    ["P6 pindah buku (kaki masuk)", kas({ amountSen: rp(5_000_000), kategori: "Pindah Buku" }), { "1111": rp(5_000_000), "1190": -rp(5_000_000) }],
    ["P12 pendapatan lain", kas({ amountSen: rp(750_000), kategori: "Pendapatan Lain-Lain" }), { "1111": rp(750_000), "4200": -rp(750_000) }],
    ["P13 pembayaran piutang", kas({ amountSen: rp(2_500_000), kategori: "Transfer Pembayaran Piutang Pelanggan" }), { "1111": rp(2_500_000), "1121": -rp(2_500_000) }],
    ["P14 antar unit (pemberi)", kas({ amountSen: -rp(10_000_000), kategori: "Hutang Piutang", pasanganUuid: "p-1", pihakLawanJenis: "unit" }), { "1122": rp(10_000_000), "1111": -rp(10_000_000) }],
    ["P14 antar unit (penerima)", kas({ amountSen: rp(10_000_000), kategori: "Hutang Piutang", pasanganUuid: "p-1", pihakLawanJenis: "unit" }), { "1111": rp(10_000_000), "2102": -rp(10_000_000) }],
    ["P15 piutang lain", kas({ amountSen: -rp(3_000_000), kategori: "Hutang Piutang", pihakLawanJenis: "karyawan" }), { "1129": rp(3_000_000), "1111": -rp(3_000_000) }],
    ["P15 hutang lain", kas({ amountSen: rp(3_000_000), kategori: "Hutang Piutang", pihakLawanJenis: "kreditur" }), { "1111": rp(3_000_000), "2109": -rp(3_000_000) }],
    ["P16 penyerahan titipan", kas({ accountId: "akun-kas", amountSen: -rp(1_000_000), kategori: "Penyerahan titipan" }), { "2103": rp(1_000_000), "1101": -rp(1_000_000) }],
    ["P17 tambahan modal", kas({ amountSen: rp(50_000_000), kategori: "Tambahan Modal" }), { "1111": rp(50_000_000), "3100": -rp(50_000_000) }],
    ["P17 kontribusi ke pusat", kas({ amountSen: -rp(7_000_000), kategori: "Kontribusi ke Pusat" }), { "3300": rp(7_000_000), "1111": -rp(7_000_000) }],
    ["P18 investasi sementara", kas({ amountSen: -rp(10_000_000), kategori: "Temporary Investment" }), { "1150": rp(10_000_000), "1111": -rp(10_000_000) }],
    ["P19 parkir", kas({ amountSen: rp(400_000), kategori: "Mutasi Belum Teridentifikasi" }), { "1111": rp(400_000), "1199": -rp(400_000) }],
    ["P20 management fee tanpa tautan → 5700", kas({ amountSen: -rp(2_000_000), kategori: "Management Fee" }), { "5700": rp(2_000_000), "1111": -rp(2_000_000) }],
    [
      "P11 biaya bertaut → pos baris Biaya",
      kas({ accountId: "akun-kas", amountSen: -rp(1_500_000), kategori: "Biaya Operasional", tertaut: [{ manualEntryId: "me-1", posKode: "5300", amountSen: rp(1_500_000) }] }),
      { "5300": rp(1_500_000), "1101": -rp(1_500_000) },
    ],
    ["P26 biaya tanpa tautan → 1198", kas({ amountSen: -rp(900_000), kategori: "Biaya Operasional" }), { "1198": rp(900_000), "1111": -rp(900_000) }],
    [
      "P7 penebusan: 1132 (Net+PBBKB+Nota) · 1140 (PPN+PPh) = Gross",
      kas({
        amountSen: -rp(110_000_000),
        kategori: "Pembelian BBM",
        penebusan: { id: "pb-1", netSen: rp(96_000_000), ppnSen: rp(10_560_000), pphSen: rp(320_000), pbbkbSen: rp(3_120_000), notaSen: 0, grossSen: rp(110_000_000) },
      }),
      { "1132": rp(99_120_000), "1140": rp(10_880_000), "1111": -rp(110_000_000) },
    ],
    ["P26 Pembelian BBM tanpa penebusan → 1198", kas({ amountSen: -rp(110_000_000), kategori: "Pembelian BBM" }), { "1198": rp(110_000_000), "1111": -rp(110_000_000) }],
  ];
  it.each(kasan)("%s", (_n, row, harap) => {
    const { jurnal } = jurnalKas(T, row, POS_AKUN[row.accountId]!);
    harusSeimbang(jurnal);
    expect(saldo(jurnal!.baris)).toEqual(harap);
  });

  it("P5 pencairan EDC: 111x neto + 5500 MDR = 1102 bruto", () => {
    const { jurnal, temuan } = p5PencairanEdc(T, {
      settlementId: "st-1",
      tanggalEfektif: T,
      legs: [
        { posKode: "1111", amountSen: rp(7_960_000) },
        { posKode: "1102", amountSen: -rp(8_000_000) },
      ],
      mdrSen: rp(40_000),
    });
    harusSeimbang(jurnal);
    expect(temuan).toEqual([]);
    expect(saldo(jurnal!.baris)).toEqual({ "1111": rp(7_960_000), "5500": rp(40_000), "1102": -rp(8_000_000) });
  });

  it("P4, P27, P16 (Rincian pengawas) dan P26 (Biaya Finance tanpa mutasi) seimbang", () => {
    const p4 = jurnalManual(T, manual({ section: "pengeluaran", posKode: "5300" })).jurnal;
    harusSeimbang(p4);
    expect(saldo(p4!.baris)).toEqual({ "5300": rp(150_000), "1103": -rp(150_000) });
    const p27 = jurnalManual(T, manual({ section: "pendapatan_lain", posKode: "5700" })).jurnal;
    harusSeimbang(p27);
    // R26: berkode beban tetap pendapatan.
    expect(saldo(p27!.baris)).toEqual({ "1103": rp(150_000), "4200": -rp(150_000) });
    const p16 = jurnalManual(T, manual({ section: "pendapatan_lain", titipan: true })).jurnal;
    expect(saldo(p16!.baris)).toEqual({ "1103": rp(150_000), "2103": -rp(150_000) });
    const p26 = jurnalManual(T, manual({ section: "pengeluaran", sourceDoor: "finance", posKode: "5200" }));
    expect(saldo(p26.jurnal!.baris)).toEqual({ "5200": rp(150_000), "1198": -rp(150_000) });
    expect(p26.temuan.map((t) => t.kode)).toEqual(["belum_tertaut"]);
    // Setoran tunai diwujudkan oleh baris kas (P2), tidak dijurnal dua kali.
    expect(jurnalManual(T, manual({ section: "setoran_tunai" })).jurnal).toBeNull();
  });

  it("P28 piutang & deposit EasyMax disesuaikan ke saldo akhir, lawan 1103", () => {
    // Piutang naik Rp 3 jt (penjualan tempo); hari itu juga transfer piutang Rp 1 jt (P13: 1121 −1 jt).
    const j = p28Pelanggan(T, { piutangAwalSen: rp(10_000_000), piutangAkhirSen: rp(12_000_000), depositAwalSen: rp(5_000_000), depositAkhirSen: rp(4_000_000) }, -rp(1_000_000));
    harusSeimbang(j);
    expect(saldo(j!.baris)).toEqual({ "1121": rp(3_000_000), "2101": rp(1_000_000), "1103": -rp(4_000_000) });
  });
});

// ---------------------------------------------------------------------------
// R11 / AE11 — HPP
// ---------------------------------------------------------------------------

describe("R11 — HPP = liter terjual × harga beli terakhir", () => {
  it("Covers AE11. 4.000 L × Rp 9.000 → HPP Rp 36.000.000; penebusan hari itu tidak mengubah HPP", () => {
    const tanpa = turunkanHari(hari({ produk: [produk()] }));
    const dengan = turunkanHari(
      hari({
        produk: [produk()],
        kas: [
          kas({
            amountSen: -rp(110_000_000),
            kategori: "Pembelian BBM",
            penebusan: { id: "pb-1", netSen: rp(96_000_000), ppnSen: rp(10_560_000), pphSen: rp(320_000), pbbkbSen: rp(3_120_000), notaSen: 0, grossSen: rp(110_000_000) },
          }),
        ],
      }),
    );
    const hpp = (h: ReturnType<typeof turunkanHari>) => saldo(semuaBaris(h.jurnal.filter((j) => j.aturan === "P9")))["5100"];
    expect(hpp(tanpa)).toBe(rp(36_000_000));
    expect(hpp(dengan)).toBe(rp(36_000_000));
    // Penebusan masuk persediaan (1132), bukan HPP.
    expect(saldo(semuaBaris(dengan.jurnal.filter((j) => j.aturan === "P7")))["1132"]).toBe(rp(99_120_000));
  });

  it("HPP memakai liter bersih tera (rumus §1.1)", () => {
    expect(saldo(p9Hpp(T, produk({ volumeL: 4_000, teraL: 20 }))!.baris)["5100"]).toBe(rp(35_820_000));
  });

  it("harga beli kosong → tidak ada P8/P9/P10/P23 produk itu, temuan 'harga beli belum diisi'; tidak pernah harga nol", () => {
    const h = turunkanHari(hari({ produk: [produk({ hargaBeli: null, penerimaanL: 8_000, lossesGainL: -3 })] }));
    expect(h.jurnal.filter((j) => ["P8", "P9", "P10", "P23"].includes(j.aturan))).toEqual([]);
    expect(h.temuan.some((t) => t.kode === "harga_beli_kosong" && t.produk === "PERTALITE")).toBe(true);
    // Penjualan tetap terposting.
    expect(h.jurnal.some((j) => j.aturan === "P1")).toBe(true);
    expect(saldo(semuaBaris(h.jurnal))["5100"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// P23 / KTD4 — penilaian ulang harian
// ---------------------------------------------------------------------------

describe("P23 — 1131/1132 disesuaikan ke liter × harga beli terakhir, lawan 5120", () => {
  it("harga beli berubah → jurnal 5120 sebesar stok × beda harga", () => {
    // Kemarin: 20.000 L × Rp 9.000 = Rp 180 jt di 1131. Hari ini tanpa gerak, harga Rp 9.100.
    const { jurnal } = p23Revaluasi(
      T,
      [produk({ volumeL: 0, stokL: 20_000, hargaBeli: 9_100, sisaSoAktifL: 0 })],
      { s1131: rp(180_000_000), s1132: 0 },
      { g1131: 0, g1132: 0 },
    );
    harusSeimbang(jurnal);
    expect(saldo(jurnal!.baris)).toEqual({ "1131": rp(2_000_000), "5120": -rp(2_000_000) });
  });

  it("sisa SO dinilai ulang ke liter × harga; selisih harga penebusan masuk 5120", () => {
    // 1132 kemarin 0; hari ini penebusan Rp 99,12 jt (gerak), sisa SO 11.000 L × Rp 9.000 = Rp 99 jt.
    const { jurnal } = p23Revaluasi(
      T,
      [produk({ stokL: 0, sisaSoAktifL: 11_000 })],
      { s1131: 0, s1132: 0 },
      { g1131: 0, g1132: rp(99_120_000) },
    );
    expect(saldo(jurnal!.baris)).toEqual({ "1132": -rp(120_000), "5120": rp(120_000) });
  });

  it("gerak hari itu (P8 − P9 ± P10) tidak ikut dinilai ulang", () => {
    const h = turunkanHari(
      hari({
        produk: [produk({ volumeL: 4_000, stokL: 24_000, penerimaanL: 8_000, sisaSoAktifL: 3_000 })],
        saldoPersediaan: { s1131: rp(180_000_000), s1132: rp(99_000_000) },
      }),
    );
    // 20.000 + 8.000 − 4.000 = 24.000 L × Rp 9.000 = saldo yang sudah tercapai ⇒ tanpa P23.
    expect(h.jurnal.filter((j) => j.aturan === "P23")).toEqual([]);
    const s = saldo(semuaBaris(h.jurnal));
    expect(s["1131"]! + rp(180_000_000)).toBe(rp(216_000_000));
    expect(s["1132"]! + rp(99_000_000)).toBe(rp(27_000_000));
  });

  it("saldo awal persediaan belum diisi → tanpa P23, temuan; tidak ada angka penyeimbang", () => {
    const { jurnal, temuan } = p23Revaluasi(T, [produk()], { s1131: null, s1132: null }, { g1131: 0, g1132: 0 });
    expect(jurnal).toBeNull();
    expect(temuan.map((t) => t.kode)).toContain("saldo_awal_persediaan_kosong");
  });

  it("satu produk berstok tanpa harga beli → 1131 tidak dinilai sama sekali (bukan dinilai sebagian)", () => {
    const { jurnal } = p23Revaluasi(
      T,
      [produk({ stokL: 20_000, hargaBeli: 9_100 }), produk({ produk: "SOLAR", stokL: 5_000, hargaBeli: null })],
      { s1131: rp(225_000_000), s1132: 0 },
      { g1131: 0, g1132: 0 },
    );
    expect(jurnal === null || saldo(jurnal.baris)["1131"] === undefined).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P24 / KTD5 — selisih kas
// ---------------------------------------------------------------------------

describe("P24 — sisa 1103 ke 5130 hanya bila tingkat toleransinya disetujui", () => {
  it("tutup hari dengan selisih Rp 50.000 disetujui HoF → sisa pindah ke 5130", () => {
    const { jurnal, temuan } = p24SelisihKas(T, rp(50_000), { ditutup: true, tier: "exception_hof", disetujui: true });
    harusSeimbang(jurnal);
    expect(saldo(jurnal!.baris)).toEqual({ "5130": rp(50_000), "1103": -rp(50_000) });
    expect(temuan).toEqual([]);
  });
  it("lebih setor (sisa negatif) → 5130 negatif", () => {
    const { jurnal } = p24SelisihKas(T, -rp(8_000), { ditutup: true, tier: "within_tolerance", disetujui: false });
    expect(saldo(jurnal!.baris)).toEqual({ "1103": rp(8_000), "5130": -rp(8_000) });
  });
  it("sisa Rp 50.000 tetapi hari ditutup dalam toleransi → tetap di 1103 sebagai temuan", () => {
    const { jurnal, temuan } = p24SelisihKas(T, rp(50_000), { ditutup: true, tier: "within_tolerance", disetujui: false });
    expect(jurnal).toBeNull();
    expect(temuan.map((t) => t.kode)).toEqual(["sisa_1103_belum_disetujui"]);
  });
  it("sisa > Rp 100.000 dengan persetujuan HoF saja → tetap di 1103", () => {
    const { jurnal } = p24SelisihKas(T, rp(150_000), { ditutup: true, tier: "exception_hof", disetujui: true });
    expect(jurnal).toBeNull();
  });
  it("hari belum ditutup → tidak ada P24", () => {
    expect(p24SelisihKas(T, rp(5_000), null).jurnal).toBeNull();
  });
  it("sisa dihitung dari jurnal hari itu: penjualan − setoran − pengeluaran", () => {
    const h = turunkanHari(
      hari({
        produk: [produk({ volumeL: 2_000, hargaJual: 10_000 })], // 1103 +20 jt
        kas: [kas({ accountId: "akun-kas", amountSen: rp(19_820_000), kategori: "Setoran Hasil Penjualan" })],
        manual: [manual({ section: "pengeluaran", amountSen: rp(150_000) })],
        tutupHari: { ditutup: true, tier: "exception_hof", disetujui: true },
      }),
    );
    // 20.000.000 − 19.820.000 − 150.000 = 30.000 kurang setor.
    const p24 = h.jurnal.find((j) => j.aturan === "P24");
    expect(saldo(p24!.baris)).toEqual({ "5130": rp(30_000), "1103": -rp(30_000) });
    expect(saldo(semuaBaris(h.jurnal))["1103"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// KTD3 — idempoten, koreksi maju, backfill
// ---------------------------------------------------------------------------

function hari(o: Partial<MasukanHari> = {}): MasukanHari {
  return {
    tanggal: T,
    produk: [],
    pelanggan: null,
    kas: [],
    pencairan: [],
    manual: [],
    posAkun: POS_AKUN,
    saldoPersediaan: { s1131: rp(180_000_000), s1132: 0 },
    memorial1103Sen: 0,
    tutupHari: null,
    ...o,
  };
}

describe("KTD3 — pembentukan ulang idempoten", () => {
  const masukan = hari({
    produk: [produk({ penerimaanL: 8_000, sisaSoAktifL: 3_000, stokL: 24_100, lossesGainL: 100 })],
    pelanggan: { piutangAwalSen: rp(1_000_000), piutangAkhirSen: rp(1_500_000), depositAwalSen: 0, depositAkhirSen: 0 },
    kas: [
      kas({ accountId: "akun-kas", amountSen: rp(19_000_000), kategori: "Setoran Hasil Penjualan" }),
      kas({ amountSen: -rp(900_000), kategori: "Biaya Operasional" }),
    ],
    manual: [manual({ section: "pengeluaran" })],
    saldoPersediaan: { s1131: rp(180_000_000), s1132: rp(99_000_000) },
    tutupHari: { ditutup: true, tier: "override_direksi", disetujui: true },
  });

  it("masukan sama → jurnal identik, termasuk urutan", () => {
    expect(turunkanHari(masukan)).toEqual(turunkanHari(structuredClone(masukan)));
  });
  it("urutan baris sumber tidak mengubah hasil", () => {
    const balik = { ...masukan, kas: [...masukan.kas].reverse() };
    expect(turunkanHari(balik).jurnal).toEqual(turunkanHari(masukan).jurnal);
  });
  it("kunci sumber unik per (tabel, id, aturan)", () => {
    const k = turunkanHari(masukan).jurnal.map((j) => `${j.sumberTabel}|${j.sumberId}|${j.aturan}`);
    expect(new Set(k).size).toBe(k.length);
  });
  it("setiap jurnal hari itu seimbang, dan seluruh hari seimbang", () => {
    const h = turunkanHari(masukan);
    for (const j of h.jurnal) expect(seimbang(j.baris)).toBe(true);
    const total = semuaBaris(h.jurnal);
    expect(total.reduce((s, b) => s + b.debetSen - b.kreditSen, 0)).toBe(0);
  });
});

describe("KTD3 / R13 — bulan tertutup: satu koreksi maju sebesar selisihnya", () => {
  it("sumber berubah → delta = turunan baru − tersimpan, per pos, seimbang", () => {
    const lama = turunkanHari(hari({ kas: [kas({ accountId: "akun-kas", amountSen: rp(20_000_000), kategori: "Setoran Hasil Penjualan" })] }));
    const baru = turunkanHari(hari({ kas: [kas({ accountId: "akun-kas", amountSen: rp(19_500_000), kategori: "Setoran Hasil Penjualan" })] }));
    const d = deltaMaju(semuaBaris(lama.jurnal), semuaBaris(baru.jurnal));
    expect(seimbang(d)).toBe(true);
    expect(saldo(d)).toEqual({ "1101": -rp(500_000), "1103": rp(500_000) });
  });
  it("tanpa perubahan → delta kosong (tidak ada jurnal koreksi)", () => {
    const j = semuaBaris(turunkanHari(hari({ produk: [produk()] })).jurnal);
    expect(deltaMaju(j, j)).toEqual([]);
  });
  it("koreksi yang sudah pernah diposting ikut dihitung sebagai tersimpan", () => {
    const awal: BarisJurnal[] = [
      { posKode: "1101", debetSen: rp(20_000_000), kreditSen: 0 },
      { posKode: "1103", debetSen: 0, kreditSen: rp(20_000_000) },
    ];
    const koreksi1 = deltaMaju(awal, [
      { posKode: "1101", debetSen: rp(19_500_000), kreditSen: 0 },
      { posKode: "1103", debetSen: 0, kreditSen: rp(19_500_000) },
    ]);
    // Turunan sama dengan setelah koreksi pertama ⇒ koreksi kedua kosong.
    expect(
      deltaMaju([...awal, ...koreksi1], [
        { posKode: "1101", debetSen: rp(19_500_000), kreditSen: 0 },
        { posKode: "1103", debetSen: 0, kreditSen: rp(19_500_000) },
      ]),
    ).toEqual([]);
  });

  it("tanggal buku: bulan tertutup → hari buka pertama di bulan terbuka berikutnya", () => {
    const hariOkt = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    expect(
      tentukanTanggalBukuBesar({ tanggal: "2026-10-14", bulanTertutup: ["2026-10"], hariTertutup: [...hariOkt, "2026-11-01", "2026-11-02"] }),
    ).toEqual({ tanggalBuku: "2026-11-03", maju: true });
  });

  it("memorial bertanggal 31 Okt yang diisi 3 Nov saat Oktober belum tutup bulan → tetap Oktober", () => {
    const hariOkt = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    expect(tentukanTanggalBukuBesar({ tanggal: "2026-10-31", bulanTertutup: [], hariTertutup: hariOkt })).toEqual({
      tanggalBuku: "2026-10-31",
      maju: false,
    });
  });
});

describe("KTD3 — backfill satu kali", () => {
  it("bulan terbuka → tulis langsung, bukan backfill", () => {
    expect(modeBentukUlang("terbuka", { backfill: true, adaTutupBukuBesar: true })).toEqual({ mode: "langsung", backfill: false });
  });
  it("bulan ditutup K5 sebelum ada tutup buku besar → backfill langsung bertanda", () => {
    expect(modeBentukUlang("tutup_k5", { backfill: true, adaTutupBukuBesar: false })).toEqual({ mode: "langsung", backfill: true });
  });
  it("bulan ditutup K5 sesudah ada bulan ditutup dengan buku besar → backfill ditolak", () => {
    expect(modeBentukUlang("tutup_k5", { backfill: true, adaTutupBukuBesar: true })).toHaveProperty("tolak");
  });
  it("backfill ke bulan yang sudah ditutup dengan buku besar → ditolak", () => {
    expect(modeBentukUlang("tutup_buku_besar", { backfill: true, adaTutupBukuBesar: true })).toHaveProperty("tolak");
    expect(
      periksaRentangBackfill({ dari: "2026-10-01", sampai: "2026-11-30", bulanTertutup: [{ bulan: "2026-10", bukuBesar: true }] }),
    ).toMatch(/2026-10/);
  });
  it("jalur biasa ke bulan tertutup → koreksi maju", () => {
    expect(modeBentukUlang("tutup_buku_besar", { backfill: false, adaTutupBukuBesar: true })).toEqual({ mode: "koreksi_maju", backfill: false });
    expect(modeBentukUlang("tutup_k5", { backfill: false, adaTutupBukuBesar: false })).toEqual({ mode: "koreksi_maju", backfill: false });
  });
  it("rentang sebelum 1 Okt 2026 atau terbalik ditolak", () => {
    expect(periksaRentangBackfill({ dari: "2026-09-30", sampai: "2026-10-05", bulanTertutup: [] })).not.toBeNull();
    expect(periksaRentangBackfill({ dari: "2026-10-05", sampai: "2026-10-01", bulanTertutup: [] })).not.toBeNull();
    expect(periksaRentangBackfill({ dari: "2026-10-01", sampai: "2026-11-30", bulanTertutup: [{ bulan: "2026-10", bukuBesar: false }] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Guard — setiap kategori kas, seksi manual_entry, dan komponen Rincian punya
// tepat satu aturan posting (pola keuangan-sisi-kas.test.ts)
// ---------------------------------------------------------------------------

const MIGRASI = resolve(__dirname, "../../../backend/prisma/migrations");
const tanpaKomentar = (sql: string) => sql.replace(/--.*$/gm, "");

function bacaMigrasi(): string[] {
  const out: string[] = [];
  for (const dir of readdirSync(MIGRASI).sort()) {
    try {
      out.push(tanpaKomentar(readFileSync(resolve(MIGRASI, dir, "migration.sql"), "utf8")));
    } catch {
      /* bukan direktori migrasi */
    }
  }
  return out;
}

function labelKategori(sql: string): string[] {
  const out: string[] = [];
  const blok = /INSERT INTO "app"\."cash_mutation_category"[^;]*?VALUES([\s\S]*?)(?:ON CONFLICT|;)/g;
  for (const m of sql.matchAll(blok)) {
    for (const t of m[1]!.matchAll(/\(\s*'(?:debet|kredit)'\s*,\s*'([^']+)'\s*\)/g)) out.push(t[1]!);
  }
  return out;
}

function seksiManual(sql: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(/CREATE TYPE "app"\."manual_entry_section" AS ENUM \(([^)]*)\)/g)) {
    for (const t of m[1]!.matchAll(/'([^']+)'/g)) out.push(t[1]!);
  }
  for (const m of sql.matchAll(/ALTER TYPE "app"\."manual_entry_section" ADD VALUE(?: IF NOT EXISTS)? '([^']+)'/g)) out.push(m[1]!);
  return out;
}

/** Huruf ringkasan Rincian (rincian-model.ts) — yang tanpa `formula` adalah komponen sumber. */
function komponenRincian(): { sumber: string[]; turunan: string[] } {
  const ts = readFileSync(resolve(__dirname, "rincian-model.ts"), "utf8");
  const sumber: string[] = [];
  const turunan: string[] = [];
  for (const m of ts.matchAll(/\{\s*l:\s*"([A-Z])"([^}]*)/g)) (m[2]!.includes("formula:") ? turunan : sumber).push(m[1]!);
  return { sumber, turunan };
}

describe("Guard — setiap catatan sumber punya tepat satu aturan posting", () => {
  const sql = bacaMigrasi();
  const label = [...new Set(sql.flatMap(labelKategori))];
  const seksi = [...new Set(sql.flatMap(seksiManual))];
  const rincian = komponenRincian();

  it("penjaga punya SUBJEK", () => {
    expect(label.length).toBeGreaterThanOrEqual(16);
    expect(label).toContain("Mutasi Belum Teridentifikasi");
    expect(seksi.sort()).toEqual(["pendapatan_lain", "pengeluaran", "setoran_tunai"]);
    expect(rincian.sumber).toEqual(expect.arrayContaining(["A", "B", "C", "D", "F", "G", "I"]));
    expect(rincian.turunan.sort()).toEqual(["E", "H"]);
  });
  it("🔴 setiap label cash_mutation_category yang di-seed punya aturan", () => {
    expect(label.filter((l) => ATURAN_KATEGORI_KAS[l] === undefined)).toEqual([]);
  });
  it("🔴 MUTAN: migrasi baru menyemai kategori tanpa aturan ⇒ merah", () => {
    const baru = `INSERT INTO "app"."cash_mutation_category" ("side", "label") VALUES ('kredit', 'Biaya Bunga Bank') ON CONFLICT DO NOTHING;`;
    expect(labelKategori(baru).filter((l) => ATURAN_KATEGORI_KAS[l] === undefined)).toEqual(["Biaya Bunga Bank"]);
  });
  it("peta kategori tidak memuat label yang tak pernah di-seed", () => {
    expect(Object.keys(ATURAN_KATEGORI_KAS).filter((l) => !label.includes(l))).toEqual([]);
  });
  it("🔴 setiap seksi manual_entry punya aturan, dan tidak ada seksi fiktif", () => {
    expect(seksi.filter((s) => ATURAN_SEKSI_MANUAL[s] === undefined)).toEqual([]);
    expect(Object.keys(ATURAN_SEKSI_MANUAL).sort()).toEqual([...seksi].sort());
  });
  it("🔴 setiap komponen sumber Rincian punya aturan; komponen turunan tidak dijurnal", () => {
    expect(rincian.sumber.filter((k) => ATURAN_KOMPONEN_RINCIAN[k] === undefined)).toEqual([]);
    expect(Object.keys(ATURAN_KOMPONEN_RINCIAN).sort()).toEqual([...rincian.sumber].sort());
    for (const k of rincian.turunan) expect(ATURAN_KOMPONEN_RINCIAN[k]).toBeUndefined();
  });
});
