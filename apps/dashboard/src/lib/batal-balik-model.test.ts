import { describe, expect, it } from "vitest";
import {
  dampakBatal,
  periksaAjukanBalik,
  periksaBatal,
  PESAN_BALIK,
  PESAN_BATAL,
  ringkasDibalik,
  type BarisBalik,
  type BarisDibalik,
  type BarisBatal,
} from "./batal-balik-model";

const KODE = new Set(["VOID-DUP", "VOID-LAIN"]);
const baris = (o: Partial<BarisBatal> = {}): BarisBatal => ({
  sourceDoor: "finance",
  void: false,
  cashLedgerId: null,
  hariTutup: false,
  bulanTutup: false,
  ...o,
});
const ok = { reasonCode: "VOID-DUP", alasan: "ganda dengan MDR otomatis settlement" };

describe("periksaBatal — pemeriksa murni Batalkan (rencana 2026-11-07 R1–R3)", () => {
  it("baris Finance hari terbuka, kode & alasan sah → boleh", () => {
    expect(periksaBatal(baris(), ok, KODE)).toBeNull();
  });

  it("🔴 baris pengawas → ditolak; jalurnya Kembalikan untuk perbaikan (§2.1)", () => {
    expect(periksaBatal(baris({ sourceDoor: "pengawas" }), ok, KODE)).toBe(PESAN_BATAL.pengawas);
    expect(PESAN_BATAL.pengawas).toMatch(/Kembalikan untuk perbaikan/);
  });

  it("🔴 bertaut mutasi kas → ditolak; batalkan lewat mutasi kas asalnya", () => {
    expect(periksaBatal(baris({ cashLedgerId: "k1" }), ok, KODE)).toBe(PESAN_BATAL.bertautKas);
    expect(PESAN_BATAL.bertautKas).toMatch(/mutasi kas/);
  });

  it("🔴 hari tertutup → ditolak (Rilis 1: pembalikan menyusul)", () => {
    expect(periksaBatal(baris({ hariTutup: true }), ok, KODE)).toBe(PESAN_BATAL.hariTutup);
  });

  it("🔴 bulan tertutup (K5 maupun buku besar) → ditolak", () => {
    expect(periksaBatal(baris({ bulanTutup: true }), ok, KODE)).toBe(PESAN_BATAL.bulanTutup);
  });

  it("sudah dibatalkan → ditolak", () => {
    expect(periksaBatal(baris({ void: true }), ok, KODE)).toBe(PESAN_BATAL.sudahBatal);
  });

  it("kode di luar grup void / kosong → ditolak; alasan < 5 huruf atau spasi → ditolak", () => {
    expect(periksaBatal(baris(), { ...ok, reasonCode: "ADJ-DUP" }, KODE)).toBe(PESAN_BATAL.kode);
    expect(periksaBatal(baris(), { ...ok, reasonCode: "" }, KODE)).toBe(PESAN_BATAL.kode);
    expect(periksaBatal(baris(), { ...ok, alasan: "   " }, KODE)).toBe(PESAN_BATAL.alasan);
    expect(periksaBatal(baris(), { ...ok, alasan: "dup" }, KODE)).toBe(PESAN_BATAL.alasan);
  });

  it("urutan: asal-usul baris diperiksa SEBELUM isian (pesan yang menunjuk jalur benar menang)", () => {
    expect(periksaBatal(baris({ sourceDoor: "pengawas" }), { reasonCode: "", alasan: "" }, KODE)).toBe(
      PESAN_BATAL.pengawas,
    );
  });
});

describe("dampakBatal — perubahan laba bersih bila baris dibatalkan (U4)", () => {
  it("beban 7.560 dibatalkan → laba naik 7.560", () => {
    expect(dampakBatal("pengeluaran", "7-1200", 7_560)).toBe(7_560);
  });
  it("pendapatan lain 6-9900 50.000 dibatalkan → laba turun 50.000 (6-9900 dari pintu Finance tetap pendapatan, R26)", () => {
    expect(dampakBatal("pendapatan_lain", "6-9900", 50_000)).toBe(-50_000);
  });
  it("🔴 titipan outlet (§10.27) bukan laba → 0, sama dengan laporan (tinjauan kode)", () => {
    expect(dampakBatal("pendapatan_lain", "4200", 50_000, true)).toBe(0);
  });
  it("baris yang sudah direklas ke akun bukan-laba (1-1800) → 0 (AE2)", () => {
    expect(dampakBatal("pengeluaran", "1-1800", 30_000)).toBe(0);
    expect(dampakBatal("pendapatan_lain", "1-1800", 50_000)).toBe(0);
  });
});

describe("periksaAjukanBalik — pengajuan Balik hari tertutup (rencana 2026-11-07 R8, R12)", () => {
  const KODE_ADJ = new Set(["ADJ-DUP", "ADJ-AMOUNT", "ADJ-DATE", "ADJ-PARTY"]);
  const bb = (o: Partial<BarisBalik> = {}): BarisBalik => ({
    sourceDoor: "finance",
    void: false,
    cashLedgerId: null,
    hariTutup: true,
    bulanTutup: false,
    dibalik: false,
    menunggu: false,
    ...o,
  });
  const isi = { reasonCode: "ADJ-DUP", alasan: "ganda dengan MDR otomatis settlement" };

  it("baris Finance di hari tertutup → boleh diajukan", () => {
    expect(periksaAjukanBalik(bb(), isi, KODE_ADJ)).toBeNull();
  });
  it("🔴 hari masih terbuka → pakai Batalkan, bukan Balik", () => {
    expect(periksaAjukanBalik(bb({ hariTutup: false }), isi, KODE_ADJ)).toBe(PESAN_BALIK.hariTerbuka);
  });
  it("🔴 pengawas / bertaut kas / void / bulan tertutup → ditolak dengan jalurnya", () => {
    expect(periksaAjukanBalik(bb({ sourceDoor: "pengawas" }), isi, KODE_ADJ)).toBe(PESAN_BALIK.pengawas);
    expect(periksaAjukanBalik(bb({ cashLedgerId: "k" }), isi, KODE_ADJ)).toBe(PESAN_BALIK.bertautKas);
    expect(periksaAjukanBalik(bb({ void: true }), isi, KODE_ADJ)).toBe(PESAN_BALIK.sudahBatal);
    expect(periksaAjukanBalik(bb({ bulanTutup: true }), isi, KODE_ADJ)).toBe(PESAN_BALIK.bulanTutup);
  });
  it("🔴 sudah dibalik / sudah ada pengajuan menunggu → ditolak", () => {
    expect(periksaAjukanBalik(bb({ dibalik: true }), isi, KODE_ADJ)).toBe(PESAN_BALIK.sudahDibalik);
    expect(periksaAjukanBalik(bb({ menunggu: true }), isi, KODE_ADJ)).toBe(PESAN_BALIK.sudahMenunggu);
  });
  it("kode harus dari daftar koreksi (bukan VOID-*, bukan ADJ-FWD-*); alasan ≥ 5 huruf", () => {
    expect(periksaAjukanBalik(bb(), { ...isi, reasonCode: "VOID-DUP" }, KODE_ADJ)).toBe(PESAN_BALIK.kode);
    expect(periksaAjukanBalik(bb(), { ...isi, reasonCode: "ADJ-FWD-REVERSAL" }, KODE_ADJ)).toBe(PESAN_BALIK.kode);
    expect(periksaAjukanBalik(bb(), { ...isi, alasan: "  ab " }, KODE_ADJ)).toBe(PESAN_BALIK.alasan);
  });
});

describe("ringkasDibalik — dampak Balik ditampilkan terpisah dari selisih beku (R12b)", () => {
  const r = (o: Partial<BarisDibalik>): BarisDibalik => ({
    keterangan: "x",
    section: "pengeluaran",
    akun: "7-1200",
    amount: 0,
    kode: "ADJ-DUP",
    alasan: "ganda",
    pengaju: null,
    penyetuju: null,
    waktu: "2026-11-07 09:00",
    titipan: false,
    ...o,
  });
  it("Bakau 2 Okt: tiga baris ganda dibalik → laba bersih hari itu −12.440", () => {
    expect(
      ringkasDibalik([
        r({ amount: 7_560 }),
        r({ amount: 30_000, akun: "6-9100" }),
        r({ amount: 50_000, section: "pendapatan_lain", akun: "6-9900" }),
      ]),
    ).toEqual({ n: 3, dampakLaba: 7_560 + 30_000 - 50_000 });
  });
  it("kosong → nol, bukan null", () => {
    expect(ringkasDibalik([])).toEqual({ n: 0, dampakLaba: 0 });
  });
});
