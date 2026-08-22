import { angkaTeks, KOSONG_RINGKAS } from "./teks-kosong";
import type { BarisUnit } from "@/lib/keuangan-papan-model";
import { LABEL_STATUS, ringkasPapan } from "@/lib/keuangan-papan-model";

/**
 * Penulis CSV — **ditulis tangan, tanpa pustaka baru** (§10.19).
 *
 * Dashboard tak punya satu pun pustaka XLSX/CSV; menambahkannya berarti
 * dependensi baru untuk medium yang justru sedang ditinggalkan tim keuangan.
 *
 * ⛔ ATURAN YANG DIJAGA DI SINI:
 *  1. **Tak ada sel kosong untuk `null`** — lihat `teks-kosong.ts`. Sel kosong
 *     di CSV dibaca Excel sebagai NOL.
 *  2. **Kutip yang benar** — koma, kutip, dan baris-baru di dalam nilai tak
 *     boleh memecah barisnya. Nama unit boleh mengandung koma; hari itu terjadi,
 *     seluruh kolom bergeser dan tak ada yang tahu.
 *  3. **BOM UTF-8** di depan — tanpanya Excel di Windows merusak "—" dan "·".
 */

/** Satu sel: dikutip bila perlu, dan kutip di dalamnya digandakan (RFC 4180). */
export function selCsv(nilai: string): string {
  return /[",\n\r]/.test(nilai) ? `"${nilai.replace(/"/g, '""')}"` : nilai;
}

export function barisCsv(sel: readonly string[]): string {
  return sel.map(selCsv).join(",");
}

/** CRLF: yang dimengerti Excel di semua platform. */
export function susunCsv(baris: readonly (readonly string[])[]): string {
  return "﻿" + baris.map(barisCsv).join("\r\n") + "\r\n";
}

/**
 * CSV papan keuangan grup — isi yang SAMA dengan tabel layar, termasuk unit yang
 * belum dimodelkan (mereka baris, bukan ketiadaan) dan termasuk baris ringkasan
 * yang memakai penyebut "sudah diperiksa" dari `ringkasPapan`.
 */
export function papanCsv(baris: readonly BarisUnit[], tanggal: string): string {
  const r = ringkasPapan(baris);
  const rows: string[][] = [
    ["Tanggal", "Unit", "Kode", "Status", "Laba bersih", "Kas akhir", "Langkah harian", "Tier",
     "Bagan akun"],
    ...baris.map((b) => [
      tanggal,
      b.nama,
      b.code,
      LABEL_STATUS[b.status],
      angkaTeks(b.labaBersih),
      angkaTeks(b.kasAkhir),
      angkaTeks(b.langkahHarian),
      // Tier `null` bukan angka; ia tetap harus berbunyi, bukan diam.
      b.tier ?? KOSONG_RINGKAS,
      // §10.22 — ikut ke CSV: yang diekspor adalah apa yang terlihat.
      b.kekuranganBagan.length === 0 ? "lengkap" : `belum ada ${b.kekuranganBagan.join(" & ")}`,
    ]),
    [],
    ["Ringkasan", "unit dalam cakupan", String(baris.length)],
    ["Ringkasan", "termodelkan", String(r.termodelkan)],
    ["Ringkasan", "sudah diperiksa", String(r.diperiksa)],
    ["Ringkasan", "seimbang (dari yang sudah diperiksa)", String(r.seimbang)],
    ["Ringkasan", "belum pernah dibuka (tak ikut penyebut)", String(r.belumPernahDibuka)],
  ];
  return susunCsv(rows);
}
