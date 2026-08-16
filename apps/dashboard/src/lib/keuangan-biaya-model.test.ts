import { describe, expect, it } from "vitest";
import {
  belumBerakun,
  LABEL_TINDAKAN,
  menungguTinjauan,
  PINTU_BIAYA,
  TINDAKAN,
  tindakanTersedia,
  totalPerPintu,
  type BarisBiaya,
} from "./keuangan-biaya-model";

let n = 0;
const b = (o: Partial<BarisBiaya> = {}): BarisBiaya => ({
  id: `b${++n}`,
  section: "pengeluaran",
  keterangan: "biaya",
  amount: -500_000,
  operationalCategory: "Biaya Taktis",
  accountingAccount: "6-9100",
  status: "submitted",
  sourceDoor: "pengawas",
  void: false,
  ...o,
});

describe("tindakanTersedia — empat tindakan bernama, dan TIDAK ADA edit", () => {
  it("🔴 `edit` bukan salah satu tindakan — sekarang maupun nanti (§2.3)", () => {
    expect([...TINDAKAN]).toEqual(["review", "return", "reclassify", "correct"]);
    expect(TINDAKAN as readonly string[]).not.toContain("edit");
    expect(Object.values(LABEL_TINDAKAN).join(" ")).not.toMatch(/edit/i);
  });

  it("draft: Finance belum melihatnya, jadi tak ada tindakan", () => {
    expect(tindakanTersedia(b({ status: "draft" }))).toEqual([]);
  });

  it("submitted dari pengawas: tinjau · kembalikan · reklasifikasi", () => {
    expect(tindakanTersedia(b())).toEqual(["review", "return", "reclassify"]);
  });

  it("🔴 baris pintu FINANCE tak punya 'kembalikan' — tak ada pengawas yang dituju", () => {
    // Tombol yang tak punya tujuan lebih buruk daripada tombol yang tak ada.
    expect(tindakanTersedia(b({ sourceDoor: "finance" }))).toEqual(["review", "reclassify"]);
  });

  it("closed: hanya reklasifikasi & koreksi — transaksi asli beku", () => {
    expect(tindakanTersedia(b({ status: "closed" }))).toEqual(["reclassify", "correct"]);
  });

  it("baris void tak menawarkan tindakan apa pun", () => {
    expect(tindakanTersedia(b({ void: true }))).toEqual([]);
  });
});

describe("dua pintu, satu daftar (§2.4)", () => {
  it("total per pintu dipisah, dan keduanya menyumbang", () => {
    const rows = [b({ amount: -500_000 }), b({ sourceDoor: "finance", amount: -300_000 })];
    const t = totalPerPintu(rows);
    expect(t).toEqual({ pengawas: -500_000, finance: -300_000 });
    for (const p of PINTU_BIAYA) expect(t[p]).not.toBe(0);
  });

  it("baris void tidak ikut total", () => {
    const rows = [b({ amount: -500_000 }), b({ amount: -9_000_000, void: true })];
    expect(totalPerPintu(rows).pengawas).toBe(-500_000);
  });

  it("daftar pintu bisa DIHITUNG — 'berapa pintu' punya jawaban", () => {
    expect([...PINTU_BIAYA]).toEqual(["pengawas", "finance"]);
    expect(Object.keys(totalPerPintu([])).sort()).toEqual([...PINTU_BIAYA].sort());
  });
});

describe("hitungan untuk kepala blok", () => {
  it("menungguTinjauan hanya yang submitted & non-void", () => {
    const rows = [b(), b({ status: "closed" }), b({ status: "submitted", void: true })];
    expect(menungguTinjauan(rows)).toHaveLength(1);
  });

  it("belumBerakun menandai baris tanpa CoA — beban tanpa rumah di laporan", () => {
    const rows = [b(), b({ accountingAccount: null })];
    expect(belumBerakun(rows)).toHaveLength(1);
  });

  it("kontrol NEGATIF: semua berakun ⇒ kosong", () => {
    expect(belumBerakun([b(), b()])).toEqual([]);
  });
});

describe("daftar pintu: TypeScript ↔ Postgres tidak boleh berselisih", () => {
  it("CHECK di 0034 memuat persis anggota PINTU_BIAYA", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const sql = readFileSync(
      resolve(__dirname, "../../../backend/prisma/migrations/0034_manual_entry_source_door/migration.sql"),
      "utf8",
    );
    const kode = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    const m = kode.match(/CHECK \("source_door" IN \(([^)]*)\)\)/);
    expect(m, "CHECK source_door tidak ditemukan sebagai pernyataan utuh").not.toBeNull();
    const daftar = [...m![1]!.matchAll(/'(\w+)'/g)].map((x) => x[1]!);
    expect([...daftar].sort()).toEqual([...PINTU_BIAYA].sort());
  });
});
