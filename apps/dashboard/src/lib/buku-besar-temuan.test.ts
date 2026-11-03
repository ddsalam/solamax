import { describe, expect, it } from "vitest";
import { LABEL_TEMUAN, susunTemuanPembentukan, tautanTemuan } from "./buku-besar-temuan";

describe("temuan pembentukan jurnal — daftar yang bisa ditindaklanjuti", () => {
  it("rincian dari catatan terakhir per hari: urut tanggal, ringkas per jenis terbanyak dulu", () => {
    const r = susunTemuanPembentukan([
      {
        tanggal: "2026-10-05",
        dibentukAt: "x",
        kode: ["belum_tertaut", "harga_beli_kosong"],
        rincian: [
          { kode: "belum_tertaut", pesan: 'Mutasi "Biaya Operasional" tanpa baris Biaya — masuk 1198.', sumberId: "k-1" },
          { kode: "harga_beli_kosong", pesan: "Harga beli UJI belum diisi.", produk: "UJI" },
        ],
      },
      { tanggal: "2026-10-02", dibentukAt: "x", kode: ["belum_tertaut"], rincian: [{ kode: "belum_tertaut", pesan: "Baris Finance tanpa mutasi kas.", sumberId: "m-1" }] },
      { tanggal: "2026-10-03", dibentukAt: "x", kode: [], rincian: [] },
    ]);
    expect(r.total).toBe(3);
    expect(r.baris.map((b) => b.tanggal)).toEqual(["2026-10-02", "2026-10-05", "2026-10-05"]);
    expect(r.ringkas).toEqual([
      { kode: "belum_tertaut", label: LABEL_TEMUAN.belum_tertaut, n: 2 },
      { kode: "harga_beli_kosong", label: LABEL_TEMUAN.harga_beli_kosong, n: 1 },
    ]);
    expect(r.hariTanpaRincian).toEqual([]);
  });

  it("temuan tingkat hari yang sama digabung jadi satu baris berentang; jumlahnya tetap per kemunculan", () => {
    const sama = { kode: "saldo_awal_persediaan_kosong" as const, pesan: "Saldo awal pos 1131/1132 belum diisi." };
    const r = susunTemuanPembentukan(
      ["2026-10-01", "2026-10-02", "2026-10-03"].map((tanggal) => ({ tanggal, dibentukAt: "x", kode: [sama.kode], rincian: [sama] })),
    );
    expect(r.total).toBe(3);
    expect(r.ringkas).toEqual([{ kode: "saldo_awal_persediaan_kosong", label: LABEL_TEMUAN.saldo_awal_persediaan_kosong, n: 3 }]);
    expect(r.baris).toHaveLength(1);
    expect(r.baris[0]).toMatchObject({ tanggal: "2026-10-01", sampai: "2026-10-03", hari: 3 });
  });

  it("catatan lama (hanya kode) tetap terhitung, ditandai tanpa rincian; kode asing dibuang", () => {
    const r = susunTemuanPembentukan([{ tanggal: "2026-10-01", dibentukAt: "x", kode: ["stok_kosong", "stok_kosong", "bukan_kode"], rincian: null }]);
    expect(r.total).toBe(2);
    expect(r.baris.every((b) => b.pesan === null)).toBe(true);
    expect(r.baris).toEqual([expect.objectContaining({ tanggal: "2026-10-01", sampai: "2026-10-01", hari: 1 })]);
    expect(r.hariTanpaRincian).toEqual(["2026-10-01"]);
  });

  it("tautan perbaikan menuju layar yang tepat", () => {
    expect(tautanTemuan("6378301", "2026-10", "2026-10-05", "belum_tertaut").href).toBe("/keuangan/unit/6378301/2026-10-05/input");
    expect(tautanTemuan("6378301", "2026-10", "2026-10-05", "stok_kosong").href).toBe("/keuangan/unit/6378301/2026-10-05");
    expect(tautanTemuan("6378301", "2026-10", "2026-10-05", "sisa_1103_belum_disetujui").href).toBe("/keuangan/unit/6378301/tutup-hari/2026-10-05");
    expect(tautanTemuan("6378301", "2026-10", "2026-10-05", "saldo_awal_persediaan_kosong").href).toBe("/keuangan/unit/6378301/buku-besar/2026-10?tab=saldo-awal");
  });
});
