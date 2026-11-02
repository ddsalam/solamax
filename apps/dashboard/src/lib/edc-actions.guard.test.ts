import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS atas `edc-actions.ts` (Layar 3 blok 3).
 *
 * 📌 Bentuk tetap kelas 5 & 6 sejak awal (komentar JS **dan** SQL dibuang di
 * mana pun letaknya; asersi menuntut pernyataan utuh), dan asersi bercakupan
 * satu fungsi dibatasi ke badan fungsinya.
 *
 * ⚠️ Batas: ini membuktikan penjagaan ADA di kode. Perilakunya terhadap DB
 * dibuktikan CD.
 */
const SRC = readFileSync(resolve(__dirname, "edc-actions.ts"), "utf8");
const KODE = SRC.split("\n")
  .filter((l) => {
    const t = l.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  })
  .join("\n")
  .replace(/--.*$/gm, "");

const badanFungsi = (nama: string): string => {
  const i = KODE.indexOf(`export async function ${nama}`);
  if (i < 0) return "";
  const j = KODE.indexOf("\nexport ", i + 1);
  return KODE.slice(i, j < 0 ? undefined : j);
};

const pernyataan = (prefix: string): string => {
  const i = KODE.indexOf(prefix);
  if (i < 0) return "";
  const j = KODE.indexOf("`", i);
  return KODE.slice(i, j < 0 ? undefined : j);
};

describe("edc-actions — penjagaan yang tak boleh hilang", () => {
  it("penjaga ini punya SUBJEK", () => {
    expect(KODE).toMatch(/export async function simpanSettlement/);
    expect(KODE).toMatch(/export async function setujuiPencairan/);
    expect(KODE).toMatch(/export async function batalkanPencairan/);
  });

  it("🔴 MDR TIDAK PERNAH DIKETIK — tak ada parameter MDR, tak ada kolom mdr_rp di INSERT", () => {
    // Ia GENERATED ALWAYS AS (gross − net) STORED di 0030. Menuliskannya dari
    // aplikasi berarti angka yang sudah diketahui sistem punya kesempatan salah.
    const ins = pernyataan("INSERT INTO app.edc_settlement");
    expect(ins, "INSERT settlement tidak ditemukan utuh").not.toBe("");
    expect(ins).not.toMatch(/mdr_rp/);
    // Dibatasi ke ANTARMUKA MASUKAN, bukan seluruh berkas: `mdrRp` sah muncul
    // sebagai anotasi tipe hasil SELECT (nilainya dari kolom GENERATED). Yang
    // dilarang adalah MDR yang datang dari pemanggil.
    const i = KODE.indexOf("export interface SettlementInput");
    const masukan = KODE.slice(i, KODE.indexOf("}", i) + 1);
    expect(masukan, "antarmuka SettlementInput tidak ditemukan").toMatch(/grossRp/);
    expect(masukan).not.toMatch(/mdr/i);
  });

  it("gerbang settlement (keputusan 2 Nov 2026) lewat SATU pintu, dan mendahului koneksi", () => {
    // Seluruh tim Finance — staf Keuangan DAN HoF — memakai canKelolaSettlementEdc,
    // BUKAN alasanTakBolehInput (yang menolak HoF, §10.12).
    expect(KODE).toMatch(/canKelolaSettlementEdc\(/);
    expect(KODE).not.toMatch(/alasanTakBolehInput\(/);
    expect(urutan(KODE, "canKelolaSettlementEdc(", "pool.connect()")).toBe("ok");
    // 🔴 PENOLAKANNYA harus terjadi, bukan sekadar dipanggil.
    expect(KODE).toMatch(/if \(!canKelolaSettlementEdc\([^)]*\)\) return \{ boleh: false, error: PESAN_TAK_BOLEH_SETTLEMENT \}/);
    expect(KODE).toMatch(/scope\.requireUnit\(code\)/);
  });

  it("🔴 setiap aksi tulis melewati buka() — tak ada pintu samping", () => {
    for (const nama of ["simpanSettlement", "setujuiPencairan", "ubahSettlement", "batalkanSettlement", "batalkanPencairan"]) {
      const fn = badanFungsi(nama);
      expect(fn, `fungsi ${nama} tidak ditemukan`).not.toBe("");
      expect(urutan(fn, "await buka(", "pool.connect()"), nama).toBe("ok");
    }
  });

  it("🔴 simpan DAN ubah memakai SATU validasi", () => {
    expect(badanFungsi("simpanSettlement")).toMatch(/validasiSettlement\(/);
    expect(badanFungsi("ubahSettlement")).toMatch(/validasiSettlement\(/);
    expect(urutan(badanFungsi("ubahSettlement"), "validasiSettlement(", "pool.connect()")).toBe("ok");
  });

  it("🔴 ubah & batalkan batch hanya untuk batch BELUM dicairkan, dikunci FOR UPDATE", () => {
    for (const nama of ["ubahSettlement", "batalkanSettlement"]) {
      const fn = badanFungsi(nama);
      expect(fn, nama).toMatch(/FOR UPDATE/);
      expect(fn, nama).toMatch(/posted/);
      expect(fn, nama).toMatch(/auditKeuangan\(/);
      expect(fn, nama).not.toMatch(/mdr_rp\s*=/);
    }
    // UPDATE batch-nya sendiri menuntut belum dicairkan di WHERE — bukan hanya di cek awal.
    expect(badanFungsi("ubahSettlement")).toMatch(/AND posted_at IS NULL/);
    expect(badanFungsi("batalkanSettlement")).toMatch(/AND posted_at IS NULL/);
  });

  it("🔴 batalkan pencairan: cek cocok → hari buku → void kaki → kosongkan persetujuan → jejak", () => {
    const fn = badanFungsi("batalkanPencairan");
    expect(fn, "fungsi batalkanPencairan tidak ditemukan").not.toBe("");
    expect(fn).toMatch(/settlementId: string/);
    expect(fn).not.toMatch(/input\.(grossRp|netRp|amount)/);
    expect(urutan(fn, "cocok_bank_baris", "hariTerbuka(")).toBe("ok");
    expect(urutan(fn, "hariTerbuka(", "UPDATE app.cash_ledger")).toBe("ok");
    expect(urutan(fn, "UPDATE app.cash_ledger", "UPDATE app.noncash_expense")).toBe("ok");
    expect(urutan(fn, "UPDATE app.noncash_expense", "SET posted_by_user_id=NULL, posted_at=NULL")).toBe("ok");
    expect(urutan(fn, "SET posted_by_user_id=NULL, posted_at=NULL", "auditKeuangan(")).toBe("ok");
    expect(urutan(fn, "auditKeuangan(", 'client.query("COMMIT")')).toBe("ok");
    expect(fn).toMatch(/FOR UPDATE/);
  });

  it("🔴 'batalkan pencairan & batch' mem-void batch-nya di transaksi yang SAMA, sesudah dicabut persetujuannya", () => {
    const fn = badanFungsi("batalkanPencairan");
    expect(fn).toMatch(/jugaBatch/);
    expect(urutan(fn, "SET posted_by_user_id=NULL, posted_at=NULL", "SET void=true, voided_by_user_id=$1, voided_at=now()\n        WHERE id=$2::uuid")).toBe("ok");
    expect(urutan(fn, "SET void=true, voided_by_user_id=$1, voided_at=now()\n        WHERE id=$2::uuid", 'client.query("COMMIT")')).toBe("ok");
  });

  it("🔴 persetujuan (ulang) tak menulis ke hari yang sudah ditutup", () => {
    const fn = badanFungsi("setujuiPencairan");
    expect(urutan(fn, "hariTerbuka(", "INSERT INTO app.cash_ledger")).toBe("ok");
    // Penjaganya sendiri benar-benar mengunci & menilai hari buku.
    const i = KODE.indexOf("async function hariTerbuka");
    const penjaga = KODE.slice(i, KODE.indexOf("\n}\n", i));
    expect(penjaga, "hariTerbuka tidak ditemukan").toMatch(/hariBukuTerkunci\(/);
    expect(penjaga).toMatch(/h\.hariBuku !== tanggal\) return false/);
  });

  it("🔴 selisih transaksi vs settlement TIDAK boleh lewat tanpa nama", () => {
    // Aturannya tinggal di validasiSettlement (keuangan-edc.ts, diuji di sana);
    // di sini dijaga bahwa simpan memakainya dan menolak SEBELUM koneksi dibuka.
    const fn = badanFungsi("simpanSettlement");
    expect(fn).toMatch(/if \(!v\.ok\) return \{ ok: false, error: v\.error \}/);
    expect(urutan(fn, "validasiSettlement(", "pool.connect()")).toBe("ok");
    expect(fn).toMatch(/adaSelisih \? input\.reasonCode : null/);
  });

  it("🔴 nominal pencairan dibaca ULANG di server; client hanya mengirim id", () => {
    const fn = badanFungsi("setujuiPencairan");
    expect(fn, "fungsi setujuiPencairan tidak ditemukan").not.toBe("");
    expect(fn).toMatch(/settlementId: string/);
    // Tak ada satu pun nominal dari payload di fungsi ini.
    expect(fn).not.toMatch(/input\.(grossRp|netRp|amount)/);
    // Yang dipakai adalah hasil SELECT — termasuk MDR dari kolom GENERATED.
    expect(fn).toMatch(/row\.netRp/);
    expect(fn).toMatch(/row\.grossRp/);
    expect(fn).toMatch(/row\.mdrRp/);
  });

  it("FOR UPDATE + posted_at IS NULL — dua penyetuju tak melahirkan dua jurnal", () => {
    const sel = pernyataan("SELECT id::text                              AS id,");
    expect(sel).toMatch(/posted_at IS NULL/);
    expect(sel).toMatch(/FOR UPDATE/);
  });

  it("🔴 kaki MDR mendarat di noncash_expense — bukan cash_ledger, bukan manual_entry", () => {
    // §2.5: ia bukan akun kas, dan bukan sesuatu yang diketik manusia.
    const fn = badanFungsi("setujuiPencairan");
    expect(fn).toMatch(/INSERT INTO app\.noncash_expense/);
    expect(fn).not.toMatch(/INSERT INTO app\.manual_entry/);
    const ins = pernyataan("INSERT INTO app.noncash_expense");
    expect(ins).toMatch(/'7-1200'/);
    expect(ins).toMatch(/edc_settlement_id/);
    // Tabel itu memang tak punya kolom kategori operasional.
    expect(ins).not.toMatch(/operational_category/);
  });

  it("ketiga kaki lahir dalam SATU transaksi", () => {
    // Jurnal yang separuh mendarat lebih buruk daripada yang gagal.
    const fn = badanFungsi("setujuiPencairan");
    const begin = fn.indexOf('client.query("BEGIN")');
    const commit = fn.indexOf('client.query("COMMIT")');
    expect(begin).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(begin);
    for (const p of ["INSERT INTO app.cash_ledger", "INSERT INTO app.noncash_expense"]) {
      const i = fn.indexOf(p);
      expect(i, `${p} di luar transaksi`).toBeGreaterThan(begin);
      expect(i).toBeLessThan(commit);
    }
    // Dua kaki kas, satu kaki beban.
    expect([...fn.matchAll(/INSERT INTO app\.cash_ledger/g)]).toHaveLength(2);
  });

  it("kedua kaki kas menunjuk settlement-nya — bisa ditelusuri balik", () => {
    const fn = badanFungsi("setujuiPencairan");
    expect([...fn.matchAll(/edc_settlement_id/g)].length).toBeGreaterThanOrEqual(3);
  });

  it("jejak persetujuan ditulis — posted_by/at bukan penanda otomatis", () => {
    const upd = pernyataan("UPDATE app.edc_settlement");
    expect(upd).toMatch(/SET posted_by_user_id=\$1, posted_at=now\(\)/);
  });

  it("RLS 0016 di-set transaction-local sebelum DML", () => {
    expect([...KODE.matchAll(/set_config\('app\.unit_ids', \$1, true\)/g)]).toHaveLength(5);
  });

  it("tak ada DELETE di jalur mana pun", () => {
    expect(KODE).not.toMatch(/DELETE FROM/i);
  });
});
