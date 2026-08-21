import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import type { PanelBalance, PanelLaporan } from "@/lib/keuangan-laporan-model";
import { nadaPemeriksa } from "@/lib/keuangan-laporan-model";
import { pdfText } from "./glyphs";
import {
  catatanSebab,
  footerKeuangan,
  gayaKeuangan,
  kopKeuangan,
  rupiah,
  selNilai,
  type KopKeuangan,
} from "./keuangan-kop";
import { CONTENT_WIDTH_PORTRAIT as CW, headerOnlyLayout, th } from "./pdf-layout";
import { PDF } from "./pdf-tokens";

/**
 * LAYAR 2 → PDF ("Cetak PDF" pada mockup). A4 POTRET.
 *
 * PRESENTATION-ONLY: dibangun dari `PanelLaporan` yang **sama persis** dengan
 * yang dirender halaman — nol hitung-ulang, nol query. Kalau PDF menghitung
 * sendiri, ia bisa berbeda dari layar tanpa ada yang tahu.
 *
 * ⛔ YANG DIEKSPOR ADALAH APA YANG TERLIHAT, TERMASUK KEADAAN KOSONGNYA:
 *   · baris `null` tetap "belum bisa dihitung" (`selNilai`);
 *   · sebab kosong ikut sebagai catatan kaki panel;
 *   · banner produk tak lengkap ikut;
 *   · caveat "Nilai DO" ikut — ia batas yang layar sebut, dan berkas yang
 *     menghilangkannya membuat pembacanya lebih percaya diri dari yang berhak.
 */
export interface LaporanKeuanganDocInput {
  kop: KopKeuangan;
  cashFlow: PanelLaporan;
  income: PanelLaporan;
  balance: PanelBalance;
  /** Produk yang datanya belum lengkap — persis daftar yang dibanner layar. */
  incomplete: readonly string[];
  /** Caveat yang tampil di layar; ikut apa adanya. */
  catatanNilaiDo: string;
}

function panel(judul: string, p: PanelLaporan): Content[] {
  const nada = nadaPemeriksa(p.pemeriksa.nilai);
  const warnaNada =
    nada === "baik" ? PDF.success : nada === "buruk" ? PDF.danger : PDF.textMuted;
  const out: Content[] = [
    {
      table: {
        headerRows: 1,
        widths: [CW - 130, 130],
        body: [
          [th(judul), th("Rupiah", "right")],
          ...p.baris.map((b) => [
            {
              text: pdfText(b.label),
              fontSize: 8.5,
              bold: b.sum === true,
              margin: [b.ind === true ? 10 : 0, 0, 0, 0] as [number, number, number, number],
            },
            selNilai(b),
          ]),
          // Angka pemeriksa di KAKI panel — bukan sel tersembunyi (§ layar).
          [
            { text: pdfText(p.pemeriksa.label), fontSize: 8.5, bold: true, color: warnaNada },
            p.pemeriksa.nilai === null
              ? { text: "belum bisa dihitung", alignment: "right", fontSize: 8, italics: true, color: PDF.textMuted }
              : { text: rupiah(p.pemeriksa.nilai), alignment: "right", fontSize: 8.5, bold: true, color: warnaNada },
          ],
        ],
      },
      layout: headerOnlyLayout,
      margin: [0, 0, 0, 2],
    },
  ];
  const cat = catatanSebab(p.baris);
  if (cat !== null) out.push(cat);
  return out;
}

export function buildLaporanKeuanganDoc(i: LaporanKeuanganDocInput): TDocumentDefinitions {
  const isi: Content[] = [...kopKeuangan(i.kop)];

  if (i.incomplete.length > 0) {
    isi.push({
      table: {
        widths: [CW - 12],
        body: [
          [
            {
              text: pdfText(
                `${i.incomplete.length} produk belum lengkap datanya: ${i.incomplete.join(", ")} — ` +
                  `pos yang bergantung padanya DILEWATI dalam penjumlahan, tidak diperlakukan sebagai nol.`,
              ),
              fontSize: 8,
              color: PDF.warning,
              margin: [6, 4, 6, 4],
            },
          ],
        ],
      },
      layout: "noBorders",
      fillColor: "#FEF6E7",
      margin: [0, 0, 0, 8],
    });
  }

  isi.push(...panel("Cash Flow", i.cashFlow));
  isi.push({ text: "", margin: [0, 6, 0, 0] });
  isi.push(...panel("Income Statement", i.income));
  isi.push({ text: "", margin: [0, 6, 0, 0] });
  isi.push(...panel("Balance Sheet", i.balance));

  // LANGKAH HARIAN — yang dinilai gerbang; BSCheck kumulatif bukan penggantinya.
  isi.push({
    margin: [0, 6, 0, 0],
    text: [
      { text: "Langkah harian: ", fontSize: 8.5, bold: true },
      i.balance.langkahHarian === null
        ? { text: "belum bisa dihitung", fontSize: 8, italics: true, color: PDF.textMuted }
        : {
            text: rupiah(i.balance.langkahHarian),
            fontSize: 8.5,
            bold: true,
            color: Math.abs(i.balance.langkahHarian) < 0.005 ? PDF.success : PDF.danger,
          },
    ],
  });

  isi.push({
    text: pdfText(`⚠️ ${i.catatanNilaiDo}`),
    fontSize: 7.5,
    color: PDF.textSecondary,
    margin: [0, 8, 0, 0],
  });

  return {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [40, 40, 40, 45],
    content: isi,
    styles: gayaKeuangan,
    footer: footerKeuangan(i.kop),
    info: { title: `${i.kop.judul} — ${i.kop.subjudul}` },
  };
}
