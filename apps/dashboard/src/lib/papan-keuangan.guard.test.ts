import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS atas Layar 1 — papan keuangan grup.
 *
 * Yang dijaga: read-only, gerbang baca, dan **ongkos yang dibatasi secara
 * eksplisit** (unit tanpa akun kas tidak dihitung laporannya).
 */
const baca = (f: string): string =>
  readFileSync(resolve(__dirname, f), "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n")
    .replace(/--.*$/gm, "");

const HAL = baca("../app/(app)/keuangan/page.tsx");
const MODEL = baca("keuangan-papan-model.ts");

describe("Layar 1 — papan keuangan grup", () => {
  it("penjaga ini punya SUBJEK", () => {
    expect(HAL).toMatch(/export default async function PapanKeuanganPage/);
    expect(MODEL).toMatch(/export function barisUnit/);
  });

  it("read-only: tak ada server action, tak ada DML, tak ada pool", () => {
    expect(HAL).not.toMatch(/"use server"/);
    expect(HAL).not.toMatch(/INSERT INTO|UPDATE app\.|DELETE FROM/i);
    expect(HAL).not.toMatch(/pool\.connect\(\)/);
    // ⛔ Papan TIDAK boleh memicu pembuatan baris day_close — itu milik Layar 4
    // (§10.15), dan membuatnya dari sini akan menghapus makna "belum pernah
    // dibuka" persis pada layar yang seharusnya menampilkannya.
    expect(HAL).not.toMatch(/pastikanBarisDayClose/);
  });

  it("gerbang BACA §10.13 dipakai dan penolakannya terjadi, sebelum data dibaca", () => {
    expect(HAL).toMatch(/if \(!canViewLaporanKeuangan\([^)]*\)\) notFound\(\)/);
    expect(urutan(HAL, "canViewLaporanKeuangan(", "barisUntukUnit(")).toBe("ok");
  });

  it("🔴 ONGKOS DIBATASI: unit tanpa akun kas tak dihitung laporannya", () => {
    // `getBahanLaporan` ≈16 kueri per unit. Papan yang menghitungnya untuk
    // ketujuh unit akan menembakkan ratusan kueri ke pool yang cap-nya 10.
    const fn = HAL.slice(HAL.indexOf("async function barisUntukUnit"));
    expect(urutan(fn, "if (akun.length === 0)", "getBahanLaporan(")).toBe("ok");
    expect(fn).toMatch(/return barisUnit\(\{[\s\S]*?adaAkunKas: false/);
  });

  it("batas ongkos itu TERTULIS, bukan penghematan diam-diam", () => {
    const mentah = readFileSync(resolve(__dirname, "../app/(app)/keuangan/page.tsx"), "utf8");
    expect(mentah).toMatch(/ONGKOS YANG DIBATASI DENGAN SENGAJA/);
    // 📌 Angkanya kini TERUKUR, bukan ditaksir — dan taksiran lama (≈16) meleset
    // 37%. Penjaga menuntut angka terukurnya tetap tertulis, berikut batasnya.
    expect(mentah).toMatch(/DIUKUR 18 Agu 2026, bukan ditaksir/);
    expect(mentah).toMatch(/\*\*22\*\*/);
    expect(mentah).toMatch(/BATAS BAWAH/);
  });

  it("🔴 kartu 'seimbang' memakai penyebut YANG SUDAH DIPERIKSA", () => {
    // Angka besar yang dibaca direksi mengalahkan kalimat kecil di bawahnya,
    // jadi angkanya sendiri yang harus benar — bukan keterangannya.
    expect(HAL).toMatch(/\{r\.seimbang\} \/ \{r\.diperiksa\}/);
    expect(HAL).not.toMatch(/\{r\.seimbang\} \/ \{r\.termodelkan\}/);
    expect(HAL).toMatch(/sudah diperiksa/);
  });

  it("🔴 kumulatif disebut belum tersedia, langkah harian disebut yang dinilai", () => {
    expect(HAL).toMatch(/LANGKAH HARIAN/);
    expect(HAL).toMatch(/kumulatif belum tersedia/);
  });

  it("keadaan kosong menyebut SIAPA yang mengisinya", () => {
    expect(MODEL).toMatch(/PENJELASAN_STATUS/);
    expect(MODEL).toMatch(/tim keuangan yang mendaftarkannya/);
  });

  it("🔴 'belum pernah dibuka' diturunkan dari KETIADAAN baris, bukan status", () => {
    // §10.15. Penjaga teksnya di sini; perilakunya diuji di
    // keuangan-papan-model.test.ts — dua lapis, karena teks saja bisa kalah.
    expect(MODEL).toMatch(/i\.dayClose === null/);
    expect(MODEL).not.toMatch(/status === 'open' \? "belum_pernah_dibuka"/);
  });

  it("kolom pemeriksa mendahului kolom laba", () => {
    // Urutan kolom mengikuti pertanyaan yang papan ini jawab.
    //
    // Dibatasi ke BLOK KEPALA TABEL: di seluruh berkas, "Laba bersih hari ini"
    // muncul lebih dulu sebagai kartu KPI, jadi asersi seluruh-berkas merah
    // karena sebab yang salah. Penjaga yang merah karena sebab yang salah
    // mengajari penulisnya mengabaikannya.
    const i = HAL.indexOf('grid-head cols-papan');
    const kepala = HAL.slice(i, HAL.indexOf("</div>", i));
    expect(kepala, "kepala tabel papan tidak ditemukan").toMatch(/SPBU/);
    expect(urutan(kepala, "Neraca — langkah harian", "Laba bersih")).toBe("ok");
  });
});
