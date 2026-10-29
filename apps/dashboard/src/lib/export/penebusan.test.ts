import { describe, expect, it } from "vitest";
import { penebusanCsv } from "./penebusan";
import type { PenebusanTampil } from "@/lib/penebusan-queries";

const baris = (o: Partial<PenebusanTampil>): PenebusanTampil => ({
  id: "p",
  unitCode: "6378301",
  noSo: "so-1",
  tanggalBayar: "2026-10-02",
  rekening: "Bank BCA - 5125036811",
  netSen: 10_000_000_000,
  ppnSen: 1_100_000_000,
  pphSen: 25_000_000,
  pbbkbSen: 750_000_000,
  notaSen: 0,
  grossSen: 11_875_000_000,
  kasDibuat: true,
  hariBuku: "2026-10-02",
  tertaut: true,
  produk: "Pertalite",
  volume: 16000,
  ...o,
});

describe("CSV rekap pajak penebusan (R13)", () => {
  const csv = penebusanCsv({
    judulCakupan: "Bakau (63.783.01)",
    ptLabel: "PT Sola Petra Abadi",
    bulan: "2026-10",
    rows: [
      baris({ noSo: "so-1" }),
      baris({ noSo: "so-2", tertaut: false, produk: null, volume: null, netSen: 100_00, ppnSen: 11_00, pphSen: 0, pbbkbSen: 5_00, notaSen: -1_00, grossSen: 115_00 }),
    ],
    generatedLabel: "29 Okt 2026 20.00 WIB",
    generatedBy: "staf@solagroup.co",
  });
  const baris2 = csv.split("\r\n");

  it("🔴 total PPN/PPh/PBBKB = Σ penebusan bulan itu; daftar SO ikut", () => {
    const total = baris2.find((l) => l.startsWith("Total,"))!;
    expect(total).toBe("Total,2,100000100.00,11000011.00,250000.00,7500005.00,-1.00,118750115.00");
    expect(baris2.some((l) => l.startsWith("6378301,so-1,2026-10-02,Pertalite,16000,"))).toBe(true);
    expect(baris2.some((l) => l.startsWith("6378301,so-2,2026-10-02,belum tertaut,belum tertaut,"))).toBe(true);
  });

  it("⛔ tanpa keterangan bank / nama rekening", () => {
    expect(csv).not.toMatch(/Bank BCA|5125036811|rekening/i);
  });

  it("BOM + CRLF (csv.ts)", () => {
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});
