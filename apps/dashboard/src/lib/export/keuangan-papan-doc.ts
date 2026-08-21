import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import { LABEL_STATUS, ringkasPapan, type BarisUnit } from "@/lib/keuangan-papan-model";
import { pdfText } from "./glyphs";
import {
  footerKeuangan,
  gayaKeuangan,
  kopKeuangan,
  rupiah,
  type KopKeuangan,
} from "./keuangan-kop";
import { CONTENT_WIDTH_LANDSCAPE as CW, ledgerLayout, th } from "./pdf-layout";
import { PDF } from "./pdf-tokens";

/**
 * LAYAR 1 → PDF ("Cetak ringkasan" pada mockup). A4 LANSKAP.
 *
 * ⛔ UNIT YANG BELUM DIMODELKAN TETAP MUNCUL SEBAGAI BARIS. Papan yang membuang
 * unit tanpa akun kas akan terbaca "enam unit ini tak punya masalah", padahal
 * artinya "enam unit ini belum dihitung sama sekali". Di kertas kekeliruan itu
 * tak bisa diperbaiki dengan menggulir ke bawah.
 *
 * ⛔ Penyebut kartu ringkasan adalah unit yang SUDAH DIPERIKSA, bukan seluruh
 * unit — aturan yang sama dengan layarnya, dan alasan yang sama: angka besar
 * mengalahkan kalimat kecil di bawahnya.
 */
export interface PapanKeuanganDocInput {
  kop: KopKeuangan;
  baris: readonly BarisUnit[];
}

function selAngka(v: number | null): TableCell {
  if (v === null) {
    return { text: "belum dihitung", alignment: "right", fontSize: 7.5, italics: true, color: PDF.textMuted };
  }
  return { text: rupiah(v), alignment: "right", fontSize: 8, color: v < 0 ? PDF.danger : PDF.textPrimary };
}

export function buildPapanKeuanganDoc(i: PapanKeuanganDocInput): TDocumentDefinitions {
  // ⛔ ANGKA RINGKASAN DIPANGGIL, TIDAK DISALIN. `ringkasPapan` adalah pembuat
  //    vonis yang sama dengan layarnya — termasuk aturan yang pernah salah di
  //    sana: penyebutnya unit yang SUDAH DIPERIKSA (diturunkan dari status),
  //    dan `seimbang` adalah `langkahHarian === 0`, bukan "nada baik".
  //    Menyalinnya ke sini akan menghidupkan kembali cacat yang sudah ditutup,
  //    di medium yang tak bisa dikoreksi setelah dicetak.
  const r = ringkasPapan(i.baris);

  const isi: Content[] = [
    ...kopKeuangan(i.kop),
    {
      // Ringkasan dengan PENYEBUT YANG SUDAH DIPERIKSA — bukan jumlah unit.
      text: pdfText(
        `${i.baris.length} unit dalam cakupan · ${r.termodelkan} termodelkan · ` +
          `${r.seimbang} / ${r.diperiksa} seimbang di antara yang sudah diperiksa` +
          (r.belumPernahDibuka > 0
            ? ` · ${r.belumPernahDibuka} belum pernah dibuka (tak ikut penyebut)`
            : ""),
      ),
      fontSize: 9,
      color: PDF.textSecondary,
      margin: [0, 0, 0, 8],
    },
    {
      table: {
        headerRows: 1,
        widths: [140, 70, 100, 100, 100, CW - 540],
        body: [
          [
            th("Unit"),
            th("Status"),
            th("Laba bersih", "right"),
            th("Kas akhir", "right"),
            th("Langkah harian", "right"),
            th("Tier"),
          ],
          ...i.baris.map((b): TableCell[] => {
            const belum = b.status === "belum_dimodelkan";
            return [
              { text: pdfText(`${b.nama} (${b.code})`), fontSize: 8 },
              {
                text: LABEL_STATUS[b.status],
                fontSize: 7.5,
                italics: belum,
                color: belum ? PDF.textMuted : PDF.textPrimary,
              },
              selAngka(b.labaBersih),
              selAngka(b.kasAkhir),
              selAngka(b.langkahHarian),
              { text: b.tier ?? "—", fontSize: 7.5, color: PDF.textSecondary },
            ];
          }),
        ],
      },
      layout: ledgerLayout,
    },
  ];

  // Keadaan kosong yang EKSPLISIT — sama seperti layarnya.
  const belum = i.baris.filter((b) => b.status === "belum_dimodelkan");
  if (belum.length > 0) {
    isi.push({
      margin: [0, 8, 0, 0],
      text: pdfText(
        `${belum.length} unit belum punya daftar rekening kas/bank, jadi laporannya belum ` +
          `disusun sama sekali: ${belum.map((b) => b.nama).join(", ")}. Baris kosong di atas ` +
          `berarti "belum dihitung", bukan "nol".`,
      ),
      fontSize: 7.5,
      color: PDF.textSecondary,
    });
  }

  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [40, 40, 40, 45],
    content: isi,
    styles: gayaKeuangan,
    footer: footerKeuangan(i.kop),
    info: { title: `${i.kop.judul} — ${i.kop.subjudul}` },
  };
}
