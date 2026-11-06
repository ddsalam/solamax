import { describe, expect, it } from "vitest";
import { dampakBatal, periksaBatal, PESAN_BATAL, type BarisBatal } from "./batal-balik-model";

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
  it("baris yang sudah direklas ke akun bukan-laba (1-1800) → 0 (AE2)", () => {
    expect(dampakBatal("pengeluaran", "1-1800", 30_000)).toBe(0);
    expect(dampakBatal("pendapatan_lain", "1-1800", 50_000)).toBe(0);
  });
});
