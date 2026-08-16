import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS atas `harga-beli-actions.ts` — permukaan TULIS pertama modul
 * keuangan.
 *
 * ⚠️ BATASNYA, sebut apa adanya: ini memeriksa bahwa penjagaan itu ADA di
 * kode, bukan bahwa ia bekerja terhadap DB. Yang membuktikan perilakunya
 * adalah uji integrasi ber-DB (belum ada untuk tabel ini) dan CD. Penjaga teks
 * dipakai di sini karena kelas kesalahan yang paling mungkin bukan "logikanya
 * salah" melainkan "baris penjaganya HILANG saat kode disunting orang lain".
 *
 * Komentar DIBUANG lebih dulu — pelajaran yang sudah lima kali berulang:
 * penjaga yang bisa dijinakkan dengan dua tanda hubung bukan penjaga.
 */
const SRC = readFileSync(resolve(__dirname, "harga-beli-actions.ts"), "utf8");
const KODE = SRC.split("\n")
  .filter((l) => {
    const t = l.trim();
    // Komentar JS (`//`, `*`, `/*`) DAN komentar SQL (`--`) di dalam template
    // literal. Yang kedua ditambahkan setelah uji mutasi: mengomentari baris
    // `UPDATE app.purchase_price` di dalam string SQL membuat pernyataannya
    // mati total, tetapi tesnya tetap HIJAU — sebab asersinya menemukan
    // `SET void=true` di baris BERIKUTNYA yang tak ikut dikomentari.
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  })
  .join("\n")
  // Komentar SQL di dalam template literal, DI MANA PUN ia muncul — bukan hanya
  // di awal baris. Uji mutasi menaruhnya tepat SESUDAH backtick pembuka
  // (`` `-- UPDATE … ``), sehingga penyaring per-baris tak menyentuhnya dan
  // pernyataan yang sudah mati tetap "ditemukan". Ini kejadian KEENAM dari
  // kelas yang sama; yang berubah tiap kali hanya letak dua tanda hubungnya.
  .replace(/--.*$/gm, "");

describe("harga-beli-actions — penjagaan yang tak boleh hilang", () => {
  it("penjaga ini punya SUBJEK (jangan hijau karena berkasnya kosong)", () => {
    expect(KODE).toMatch(/export async function simpanHargaBeli/);
    expect(KODE.length).toBeGreaterThan(500);
  });

  it("unit SELALU dari requireUnit — bukan dari input mentah", () => {
    expect(KODE).toMatch(/scope\.requireUnit\(input\.code\)/);
    // unit_id yang ditulis harus berasal dari objek unit hasil requireUnit.
    expect(KODE).toMatch(/unit\.unit_id/);
    expect(KODE).not.toMatch(/input\.unitId|input\.unit_id/);
  });

  it("🔴 gerbang tulis §2.6 dipanggil, dan MENOLAK sebelum menyentuh DB", () => {
    // Lewat `alasanTakBolehInput`, yang membungkus `canInputKeuangan` DAN
    // menutup irisan HoF × keuangan (§10.12) — satu pintu, bukan dua
    // pemeriksaan yang bisa berselisih.
    expect(KODE).toMatch(/alasanTakBolehInput\(/);
    expect(KODE).toMatch(/PESAN_TAK_BOLEH_INPUT\[alasan\]/);
    // Kalau gerbangnya dipindah ke BAWAH koneksi, penolakan tetap benar tetapi
    // koneksi terbuka untuk pemanggil yang tak berhak. Urutannya ikut dijaga —
    // lewat `urutan()`, yang GAGAL bila salah satunya hilang (lihat
    // penjaga-urutan.ts: `indexOf(a) < indexOf(b)` lolos saat `a` lenyap).
    expect(urutan(KODE, "alasanTakBolehInput(", "pool.connect()")).toBe("ok");
  });

  it("🔴 HARGA JUAL dibaca di server, tidak pernah diterima dari client", () => {
    // Penjaga yang nilainya boleh ditentukan oleh yang dijaganya bukan penjaga.
    expect(KODE).toMatch(/nhargajual/);
    expect(KODE).not.toMatch(/input\.sellPrice|input\.hargaJual/);
    // …dan hasilnyalah yang masuk evaluateP1, bukan angka dari payload.
    expect(KODE).toMatch(/sellPrice,/);
  });

  it("RLS 0016: konteks unit di-set TRANSACTION-LOCAL sebelum DML", () => {
    expect(KODE).toMatch(/set_config\('app\.unit_ids', \$1, true\)/);
    expect(urutan(KODE, "set_config('app.unit_ids'", "INSERT INTO app.purchase_price")).toBe("ok");
  });

  it("VOID-only: tak ada DELETE, dan baris lama dibatalkan bukan ditimpa", () => {
    expect(KODE).not.toMatch(/DELETE FROM/i);
    // SATU pernyataan utuh, bukan dua serpihan yang kebetulan sama-sama ada:
    // mematikan barisnya sendiri harus memerahkan baris ini.
    expect(KODE).toMatch(/UPDATE app\.purchase_price\s+SET void=true/);
    // UPDATE yang ada HANYA untuk mem-void; harga tak pernah di-UPDATE di tempat.
    expect(KODE).not.toMatch(/SET price/i);
  });

  it("P1 tidak pernah menolak karena NILAINYA — hanya karena pengakuan kurang", () => {
    // §4.1: reject keras akan memblokir 336 hari yang sah di sejarah Bakau.
    expect(KODE).toMatch(/p1\.triggered && !p1\.canSave/);
    expect(KODE).not.toMatch(/if \(p1\.triggered\)\s*\{?\s*return \{ ok: false/);
  });

  it("harga ≤ 0 ditolak — nol adalah harga yang mustahil, bukan 'belum diisi'", () => {
    expect(KODE).toMatch(/input\.price > 0/);
  });
});
