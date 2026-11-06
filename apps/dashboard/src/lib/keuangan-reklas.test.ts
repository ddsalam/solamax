import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bebanPerPos, kumpulkanBeban, pilahManualEntry, type BarisManualLaporan } from "./keuangan-beban";
import { canInputKeuangan, canReklasifikasi } from "./keuangan-wewenang";
import { panelBalance, panelCashFlow } from "./keuangan-laporan-model";
import {
  AKUN_KOSONG,
  AKUN_REKLAS,
  akunPintuFinance,
  dampakLaba,
  jenisAkun,
  KODE_LAMA_POS,
  KODE_PENDAPATAN_LAIN,
  kodePos,
  labelAkun,
  labelPos,
  periksaReklas,
  POS_BIAYA,
  type CekReklas,
} from "./keuangan-reklas";

const baris = (o: Partial<BarisManualLaporan>): BarisManualLaporan => ({
  businessDate: "2026-10-02",
  accountingAccount: null,
  amountRp: 1_000_000,
  keterangan: "x",
  void: false,
  section: "pengeluaran",
  operationalCategory: null,
  ...o,
});

describe("jenisAkun — baris yang tak pernah direklasifikasi TIDAK berubah perilakunya", () => {
  it("akun kosong / di luar daftar mengikuti seksi", () => {
    expect(jenisAkun(null, "pengeluaran")).toBe("beban");
    expect(jenisAkun(null, "pendapatan_lain")).toBe("pendapatan");
    expect(jenisAkun("9-9999", "pengeluaran")).toBe("beban");
  });
  it("dua akun bukan-laba dikenali", () => {
    expect(jenisAkun("3-9100", "pengeluaran")).toBe("ekuitas");
    expect(jenisAkun("1-1800", "pengeluaran")).toBe("pindah_dana");
  });
  it("label akun", () => {
    expect(labelAkun("6-9900")).toBe("6-9900 Beban Lain-Lain");
    expect(labelAkun(null)).toBe("belum dipetakan");
    expect(labelAkun(AKUN_KOSONG)).toBe("belum dipetakan");
  });
});

describe("daftar akun = bagan §10.3, tak menyimpang dari pemetaan 0023", () => {
  it("setiap akun di category_account_map ada di daftar reklasifikasi", () => {
    const sql = readFileSync(
      resolve(__dirname, "../../../backend/prisma/migrations/0023_category_account_map/migration.sql"),
      "utf8",
    );
    const kode = [...sql.matchAll(/'(\d-\d{4})'/g)].map((m) => m[1]!);
    expect(kode.length).toBeGreaterThan(10); // jangan hijau karena kosong
    const daftar = new Set(AKUN_REKLAS.map((a) => a.kode));
    for (const k of kode) expect(daftar, k).toContain(k);
  });
  it("kode unik", () => {
    expect(new Set(AKUN_REKLAS.map((a) => a.kode)).size).toBe(AKUN_REKLAS.length);
  });
});

describe("pilahManualEntry — akun efektif menentukan rumah baris (§10.29)", () => {
  const hari = [
    baris({ keterangan: "PERBAIKAN GENSET", amountRp: 300_000 }),
    baris({ keterangan: "PRIVE", amountRp: 5_000_000, accountingAccount: "3-9100" }),
    baris({ keterangan: "PAK ATHOI SETOR TUNAI", amountRp: 70_000_000, accountingAccount: "1-1800" }),
    baris({ keterangan: "BATAL", amountRp: 9_000_000, accountingAccount: "3-9100", void: true }),
    baris({ section: "pendapatan_lain", keterangan: "JUAL KARDUS", amountRp: 50_000 }),
    baris({ section: "pendapatan_lain", keterangan: "LEBIH SETOR", amountRp: 16_000, accountingAccount: "1-1800" }),
  ];
  const p = pilahManualEntry(hari);

  it("hanya beban yang masuk beban", () => {
    expect(p.manualBeban.map((b) => b.keterangan)).toEqual(["PERBAIKAN GENSET"]);
  });
  it("pendapatan lain tanpa baris pindah dana", () => {
    expect(p.pendapatanLain).toBe(50_000);
  });
  it("kontribusi = prive aktif saja (yang dibatalkan tidak)", () => {
    expect(p.kontribusi).toBe(5_000_000);
  });
  it("pindah dana dicatat terpisah — bukan laba, bukan kontribusi", () => {
    expect(p.pindahDana).toBe(70_016_000);
  });
});

describe("🔴 neraca harian TETAP seimbang saat prive keluar dari laba", () => {
  // Prive Rp 5 jt: kas turun 5 jt. Sebagai BEBAN: laba −5 jt, aset −5 jt ⇒ 0.
  // Sesudah reklasifikasi: laba 0, kontribusi 5 jt, aset −5 jt ⇒ HARUS tetap 0.
  const bs = (netIncome: number, deltaKontribusi: number) =>
    panelBalance({
      sebabKas: null,
      cashOnHand: 95_000_000,
      inventoryValue: 0,
      soValue: 0,
      piutangEasymax: 0, depositEasymax: 0,
      hutangPiutangNonEasymax: 0,
      penampung: 0,
      temporaryInvestment: 0,
      openedRetainedEarnings: null,
      netIncome,
      incomeAdjustment: null,
      totalAssetKemarin: 100_000_000,
      deltaKontribusi,
      saldoTitipanBright: 0,
    }).langkahHarian;

  it("sebagai beban: seimbang", () => {
    expect(bs(-5_000_000, 0)).toBe(0);
  });
  it("sesudah reklasifikasi ke prive: seimbang lewat deltaKontribusi", () => {
    const p = pilahManualEntry([baris({ amountRp: 5_000_000, accountingAccount: "3-9100" })]);
    expect(p.manualBeban).toHaveLength(0);
    expect(bs(0, p.kontribusi)).toBe(0);
  });
  it("mutan: tanpa deltaKontribusi neraca MEMERAH sebesar prive", () => {
    expect(bs(0, 0)).toBe(5_000_000);
  });
});

describe("arus kas — prive tampil sebagai barisnya sendiri", () => {
  it("baris 'Prive / kontribusi pemilik' bernilai −kontribusi dan ikut net", () => {
    const cf = panelCashFlow({
      sebabKas: null,
      kasAwalPerAkun: [{ nama: "Kas Besar", saldo: 100_000_000 }],
      kasAkhir: 95_000_000,
      omzet: 0,
      teraValue: 0,
      transaksiPiutangEasymax: 0, transaksiDepositEasymax: 0,
      hutangPiutangNonEasymax: 0,
      penebusanSo: 0,
      temporaryInvestment: 0,
      penampung: 0,
      pendapatanLain: 0,
      biayaOperasional: 0,
      arusTitipanBright: 0,
      kontribusiPemilik: 5_000_000,
    });
    expect(cf.baris.find((b) => b.label.startsWith("Prive"))?.nilai).toBe(-5_000_000);
    expect(cf.baris.find((b) => b.label === "Net cash change")?.nilai).toBe(-5_000_000);
    expect(cf.pemeriksa.nilai).toBe(0);
  });
});

describe("dampakLaba — pratinjau di layar", () => {
  it("pengeluaran beban → bukan laba: laba NAIK sebesar nominal", () => {
    expect(dampakLaba("pengeluaran", null, "3-9100", 5_000_000)).toBe(5_000_000);
    expect(dampakLaba("pengeluaran", "6-9900", "1-1800", 70_000_000)).toBe(70_000_000);
  });
  it("balik dari bukan laba → beban: laba TURUN", () => {
    expect(dampakLaba("pengeluaran", "3-9100", "6-9900", 5_000_000)).toBe(-5_000_000);
  });
  it("antar akun beban: tak berubah", () => {
    expect(dampakLaba("pengeluaran", "6-9900", "6-2300", 300_000)).toBe(0);
  });
  it("pendapatan lain → pindah dana: laba TURUN", () => {
    expect(dampakLaba("pendapatan_lain", null, "1-1800", 16_000)).toBe(-16_000);
  });
});

describe("periksaReklas — satu pemeriksa untuk server & layar", () => {
  const ok: CekReklas = {
    section: "pengeluaran",
    void: false,
    status: "submitted",
    titipanBright: false,
    dari: null,
    ke: "3-9100",
    alasan: "RCL-NATURE",
    alasanSah: new Set(["RCL-NATURE", "RCL-SPLIT", "RCL-MAPDEF"]),
    catatan: "prive ke PT Triguna",
  };
  it("kasus sah", () => expect(periksaReklas(ok)).toBeNull());
  it("baris dibatalkan / draft ditolak", () => {
    expect(periksaReklas({ ...ok, void: true })).toMatch(/dibatalkan/);
    expect(periksaReklas({ ...ok, status: "draft" })).toMatch(/draft/);
  });
  it("hari yang sudah ditutup TETAP boleh (§2.3 — kapan saja)", () => {
    expect(periksaReklas({ ...ok, status: "closed" })).toBeNull();
  });
  it("titipan Bright ditolak — punya jalurnya sendiri", () => {
    expect(periksaReklas({ ...ok, section: "pendapatan_lain", titipanBright: true })).toMatch(/Titipan/);
  });
  it("akun karangan, akun beban untuk pendapatan, akun yang sama — ditolak", () => {
    expect(periksaReklas({ ...ok, ke: "9-9999" })).toMatch(/tidak dikenal/);
    expect(periksaReklas({ ...ok, section: "pendapatan_lain", ke: "6-9900" })).toMatch(/beban/);
    expect(periksaReklas({ ...ok, ke: "8-1000" })).toMatch(/pendapatan/);
    expect(periksaReklas({ ...ok, dari: "3-9100" })).toMatch(/sudah berada/);
  });
  it("alasan wajib dari grup reclass", () => {
    expect(periksaReklas({ ...ok, alasan: "CLS-CASH" })).toMatch(/alasan/);
  });
  it("🔴 keluar dari laba WAJIB catatan; antar-beban tidak", () => {
    expect(periksaReklas({ ...ok, catatan: "" })).toMatch(/catatan/);
    expect(periksaReklas({ ...ok, ke: "6-2300", catatan: "" })).toBeNull();
  });
});

describe("server action — baris pengawas TIDAK PERNAH disentuh", () => {
  const src = readFileSync(resolve(__dirname, "reklas-actions.ts"), "utf8");
  const kode = src
    .split("\n")
    .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
    .join("\n");
  it("tak ada UPDATE/DELETE pada manual_entry maupun reclassification", () => {
    expect(kode).not.toMatch(/UPDATE\s+app\./i);
    expect(kode).not.toMatch(/DELETE\s+FROM/i);
  });
  it("satu-satunya tulisan: INSERT ke app.reclassification", () => {
    const ins = [...kode.matchAll(/INSERT INTO (app\.\w+)/g)].map((m) => m[1]);
    expect(ins).toEqual(["app.reclassification"]);
  });
  it("bulan yang ditutup dengan buku besar menolak reklasifikasi SEBELUM INSERT (temuan review #6)", () => {
    expect(kode).toMatch(/t\.buku_besar[\s\S]*AS "bulanBeku"/);
    const tolak = kode.indexOf("if (baris.bulanBeku)");
    expect(tolak).toBeGreaterThan(-1);
    expect(tolak).toBeLessThan(kode.indexOf("INSERT INTO app.reclassification"));
  });
  it("wewenang dicek di server & akun asal dibaca ulang di transaksi", () => {
    expect(kode).toMatch(/canReklasifikasi\(/);
    expect(kode).toMatch(/FROM app\.reclassification[\s\S]*ORDER BY created_at DESC/);
    expect(kode).toMatch(/periksaReklas\(/);
  });
});

describe("canReklasifikasi — staf Keuangan DAN Head of Finance (keputusan owner 27 Sep 2026)", () => {
  const HOF = ["hof@x"];
  it("staf keuangan & super admin (gerbang tulis Layar 3)", () => {
    expect(canReklasifikasi({ role: "keuangan", email: "staf@x" }, HOF)).toBe(true);
    expect(canReklasifikasi({ role: "super_admin", email: "a@x" }, HOF)).toBe(true);
  });
  it("🔴 Head of Finance BOLEH — apa pun perannya (kasus produksi: Admin Perusahaan)", () => {
    expect(canReklasifikasi({ role: "admin_perusahaan", email: "hof@x" }, HOF)).toBe(true);
    expect(canReklasifikasi({ role: "keuangan", email: "hof@x" }, HOF)).toBe(true);
  });
  it("…tetapi pengecualiannya SEMPIT: HoF tetap tidak boleh input harian (§10.12)", () => {
    expect(canInputKeuangan({ role: "admin_perusahaan", email: "hof@x" }, HOF)).toBe(false);
    expect(canInputKeuangan({ role: "keuangan", email: "hof@x" }, HOF)).toBe(false);
  });
  it("bukan pengawas, direksi, atau admin perusahaan biasa", () => {
    for (const role of ["pengawas", "direksi", "admin_perusahaan"] as const) {
      expect(canReklasifikasi({ role, email: "a@x" }, HOF), role).toBe(false);
    }
  });
  it("layar memakai gerbang yang SAMA dengan server — bukan bolehTulis", () => {
    const panel = readFileSync(resolve(__dirname, "../components/keuangan/BiayaPanel.tsx"), "utf8");
    expect(panel).toMatch(/const bisaReklas = bolehReklas && /);
    const hal = readFileSync(
      resolve(__dirname, "../app/(app)/keuangan/unit/[code]/[date]/input/page.tsx"),
      "utf8",
    );
    expect(hal).toMatch(/bolehReklas=\{canReklasifikasi\(/);
  });
});

// ---------------------------------------------------------------------------
// Rencana K6 U2 (R26, AE7) — pendapatan lain-lain dari pintu Finance dulu
// tersimpan berkode beban (peta kategori hanya berisi pos beban), lalu hilang
// dari laba: bukan pendapatan karena kodenya beban, bukan beban karena
// seksinya pendapatan. Nominal ilustratif.
// ---------------------------------------------------------------------------

describe("🔴 R26 — seksi pendapatan_lain SELALU pendapatan, apa pun kode tersimpannya", () => {
  it("Covers AE7. Pendapatan lain Rp 750.000 berkode lama 6-9900 terhitung di pendapatan lain-lain", () => {
    const p = pilahManualEntry([
      baris({ section: "pendapatan_lain", keterangan: "PENDAPATAN LAIN", amountRp: 750_000, accountingAccount: "6-9900" }),
    ]);
    expect(p.pendapatanLain).toBe(750_000);
    expect(p.manualBeban).toHaveLength(0);
  });
});

describe("R26 — yang TIDAK boleh ikut berubah", () => {
  it("pengeluaran berkode 6-xxxx tetap beban", () => {
    const p = pilahManualEntry([baris({ keterangan: "LISTRIK", amountRp: 400_000, accountingAccount: "6-2400" })]);
    expect(p.manualBeban.map((b) => b.amountRp)).toEqual([400_000]);
    expect(p.pendapatanLain).toBe(0);
  });
  it("reklasifikasi ke 8-1000 lama tetap pendapatan", () => {
    expect(jenisAkun("8-1000", "pendapatan_lain")).toBe("pendapatan");
    const p = pilahManualEntry([baris({ section: "pendapatan_lain", amountRp: 120_000, accountingAccount: "8-1000" })]);
    expect(p.pendapatanLain).toBe(120_000);
  });
  it("pos baru 4200 / 5300 berjenis sesuai seksinya", () => {
    expect(jenisAkun("4200", "pendapatan_lain")).toBe("pendapatan");
    expect(jenisAkun("5300", "pengeluaran")).toBe("beban");
    const p = pilahManualEntry([
      baris({ section: "pendapatan_lain", amountRp: 750_000, accountingAccount: "4200" }),
      baris({ amountRp: 400_000, accountingAccount: "5300" }),
    ]);
    expect(p.pendapatanLain).toBe(750_000);
    expect(p.manualBeban.map((b) => b.amountRp)).toEqual([400_000]);
  });
  it("akun bukan-laba tetap menang atas seksi — reklasifikasi prive/pindah dana tidak terhapus", () => {
    expect(jenisAkun("3-9100", "pendapatan_lain")).toBe("ekuitas");
    expect(jenisAkun("1-1800", "pendapatan_lain")).toBe("pindah_dana");
    expect(jenisAkun("3300", "pengeluaran")).toBe("ekuitas");
    expect(jenisAkun("1190", "pengeluaran")).toBe("pindah_dana");
  });
});

describe("R26 — baris baru pendapatan lain-lain pintu Finance menyimpan 4200", () => {
  it("pendapatan lain TIDAK memakai peta kategori beban", () => {
    expect(KODE_PENDAPATAN_LAIN).toBe("4200");
    expect(akunPintuFinance("pendapatan_lain", "5700")).toBe("4200");
    expect(akunPintuFinance("pendapatan_lain", null)).toBe("4200");
  });
  it("pengeluaran tetap memakai hasil peta", () => {
    expect(akunPintuFinance("pengeluaran", "5300")).toBe("5300");
    expect(akunPintuFinance("pengeluaran", null)).toBeNull();
  });
  it("0056 benar-benar punya pos 4200 berjenis pendapatan", () => {
    expect(POS_BIAYA["4200"]).toEqual({ nama: "Pendapatan Lain-lain", jenis: "pendapatan" });
  });
});

describe("label & kelompok pos — kode lama dan kode baru duduk di pos yang SAMA", () => {
  it("5300 baru dan 6-2400 lama berlabel sama", () => {
    expect(labelPos("5300")).toBe("5300 Beban Listrik, Air, Internet");
    expect(labelPos("6-2400")).toBe(labelPos("5300"));
    expect(kodePos("6-2400")).toBe("5300");
    expect(kodePos("8-1000")).toBe("4200");
  });
  it("labelAkun mengenali kode empat digit — tidak lagi kode telanjang", () => {
    expect(labelAkun("5300")).toBe("5300 Beban Listrik, Air, Internet");
    expect(labelAkun("4200")).toBe("4200 Pendapatan Lain-lain");
    // Kode lama tetap berlabel lamanya (riwayat: "semula 6-2400 …").
    expect(labelAkun("6-2400")).toBe("6-2400 Utilitas & Prasarana");
  });
  it("kode tak dikenal / kosong tidak dikarang", () => {
    expect(kodePos("9-9999")).toBeNull();
    expect(kodePos(null)).toBeNull();
    expect(labelPos("9-9999")).toBe("9-9999");
    expect(labelPos(null)).toBe("belum dipetakan");
  });
  it("beban 6-2400 lama dan 5300 baru dijumlah dalam SATU kelompok", () => {
    const beban = kumpulkanBeban(
      {
        manual_entry: [
          { businessDate: "2026-11-01", accountingAccount: "6-2400", amountRp: 400_000, keterangan: "a", void: false },
          { businessDate: "2026-11-05", accountingAccount: "5300", amountRp: 250_000, keterangan: "b", void: false },
          { businessDate: "2026-11-05", accountingAccount: null, amountRp: 10_000, keterangan: "c", void: false },
          { businessDate: "2026-11-05", accountingAccount: "9-9999", amountRp: 5_000, keterangan: "d", void: false },
        ],
        noncash_expense: [],
      },
      "2026-11-01",
      "2026-11-30",
    );
    const m = bebanPerPos(beban);
    expect(m.get("5300")).toBe(650_000);
    expect(m.has("6-2400")).toBe(false);
    // Yang tak berpos TIDAK dibuang — tetap di kuncinya sendiri.
    expect(m.get(null)).toBe(10_000);
    expect(m.get("9-9999")).toBe(5_000);
    expect([...m.values()].reduce((a, b) => a + b, 0)).toBe(665_000);
  });
});

describe("POS_BIAYA & KODE_LAMA_POS = cermin seed 0056 — tak boleh menyimpang", () => {
  const sql = readFileSync(
    resolve(__dirname, "../../../backend/prisma/migrations/0056_pos/migration.sql"),
    "utf8",
  ).replace(/--.*$/gm, "");
  const blok = (tabel: string): string =>
    new RegExp(`INSERT INTO "app"\\."${tabel}"[\\s\\S]*?ON CONFLICT`).exec(sql)?.[0] ?? "";
  const pos = new Map(
    [...blok("pos").matchAll(/\(\s*'(\d{4})',\s*'([^']+)',\s*'(\w+)',\s*(true|false)/g)].map((m) => [
      m[1]!,
      { nama: m[2]!, jenis: m[3]!, induk: m[4] === "true" },
    ]),
  );
  const lama = [...blok("pos_kode_lama").matchAll(/\(\s*'(\d-\d{4})'\s*,\s*'(\d{4})'\s*\)/g)].map(
    (m) => [m[1]!, m[2]!] as const,
  );

  it("seed terbaca (jangan hijau karena kosong)", () => {
    expect(pos.size).toBeGreaterThan(40);
    expect(lama.length).toBe(17);
  });
  it("setiap pos kelas 4 & 5 ada dengan nama & jenis yang sama", () => {
    const laba = [...pos].filter(([k]) => k.startsWith("4") || k.startsWith("5"));
    expect(laba.length).toBeGreaterThan(10);
    for (const [k, p] of laba) expect(POS_BIAYA[k], k).toEqual({ nama: p.nama, jenis: p.jenis });
  });
  it("dua pos bukan-laba tujuan kode lama: 3300 ekuitas, 1190 pindah dana", () => {
    expect(POS_BIAYA["3300"]).toEqual({ nama: pos.get("3300")!.nama, jenis: "ekuitas" });
    expect(POS_BIAYA["1190"]).toEqual({ nama: pos.get("1190")!.nama, jenis: "pindah_dana" });
    expect(Object.keys(POS_BIAYA).sort()).toEqual(
      [...pos.keys()].filter((k) => k.startsWith("4") || k.startsWith("5") || k === "3300" || k === "1190").sort(),
    );
  });
  it("peta kode lama sama persis dengan pos_kode_lama", () => {
    expect(KODE_LAMA_POS).toEqual(Object.fromEntries(lama));
  });
  it("setiap tujuan reklasifikasi lama punya pos yang jenisnya sejalan", () => {
    for (const a of AKUN_REKLAS) {
      const tujuan = POS_BIAYA[kodePos(a.kode)!];
      expect(tujuan, a.kode).toBeDefined();
      expect(tujuan!.jenis, a.kode).toBe(a.jenis);
    }
  });
});
