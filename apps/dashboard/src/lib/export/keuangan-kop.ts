import type { Content, ContentText, TableCell } from "pdfmake/interfaces";
import { PENJELASAN_KOSONG, type BarisLaporan, type SebabKosong } from "@/lib/keuangan-laporan-model";
import { pdfText } from "./glyphs";
import { KOSONG_PANEL } from "./teks-kosong";
import { PDF } from "./pdf-tokens";

/**
 * Bagian bersama SEMUA ekspor PDF modul keuangan.
 *
 * ⛔ SATU PEMBUAT VONIS untuk tiap aturan yang harus berlaku di KEDUA dokumen.
 * Kalau tiap dokumen menyalin aturannya sendiri, mutasi yang melanggarnya hanya
 * memerahkan satu — dan salinan selalu setuju dengan dirinya sendiri.
 *
 * Tiga aturan yang dijaga di sini:
 *
 * 1. **`null` BERNAMA TETAP BERNAMA DI KERTAS.** `belum_ada_saldo_pembuka`
 *    tidak boleh jadi `0`. Berkas hidup lebih lama dari sesi dan dibaca orang
 *    yang tak melihat layarnya; nol di kertas adalah kebohongan yang awet.
 * 2. **Kop menyebut PT yang benar** — unit lintas-PT jatuh ke payung SolaGroup
 *    (`ptLabelForUnits`, dihitung pemanggil dari kode unit ber-scope).
 * 3. **Tiap halaman menyebut KAPAN dan SIAPA.** Berkas yang beredar tanpa
 *    keduanya tak bisa ditelusuri saat angkanya dipertanyakan.
 */

export interface KopKeuangan {
  /** Hasil `ptLabelForUnits` atas unit YANG BER-SCOPE, bukan atas semua unit. */
  ptLabel: string;
  judul: string;
  /** Baris kedua: unit + tanggal, atau cakupan multi-unit. */
  subjudul: string;
  /** "21 Agu 2026 · 14.05" — WIB, dibentuk server. */
  generatedLabel: string;
  /** Identitas pencetak. Kosong TIDAK diperbolehkan — lihat `footerKeuangan`. */
  dicetakOleh: string;
}

/** Teks kaki halaman — dipakai kedua dokumen, tak boleh disalin ulang. */
export function tekstKaki(k: KopKeuangan): string {
  const siapa = k.dicetakOleh.trim();
  // ⛔ Kosong bukan alasan menghilangkan barisnya. Berkas tanpa jejak pencetak
  //    lebih berbahaya daripada berkas yang mengaku tak tahu siapa pencetaknya.
  return (
    `Dihasilkan otomatis oleh SolaMax dari data EasyMax POS · ` +
    `Dicetak ${k.generatedLabel} WIB oleh ${siapa === "" ? "(identitas tak diketahui)" : siapa}`
  );
}

export function kopKeuangan(k: KopKeuangan): Content[] {
  return [
    { text: pdfText(k.ptLabel), style: "pt" },
    { text: pdfText(k.judul), style: "judul" },
    { text: pdfText(k.subjudul), style: "subjudul", margin: [0, 2, 0, 10] },
  ];
}

export const gayaKeuangan = {
  pt: { fontSize: 9, color: PDF.textSecondary, bold: true },
  judul: { fontSize: 15, bold: true, color: PDF.navy },
  subjudul: { fontSize: 10, color: PDF.textSecondary },
  th: { bold: true, color: PDF.onNavy, fontSize: 8.5 },
  kaki: { fontSize: 7.5, color: PDF.textMuted },
} as const;

/** Kaki halaman pdfmake (fungsi per-halaman + nomor halaman). */
export function footerKeuangan(k: KopKeuangan) {
  return (halaman: number, total: number): Content => ({
    margin: [40, 8, 40, 0],
    columns: [
      { text: pdfText(tekstKaki(k)), style: "kaki" },
      { text: `${halaman} / ${total}`, style: "kaki", alignment: "right", width: 50 },
    ],
  });
}

/**
 * ⛔ SATU-SATUNYA tempat sebuah `BarisLaporan` berubah jadi sel PDF.
 *
 * `nilai === null` → **"belum bisa dihitung"**, kata demi kata sama dengan
 * layarnya. Bukan "0", bukan "-", bukan sel kosong.
 */
export function selNilai(b: BarisLaporan): TableCell {
  if (b.nilai === null) {
    return {
      text: KOSONG_PANEL,
      alignment: "right",
      fontSize: 8,
      italics: true,
      color: PDF.textMuted,
    };
  }
  return {
    text: rupiah(b.nilai),
    alignment: "right",
    fontSize: 8.5,
    bold: b.sum === true,
    color: b.nilai < 0 ? PDF.danger : PDF.textPrimary,
  };
}

export function rupiah(n: number): string {
  return Math.round(n).toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

/**
 * Catatan kaki sebab-kosong — **dikumpulkan dari baris yang benar-benar kosong**,
 * bukan dari daftar yang diketik. Panel tanpa baris kosong tak menghasilkan
 * catatan; panel yang punya, menyebut sebabnya dengan kalimat yang sama dengan
 * layarnya.
 */
export function catatanSebab(baris: readonly BarisLaporan[]): Content | null {
  const sebab = [...new Set(baris.filter((b) => b.nilai === null && b.sebab).map((b) => b.sebab!))];
  if (sebab.length === 0) return null;
  return {
    margin: [0, 4, 0, 0],
    ul: sebab.map((s: SebabKosong): ContentText => ({ text: pdfText(PENJELASAN_KOSONG[s]) })),
    fontSize: 7.5,
    color: PDF.textSecondary,
  };
}
