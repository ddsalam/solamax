import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

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

  it("tanda nominal ditentukan SEKSI, bukan diketik", () => {
    // Minus yang terlupa adalah cara termudah membuat biaya menaikkan laba.
    expect(KODE).toMatch(/input\.section === "pengeluaran" \? -input\.amountRp : input\.amountRp/);
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
