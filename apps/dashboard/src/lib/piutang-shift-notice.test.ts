import { describe, expect, it } from "vitest";
import { shiftNotice } from "./piutang-route";

type Shift = Parameters<typeof shiftNotice>[0][number];

function shift(over: Partial<Shift> = {}): Shift {
  return {
    frozen: true,
    acknowledged: false,
    acknowledgedBy: null,
    generationId: "gen-1",
    geserPiutangLokal: -690068731,
    geserPiutangOnline: 0,
    geserHutangLokal: 0,
    ...over,
  };
}

describe("shiftNotice", () => {
  it("tanpa peristiwa: tidak ada indikator", () => {
    expect(shiftNotice([])).toBeUndefined();
  });

  it("pergeseran DI DALAM jendela tidak memunculkan indikator apa pun", () => {
    // Rebuild menyentuh 7 tanggal tiap malam; indikator untuk itu akan jadi
    // tanda yang selalu menyala, dan tanda yang selalu menyala tidak dibaca.
    expect(shiftNotice([shift({ frozen: false })])).toBeUndefined();
  });

  it("beku & belum diakui: memerah dan menyebut RUPIAHNYA", () => {
    const notice = shiftNotice([shift()])!;
    expect(notice.tone).toBe("warning");
    expect(notice.title).toContain("690.068.731");
    expect(notice.menunggu).toEqual([
      { generationId: "gen-1", selisihAbsolut: 690068731 },
    ]);
  });

  it("selisih dijumlahkan sebagai ABSOLUT — dua arah tidak boleh saling meniadakan", () => {
    const notice = shiftNotice([
      shift({ geserPiutangLokal: 1_000, geserHutangLokal: -1_000 }),
    ])!;
    expect(notice.menunggu[0]!.selisihAbsolut).toBe(2_000);
  });

  it("sudah diakui: menghijau, tetapi tetap mengabarkan bahwa angkanya pernah bergerak", () => {
    const notice = shiftNotice([
      shift({ acknowledged: true, acknowledgedBy: "damiandionsalam@gmail.com" }),
    ])!;
    expect(notice.tone).toBe("info");
    expect(notice.menunggu).toEqual([]);
    expect(notice.body).toContain("damiandionsalam@gmail.com");
  });

  // 🔴 SYARAT 4 pada lapis tampilan: persetujuan terikat NILAI, bukan BARIS.
  it("setujui -> geser lagi -> MERAH lagi, dan hanya yang baru yang menunggu", () => {
    const sudah = shift({
      generationId: "gen-1",
      acknowledged: true,
      acknowledgedBy: "damiandionsalam@gmail.com",
    });
    const hijau = shiftNotice([sudah])!;
    expect(hijau.tone).toBe("info");

    // Tanggal yang sama bergerak LAGI: generasi baru, pengakuan lama tak ikut.
    const lagi = shift({ generationId: "gen-2", geserPiutangLokal: 3_732_737 });
    const merah = shiftNotice([lagi, sudah])!;
    expect(merah.tone).toBe("warning");
    expect(merah.menunggu).toEqual([
      { generationId: "gen-2", selisihAbsolut: 3_732_737 },
    ]);
    // Yang sudah diakui TIDAK muncul lagi sebagai tombol.
    expect(merah.menunggu.map((m) => m.generationId)).not.toContain("gen-1");
  });
});
