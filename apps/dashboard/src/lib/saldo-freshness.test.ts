import { describe, expect, it } from "vitest";
import { pendingBanner } from "./piutang-route";
import { compareFreshness } from "./saldo-freshness";
import type { SaldoPelanggan, SaldoSnapshot } from "./saldo-snapshot";

/**
 * Kejadian yang dijaga berkas ini NYATA: 13-09-2026, koreksi mundur masuk
 * 08:34/08:38 sesudah cut 02:05, dan layar meleset Rp 35.979.362 selama ±18 jam
 * tanpa satu pun indikator — karena banner lama hanya menyala pada
 * `pending_replacement`, yang hanya dipasang saat ada cut `complete` baru.
 */

const saldo = (pl: number, po: number, hl: number): SaldoPelanggan => ({
  awal: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
  akhir: { piutangLokal: pl, piutangOnline: po, hutangLokal: hl },
} as SaldoPelanggan);

// Angka 13-09-2026 yang sebenarnya, sampai rupiah.
const SNAPSHOT = saldo(13_052_684_187.5, 900_000, -673_010_538);
const HIDUP = saldo(13_088_663_549.5, 900_000, -671_605_538);

function snapshot(pendingReplacement: boolean): Extract<SaldoSnapshot, { status: "ready" }> {
  return {
    status: "ready",
    metadata: {
      generationId: "g1", sourceCompletedAt: "2026-09-12T19:05:15Z",
      pendingReplacement, totals: SNAPSHOT,
    },
  } as unknown as Extract<SaldoSnapshot, { status: "ready" }>;
}

describe("pembanding kesegaran", () => {
  it("menemukan selisih 13-09-2026 SAMPAI RUPIAH", () => {
    const hasil = compareFreshness(HIDUP, SNAPSHOT);
    expect(hasil.material).toBe(true);
    // 35.979.362 piutang + 1.405.000 hutang, dijumlah MUTLAK supaya kenaikan
    // piutang dan penurunan hutang tidak saling menghapus.
    expect(hasil.totalAbsolut).toBe(37_384_362);
    expect(hasil.buckets.map(b => b.bucket)).toEqual(["piutangLokal", "hutangLokal"]);
  });

  it("JUMLAH MUTLAK — selisih berlawanan arah tidak boleh saling menghapus", () => {
    // Kasus 13-09 kebetulan searah (keduanya +), jadi ia TIDAK membedakan
    // jumlah mutlak dari jumlah biasa. Di sini piutang naik 5 juta dan hutang
    // bertambah 5 juta ke arah negatif: jumlah biasa memulangkan NOL, yaitu
    // banner yang diam padahal dua bucket bergeser.
    const hidup = saldo(13_057_684_187.5, 900_000, -678_010_538);
    const hasil = compareFreshness(hidup, SNAPSHOT);
    expect(hasil.buckets.map(b => b.deltaRupiah)).toEqual([5_000_000, -5_000_000]);
    expect(hasil.totalAbsolut).toBe(10_000_000);
    expect(hasil.material).toBe(true);
  });

  it("DIAM ketika hidup dan snapshot sama", () => {
    expect(compareFreshness(SNAPSHOT, SNAPSHOT).material).toBe(false);
  });

  it("DIAM untuk beda di bawah satu rupiah — artefak float, bukan perubahan", () => {
    // Arc ini pernah mengukur deviasi TOTAL artefak numeric 0,0000746.
    const nyaris = saldo(13_052_684_187.5000746, 900_000, -673_010_538);
    expect(compareFreshness(nyaris, SNAPSHOT).material).toBe(false);
  });
});

describe("banner kesegaran", () => {
  it("MENYALA walau pointer tidak pending — inilah lubang 13-09-2026", () => {
    const banner = pendingBanner(snapshot(false), compareFreshness(HIDUP, SNAPSHOT));
    expect(banner).toBeDefined();
    // Rupiahnya harus disebut: pembaca perlu tahu seberapa jauh melesetnya.
    expect(banner!.title).toContain("37.384.362");
    // Batas "tidak beku" WAJIB ikut ke layar. Angka tanggal lampau bergeser
    // saat di-rebuild — IB 13-09 bergeser −536.588.685 pada 15-09 — dan
    // pembaca yang mengira angka historis beku akan salah membacanya.
    expect(banner!.body).toContain("bergeser");
  });

  it("DIAM ketika tidak material dan pointer tidak pending", () => {
    expect(pendingBanner(snapshot(false), compareFreshness(SNAPSHOT, SNAPSHOT))).toBeUndefined();
    expect(pendingBanner(snapshot(false))).toBeUndefined();
  });

  it("tidak menghapus perilaku lama ketika pointer memang pending", () => {
    expect(pendingBanner(snapshot(true))?.title).toContain("Data sedang diperbarui");
  });
});
