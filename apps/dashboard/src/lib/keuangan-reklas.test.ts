import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pilahManualEntry, type BarisManualLaporan } from "./keuangan-beban";
import { canInputKeuangan, canReklasifikasi } from "./keuangan-wewenang";
import { panelBalance, panelCashFlow } from "./keuangan-laporan-model";
import {
  AKUN_KOSONG,
  AKUN_REKLAS,
  dampakLaba,
  jenisAkun,
  labelAkun,
  periksaReklas,
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
      piutangEasymax: 0,
      hutangPiutangNonEasymax: 0,
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
      transaksiPiutangEasymax: 0,
      hutangPiutangNonEasymax: 0,
      penebusanSo: 0,
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
