import { describe, expect, it } from "vitest";
import { shiftGroupDates, shiftGroupLabel } from "./piutang-route";

const kelompok = {
  sourceCycleSequence: "206",
  selisihAbsolut: 895_667_391,
  peristiwa: [
    { asOfDate: "2026-04-30" }, { asOfDate: "2026-05-31" },
    { asOfDate: "2026-06-30" }, { asOfDate: "2026-07-31" },
    { asOfDate: "2026-08-31" }, { asOfDate: "2026-09-08" },
    { asOfDate: "2026-09-09" },
  ],
};

describe("label kelompok koreksi", () => {
  // 🔴 Tombol yang menyembunyikan cakupannya = persetujuan borongan senyap
  // dengan nama lain. Itu yang dilarang, bukan jumlah kliknya.
  it("MENYEBUT jumlah tanggal dan rupiahnya", () => {
    const label = shiftGroupLabel(kelompok);
    expect(label).toContain("7 tanggal");
    expect(label).toContain("895.667.391");
    expect(label).toContain("206");
  });

  it("tiap tanggal dapat ditampilkan, bukan hanya jumlahnya", () => {
    const teks = shiftGroupDates(kelompok);
    for (const p of kelompok.peristiwa) expect(teks).toContain(p.asOfDate);
  });

  it("satu tanggal tetap terbaca wajar — tidak ada bentuk khusus yang hilang", () => {
    const satu = { ...kelompok, peristiwa: [{ asOfDate: "2026-08-31" }], selisihAbsolut: 1_800_000 };
    expect(shiftGroupLabel(satu)).toContain("1 tanggal");
    expect(shiftGroupDates(satu)).toBe("2026-08-31");
  });
});
