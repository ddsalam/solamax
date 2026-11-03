import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { urutan } from "./penjaga-urutan";

// Rencana K6 U2 (R26) — uji PERILAKU tambahBiayaFinance atas klien tiruan:
// yang diperiksa adalah akun yang benar-benar di-INSERT, bukan teksnya.
const h = vi.hoisted(() => {
  process.env.HEAD_OF_FINANCE_EMAILS = "hof@contoh.test";
  const log: { sql: string; params: unknown[] }[] = [];
  const state = { peta: "5700" as string | null };
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
      if (sql.includes("FROM app.category_account_map")) {
        return { rows: state.peta === null ? [] : [{ account: state.peta }], rowCount: state.peta === null ? 0 : 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release: () => {},
  };
  const connect = vi.fn(async () => client);
  const UNIT = { unit_id: 2, code: "1000001", name: "Contoh" };
  return { log, state, connect, UNIT };
});

vi.mock("./db", () => ({ pool: { connect: h.connect } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./scope", () => ({
  getDataScope: vi.fn(async () => ({
    userId: 7,
    role: "keuangan",
    email: "staf@contoh.test",
    units: [h.UNIT],
    requireUnit: () => h.UNIT,
  })),
}));

const { tambahBiayaFinance } = await import("./biaya-actions");

/**
 * Penjaga TEKS atas `biaya-actions.ts` (Layar 3 blok 4) — dan atas panelnya,
 * untuk satu larangan yang berlaku di keduanya: **tidak ada Edit generik**.
 */
const src = (f: string): string =>
  readFileSync(resolve(__dirname, f), "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n")
    .replace(/--.*$/gm, "");

const KODE = src("biaya-actions.ts");
const PANEL = src("../components/keuangan/BiayaPanel.tsx");

const pernyataan = (teks: string, prefix: string): string => {
  const i = teks.indexOf(prefix);
  if (i < 0) return "";
  const j = teks.indexOf("`", i);
  return teks.slice(i, j < 0 ? undefined : j);
};

describe("biaya-actions — penjagaan yang tak boleh hilang", () => {
  it("penjaga ini punya SUBJEK", () => {
    expect(KODE).toMatch(/export async function tambahBiayaFinance/);
    expect(PANEL).toMatch(/export function BiayaPanel/);
  });

  it("🔴 TIDAK ADA jalan mengubah baris pengawas — bukan sekadar tombolnya disembunyikan", () => {
    // §2.3. Yang dijaga bukan tampilan, melainkan ketiadaan jalannya: satu-
    // satunya DML di berkas ini adalah INSERT lewat pintu Finance.
    expect(KODE).not.toMatch(/UPDATE app\.manual_entry/);
    expect(KODE).not.toMatch(/DELETE FROM/i);
    expect([...KODE.matchAll(/INSERT INTO app\.manual_entry/g)]).toHaveLength(1);
    expect(KODE).not.toMatch(/export async function (edit|ubah|sunting)/i);
  });

  it("🔴 panel tak menawarkan Edit, dan tindakannya dari daftar bersama", () => {
    expect(PANEL).not.toMatch(/>\s*Edit\s*</);
    expect(PANEL).toMatch(/LABEL_TINDAKAN/);
    // Label tindakan tidak diketik ulang di panel — kalau diketik ulang, daftar
    // di model dan yang di layar bisa berselisih tanpa ada yang tahu.
    expect(PANEL).not.toMatch(/"Reklasifikasi"|'Reklasifikasi'/);
  });

  it("asal-usul DITULIS eksplisit, tidak diturunkan dari peran pembuat", () => {
    const ins = pernyataan(KODE, "INSERT INTO app.manual_entry");
    expect(ins, "INSERT tidak ditemukan utuh").not.toBe("");
    expect(ins).toMatch(/source_door/);
    expect(ins).toMatch(/'finance'/);
    // Tak ada join ke user_role di jalur tulis: peran orang berubah, sejarah tidak.
    expect(KODE).not.toMatch(/user_role/);
  });

  it("🔴 CoA DIPETAKAN, tidak diketik", () => {
    // §4.3. CoA bebas ketik membuat dua baris berkategori sama mendarat di akun
    // berbeda, dan peta kategori berhenti berarti apa pun.
    expect(KODE).toMatch(/FROM app\.category_account_map/);
    const masukan = KODE.slice(
      KODE.indexOf("export interface BiayaFinanceInput"),
      KODE.indexOf("}", KODE.indexOf("export interface BiayaFinanceInput")) + 1,
    );
    expect(masukan).toMatch(/operationalCategory/);
    expect(masukan).not.toMatch(/accountingAccount|accounting_account/);
    // Kategori tanpa pemetaan DITOLAK, bukan disimpan tanpa akun.
    expect(KODE).toMatch(/belum punya pemetaan akun akuntansi/);
  });

  it("nominal POSITIF untuk kedua seksi — ARAH ditentukan seksi (konvensi pintu pengawas)", () => {
    // ⛔ KOREKSI 26 Sep 2026. Asersi lama di sini MENUNTUT pengeluaran disimpan
    // negatif ("minus yang terlupa membuat biaya menaikkan laba"). Kekhawatirannya
    // benar, arah pengamannya terbalik: pintu pengawas menyimpan positif, jadi
    // satu kolom memakai dua konvensi — dan laporan yang membalik semuanya
    // menjadikan biaya PENGAWAS penambah laba. Penjaga ini dulu mengunci cacatnya.
    // Konvensi tunggal kini hidup di `manual-entry-nominal.ts` + CHECK 0042.
    expect(KODE).toMatch(/const amount = input\.amountRp;/);
    expect(KODE).not.toMatch(/-input\.amountRp/);
    expect(KODE).toMatch(/input\.amountRp > 0/);
  });

  it("gerbang lewat satu pintu, dan mendahului koneksi", () => {
    expect(KODE).toMatch(/alasanTakBolehInput\(/);
    expect(urutan(KODE, "alasanTakBolehInput(", "pool.connect()")).toBe("ok");
    // 🔴 Bukan hanya "gerbangnya dipanggil" — PENOLAKANNYA harus terjadi.
    // Uji mutasi: menghapus baris `return` ini meninggalkan `const alasan = …`
    // yang tetap cocok dengan asersi lama, jadi penjaga tetap hijau sementara
    // siapa pun boleh menulis. Memanggil pemeriksa tanpa memakai hasilnya
    // adalah bentuk lain dari "hijau tanpa subjek".
    expect(KODE).toMatch(
      /if \(alasan !== null\) return \{ (ok: false, error|boleh: false, error): PESAN_TAK_BOLEH_INPUT\[alasan\] \}/,
    );
    expect(KODE).toMatch(/scope\.requireUnit\(code\)/);
  });

  it("RLS 0016 di-set sebelum DML", () => {
    expect(urutan(KODE, "set_config('app.unit_ids'", "INSERT INTO app.manual_entry")).toBe("ok");
  });
});

describe("R26 — tambahBiayaFinance: akun yang TERSIMPAN", () => {
  beforeEach(() => {
    h.log.length = 0;
    h.state.peta = "5700";
  });
  const masukan = (o: Partial<Parameters<typeof tambahBiayaFinance>[0]> = {}) => ({
    code: h.UNIT.code,
    date: "2026-11-03",
    section: "pendapatan_lain" as const,
    keterangan: "PENDAPATAN LAIN",
    amountRp: 750_000,
    operationalCategory: "Lain-Lain",
    ...o,
  });
  const akunTersimpan = (): unknown => {
    const ins = h.log.find((l) => l.sql.includes("INSERT INTO app.manual_entry"));
    return ins?.params[6];
  };

  it("Covers AE7. pendapatan lain-lain menyimpan 4200 — bukan pos beban hasil peta", async () => {
    expect(await tambahBiayaFinance(masukan())).toEqual({ ok: true });
    expect(akunTersimpan()).toBe("4200");
  });

  it("pendapatan lain-lain tidak ditolak walau kategorinya tanpa peta", async () => {
    h.state.peta = null;
    expect(await tambahBiayaFinance(masukan())).toEqual({ ok: true });
    expect(akunTersimpan()).toBe("4200");
  });

  it("pengeluaran tetap menyimpan pos hasil peta", async () => {
    h.state.peta = "5300";
    expect(await tambahBiayaFinance(masukan({ section: "pengeluaran" }))).toEqual({ ok: true });
    expect(akunTersimpan()).toBe("5300");
  });

  it("pengeluaran berkategori tanpa peta tetap DITOLAK, tanpa INSERT", async () => {
    h.state.peta = null;
    const r = await tambahBiayaFinance(masukan({ section: "pengeluaran" }));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/belum punya pemetaan/) });
    expect(akunTersimpan()).toBeUndefined();
  });
});
