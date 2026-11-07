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
  akunAsli: "6-9100",
  titipanBright: false,
  status: "submitted",
  sourceDoor: "pengawas",
  void: false,
  bertautKas: false,
  hariTutup: false,
  voidAt: null,
  voidOleh: null,
  voidReasonCode: null,
  voidAlasan: null,
  dibalik: false,
  balik: null,
  ...o,
});

describe("tindakanTersedia — tindakan bernama, dan TIDAK ADA edit", () => {
  it("🔴 `edit` bukan salah satu tindakan — sekarang maupun nanti (§2.3)", () => {
    // Rencana 2026-11-07: Batalkan (void beralasan, hari terbuka, pintu Finance)
    // ditambahkan atas keputusan Dion. Tetap bukan Edit — nominal tak berubah.
    expect([...TINDAKAN]).toEqual(["review", "return", "reclassify", "batalkan", "correct"]);
    expect(TINDAKAN as readonly string[]).not.toContain("edit");
    expect(Object.values(LABEL_TINDAKAN).join(" ")).not.toMatch(/edit/i);
  });

  it("draft: Finance belum melihatnya, jadi tak ada tindakan", () => {
    expect(tindakanTersedia(b({ status: "draft" }))).toEqual([]);
  });

  it("submitted dari pengawas: tinjau · kembalikan · reklasifikasi", () => {
    expect(tindakanTersedia(b())).toEqual(["review", "return", "reclassify"]);
  });

  it("🔴 baris pintu FINANCE tak punya 'kembalikan' — tak ada pengawas yang dituju; ia punya Batalkan", () => {
    // Tombol yang tak punya tujuan lebih buruk daripada tombol yang tak ada.
    expect(tindakanTersedia(b({ sourceDoor: "finance" }))).toEqual(["review", "reclassify", "batalkan"]);
  });

  it("🔴 baris Finance bertaut mutasi kas: tak ada Batalkan (batalkan lewat mutasi asal)", () => {
    expect(tindakanTersedia(b({ sourceDoor: "finance", bertautKas: true }))).toEqual(["review", "reclassify"]);
  });

  it("🔴 baris pengawas tak pernah ditawari Batalkan", () => {
    expect(tindakanTersedia(b())).not.toContain("batalkan");
  });

  it("🔴 hari TERTUTUP (day_close) — bukan hanya status baris — memberi reklasifikasi & koreksi saja", () => {
    // status baris tak pernah di-set 'closed' oleh aplikasi; yang menutup hari adalah day_close.
    expect(tindakanTersedia(b({ sourceDoor: "finance", hariTutup: true }))).toEqual(["reclassify", "correct"]);
    expect(tindakanTersedia(b({ hariTutup: true }))).toEqual(["reclassify"]);
  });

  it("🔴 Balik (rencana 2026-11-07 Rilis 2): bertaut kas di hari tertutup tak ditawari; baris DIBALIK tak punya tindakan", () => {
    expect(tindakanTersedia(b({ sourceDoor: "finance", hariTutup: true, bertautKas: true }))).toEqual(["reclassify"]);
    expect(tindakanTersedia(b({ sourceDoor: "finance", hariTutup: true, dibalik: true, void: true }))).toEqual([]);
  });

  it("🔴 baris dibalik tidak ikut total pintu (void = TIDAK BERLAKU dari kueri)", () => {
    const rows = [b({ sourceDoor: "finance", amount: 7_560, void: true, dibalik: true }), b({ sourceDoor: "finance", amount: 1_000 })];
    expect(totalPerPintu(rows).finance).toBe(-1_000);
  });

  it("closed: transaksi asli beku — pengawas hanya reklasifikasi (Balik pengawas ditunda), Finance + koreksi", () => {
    expect(tindakanTersedia(b({ status: "closed" }))).toEqual(["reclassify"]);
    expect(tindakanTersedia(b({ status: "closed", sourceDoor: "finance" }))).toEqual(["reclassify", "correct"]);
  });

  it("baris void tak menawarkan tindakan apa pun", () => {
    expect(tindakanTersedia(b({ void: true }))).toEqual([]);
  });
});

describe("dua pintu, satu daftar (§2.4)", () => {
  it("total per pintu dipisah, dan keduanya menyumbang", () => {
    // Nominal tersimpan POSITIF (konvensi tunggal, 26 Sep 2026); tanda dari seksi.
    const rows = [b({ amount: 500_000 }), b({ sourceDoor: "finance", amount: 300_000 })];
    const t = totalPerPintu(rows);
    expect(t).toEqual({ pengawas: -500_000, finance: -300_000 });
    for (const p of PINTU_BIAYA) expect(t[p]).not.toBe(0);
  });

  it("baris void tidak ikut total", () => {
    const rows = [b({ amount: 500_000 }), b({ amount: 9_000_000, void: true })];
    expect(totalPerPintu(rows).pengawas).toBe(-500_000);
  });

  it("🔴 total per pintu NETO — pendapatan tidak ditambahkan ke biaya", () => {
    // Review #397: sesudah konvensi positif, menjumlah `amount` apa adanya
    // membuat biaya 500 rb + pendapatan 200 rb terbaca 700 rb.
    const rows = [b({ amount: 500_000 }), b({ section: "pendapatan_lain", amount: 200_000 })];
    expect(totalPerPintu(rows).pengawas).toBe(-300_000);
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
