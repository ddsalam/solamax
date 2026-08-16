import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bebanPerAkun,
  kumpulkanBeban,
  ringkasPerSumber,
  SUMBER_BEBAN,
  totalBeban,
  type SumberBebanInput,
} from "./keuangan-beban";

const manual = (o: Partial<SumberBebanInput["manual_entry"][number]> = {}) => ({
  businessDate: "2026-01-10",
  accountingAccount: "6-9100" as string | null,
  amountRp: 500_000,
  keterangan: "biaya taktis",
  void: false,
  ...o,
});

const nonKas = (o: Partial<SumberBebanInput["noncash_expense"][number]> = {}) => ({
  businessDate: "2026-01-11",
  accountingAccount: "7-1200",
  amountRp: 175_000,
  keterangan: "Pencairan EDC BCA 2026-01-11 — potongan MDR",
  void: false,
  ...o,
});

const dua = (o: Partial<SumberBebanInput> = {}): SumberBebanInput => ({
  manual_entry: [manual()],
  noncash_expense: [nonKas()],
  ...o,
});

describe("kumpulkanBeban — SATU tempat, DUA sumber", () => {
  it("menggabungkan keduanya", () => {
    const b = kumpulkanBeban(dua(), "2026-01-01", "2026-01-31");
    expect(b).toHaveLength(2);
    expect(new Set(b.map((x) => x.sumber))).toEqual(new Set(["manual_entry", "noncash_expense"]));
    expect(totalBeban(b)).toBe(675_000);
  });

  it("🔴 SUMBER TERLEWAT ⇒ totalnya berubah — dan itu harus terlihat", () => {
    // Beban yang hilang dari laporan tidak memunculkan galat apa pun; ia hanya
    // membuat laba terlihat lebih besar. Pasangan pernyataan ini yang membuat
    // "satu sumber tak terbaca" bisa dibedakan dari "sumber itu memang kosong".
    const penuh = totalBeban(kumpulkanBeban(dua(), "2026-01-01", "2026-01-31"));
    const tanpaNonKas = totalBeban(
      kumpulkanBeban(dua({ noncash_expense: [] }), "2026-01-01", "2026-01-31"),
    );
    const tanpaManual = totalBeban(
      kumpulkanBeban(dua({ manual_entry: [] }), "2026-01-01", "2026-01-31"),
    );
    expect(tanpaNonKas).toBeLessThan(penuh);
    expect(tanpaManual).toBeLessThan(penuh);
    expect(tanpaNonKas + tanpaManual).toBe(penuh);
  });

  it("SETIAP sumber benar-benar menyumbang — tak ada yang diam-diam diabaikan", () => {
    // Kalau kelak ada sumber di SUMBER_BEBAN yang lupa dibaca `kumpulkanBeban`,
    // baris ini merah: ringkasannya akan nol untuk sumber itu.
    const r = ringkasPerSumber(kumpulkanBeban(dua(), "2026-01-01", "2026-01-31"));
    for (const s of SUMBER_BEBAN) {
      expect(r[s], `sumber "${s}" tidak menyumbang apa pun`).toBeGreaterThan(0);
    }
  });

  it("daftar sumber bisa DIHITUNG — 'berapa sumber' punya jawaban", () => {
    expect([...SUMBER_BEBAN]).toEqual(["manual_entry", "noncash_expense"]);
    expect(Object.keys(ringkasPerSumber([])).sort()).toEqual([...SUMBER_BEBAN].sort());
  });

  it("baris void disaring DI SINI, sekali", () => {
    const b = kumpulkanBeban(
      { manual_entry: [manual({ void: true })], noncash_expense: [nonKas({ void: true })] },
      "2026-01-01",
      "2026-01-31",
    );
    expect(b).toEqual([]);
  });

  it("rentang inklusif di kedua ujung", () => {
    const s: SumberBebanInput = {
      manual_entry: [
        manual({ businessDate: "2026-01-01", amountRp: 1 }),
        manual({ businessDate: "2026-01-31", amountRp: 2 }),
        manual({ businessDate: "2026-02-01", amountRp: 4 }),
      ],
      noncash_expense: [],
    };
    expect(totalBeban(kumpulkanBeban(s, "2026-01-01", "2026-01-31"))).toBe(3);
  });
});

describe("bebanPerAkun — yang belum berkategori TIDAK dibuang", () => {
  it("mengelompokkan per CoA", () => {
    const m = bebanPerAkun(kumpulkanBeban(dua(), "2026-01-01", "2026-01-31"));
    expect(m.get("6-9100")).toBe(500_000);
    expect(m.get("7-1200")).toBe(175_000);
  });

  it("🔴 akun NULL dikumpulkan di bawah kunci null, bukan dihapus", () => {
    // Beban yang belum berkategori tetap beban. Membuangnya membuat laba lebih
    // besar tanpa jejak — persis kelas kegagalan yang paling mahal di sini.
    const m = bebanPerAkun(
      kumpulkanBeban(dua({ manual_entry: [manual({ accountingAccount: null })] }), "2026-01-01", "2026-01-31"),
    );
    expect(m.get(null)).toBe(500_000);
    expect([...m.values()].reduce((a, b) => a + b, 0)).toBe(675_000);
  });
});

describe("dua jalur MDR, satu akun 7-1200", () => {
  const migrasi = (n: string) =>
    readFileSync(resolve(__dirname, "../../../backend/prisma/migrations", n, "migration.sql"), "utf8");

  it("jalur MESIN: noncash_expense TIDAK punya kolom operational_category", () => {
    // Bukan NULL karena "belum diisi" — kolomnya TIDAK BERLAKU. Kalau kolomnya
    // tidak ada, tak ada yang bisa salah mengisinya, dan §2.1 tetap mutlak.
    const sql = migrasi("0031_noncash_expense");
    expect(sql).not.toMatch(/"operational_category"/);
  });

  it("jalur MANUSIA: kategori MDR (#13) tetap ada dan tetap memetakan ke 7-1200", () => {
    // Untuk MDR yang ditagih TERPISAH di luar pola potong-di-muka.
    const sql = migrasi("0023_category_account_map");
    expect(sql).toMatch(/\(NULL, 'MDR',\s*'7-1200'/);
  });

  it("keduanya bermuara di akun yang sama", () => {
    const dariMesin = kumpulkanBeban(
      { manual_entry: [], noncash_expense: [nonKas({ accountingAccount: "7-1200" })] },
      "2026-01-01",
      "2026-01-31",
    );
    const dariManusia = kumpulkanBeban(
      { manual_entry: [manual({ accountingAccount: "7-1200", amountRp: 175_000 })], noncash_expense: [] },
      "2026-01-01",
      "2026-01-31",
    );
    expect(bebanPerAkun(dariMesin).get("7-1200")).toBe(175_000);
    expect(bebanPerAkun(dariManusia).get("7-1200")).toBe(175_000);
    // …tetapi ASALNYA tetap bisa dibedakan. Itu yang membuat pertanyaan
    // "siapa yang menaruh ini" tetap punya jawaban.
    expect(dariMesin[0]!.sumber).toBe("noncash_expense");
    expect(dariManusia[0]!.sumber).toBe("manual_entry");
  });
});
