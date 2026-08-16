import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS atas `kas-actions.ts` (Layar 3 blok 2).
 *
 * 📌 Bentuk tetap dari kelas kesalahan kelima & keenam diterapkan SEJAK AWAL di
 * sini, bukan setelah mutasi menemukannya:
 *   · komentar JS **dan** komentar SQL dibuang — di mana pun letaknya, termasuk
 *     tepat sesudah backtick pembuka template literal;
 *   · asersi menuntut **pernyataan utuh**, bukan fragmen yang tersebar.
 *
 * ⚠️ Batasnya tetap sama: ini membuktikan penjagaan ADA di kode, bukan bahwa ia
 * bekerja terhadap DB. Yang membuktikan perilakunya adalah CD.
 */
const SRC = readFileSync(resolve(__dirname, "kas-actions.ts"), "utf8");
const KODE = SRC.split("\n")
  .filter((l) => {
    const t = l.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  })
  .join("\n")
  .replace(/--.*$/gm, "");

/**
 * Badan SATU fungsi `export async function <nama>` — sampai sebelum `export`
 * berikutnya. Tanpa ini, asersi "nominal tidak dari client" akan salah: di
 * `simpanMutasiKas` nominal MEMANG datang dari pengguna (itu mutasi yang
 * diketik), dan larangannya hanya berlaku pada `setujuiSetoran`. Penjaga yang
 * memeriksa seluruh berkas untuk aturan yang cakupannya satu fungsi akan
 * memaksa penulisnya melonggarkan asersi sampai tak menjaga apa-apa.
 */
const badanFungsi = (nama: string): string => {
  const i = KODE.indexOf(`export async function ${nama}`);
  if (i < 0) return "";
  const j = KODE.indexOf("\nexport ", i + 1);
  return KODE.slice(i, j < 0 ? undefined : j);
};

/** Satu pernyataan SQL utuh yang dimulai dengan `prefix`, sampai backtick penutup. */
const pernyataan = (prefix: string): string => {
  const i = KODE.indexOf(prefix);
  if (i < 0) return "";
  const j = KODE.indexOf("`", i);
  return KODE.slice(i, j < 0 ? undefined : j);
};

describe("kas-actions — penjagaan yang tak boleh hilang", () => {
  it("penjaga ini punya SUBJEK", () => {
    for (const f of ["simpanMutasiKas", "setujuiSetoran", "voidMutasiKas"]) {
      expect(KODE).toMatch(new RegExp(`export async function ${f}`));
    }
  });

  it("🔴 SALDO tidak pernah ditulis — tak ada kolom saldo di INSERT mana pun", () => {
    // Kalau kelak ada yang menambahkan kolom saldo "biar cepat", yang ia bangun
    // adalah angka yang bisa berselisih dengan mutasinya sendiri.
    expect(KODE).not.toMatch(/\bsaldo\b/i);
    expect(KODE).not.toMatch(/balance/i);
  });

  it("gerbang §2.6 dipanggil, dan MENDAHULUI koneksi", () => {
    // `alasanTakBolehInput` MEMBUNGKUS `canInputKeuangan` + menutup irisan
    // HoF × keuangan (§10.12), dan membawa alasan penolakannya. Penjaga ini
    // menuntut gerbangnya lewat SATU pintu itu — bukan dua pemeriksaan yang
    // bisa berselisih.
    expect(KODE).toMatch(/alasanTakBolehInput\(/);
    expect(KODE).toMatch(/PESAN_TAK_BOLEH_INPUT\[alasan\]/);
    // `buka()` = requireUnit + gerbang; ia dipanggil di awal SETIAP aksi,
    // sebelum satu pun `pool.connect()`.
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
    expect([...KODE.matchAll(/const ctx = await buka\(/g)]).toHaveLength(3);
    expect([...KODE.matchAll(/if \(!ctx\.boleh\) return/g)]).toHaveLength(3);
  });

  it("🔴 nominal tawaran dibaca DI SERVER, tidak diterima dari client", () => {
    // Kalau angkanya datang dari browser, "disetujui" berhenti berarti apa pun.
    const baca = pernyataan("SELECT id::text AS id, keterangan, amount::text");
    expect(baca).toMatch(/FROM app\.manual_entry/);
    expect(baca).toMatch(/section = 'setoran_tunai'/);
    const fn = badanFungsi("setujuiSetoran");
    expect(fn, "fungsi setujuiSetoran tidak ditemukan").not.toBe("");
    // Di fungsi INI nominal tak boleh datang dari payload…
    expect(fn).not.toMatch(/input\.amount/);
    // …dan yang di-INSERT adalah nominal hasil baca server (`r.amount`).
    expect(fn).toMatch(/r\.amount/);
    // Yang datang dari client hanyalah daftar ID.
    expect(KODE).toMatch(/manualEntryIds: string\[\]/);
    // Kontrol POSITIF: di mutasi yang memang diketik, nominal dari payload SAH.
    expect(badanFungsi("simpanMutasiKas")).toMatch(/input\.amount/);
  });

  it("INSERT setoran adalah SATU pernyataan utuh dan mengunci kategorinya", () => {
    const ins = pernyataan("INSERT INTO app.cash_ledger\n           (unit_id, account_id");
    expect(ins, "INSERT tawaran setoran tidak ditemukan utuh").not.toBe("");
    expect(ins).toMatch(/source_manual_entry_id/);
    expect(ins).toMatch(/'Setoran Hasil Penjualan'/);
    // Idempoten terhadap indeks unik parsial 0033.
    expect(ins).toMatch(/ON CONFLICT[\s\S]*DO NOTHING/);
  });

  it("RLS 0016: set_config transaction-local mendahului setiap DML", () => {
    expect([...KODE.matchAll(/set_config\('app\.unit_ids', \$1, true\)/g)]).toHaveLength(3);
    expect(urutan(KODE, "set_config('app.unit_ids'", "INSERT INTO app.cash_ledger")).toBe("ok");
  });

  it("VOID-only: tak ada DELETE, dan pembatalan meninggalkan jejak", () => {
    expect(KODE).not.toMatch(/DELETE FROM/i);
    const upd = pernyataan("UPDATE app.cash_ledger");
    expect(upd).toMatch(/SET void=true, voided_by_user_id=\$1, voided_at=now\(\)/);
    expect(upd).toMatch(/AND NOT void/);
  });

  it("tanda & kategori diperiksa lewat aturan bersama, bukan disalin ulang", () => {
    // `tandaCocok`/`kategoriCocok` juga ditegakkan CHECK di 0029. Aturan yang
    // disalin ulang di sini akan berselisih dengan DB tanpa ada yang tahu.
    expect(KODE).toMatch(/tandaCocok\(input\.jenis, input\.amount\)/);
    expect(KODE).toMatch(/kategoriCocok\(input\.jenis, input\.categorySide\)/);
  });
});
