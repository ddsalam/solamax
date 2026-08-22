import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import type { DayCloseRow, OverrideRow } from "@/lib/keuangan-input-queries";
import { LABEL_WEWENANG_TIER, type Tier } from "@/lib/keuangan-tutup-hari";
import { pdfText } from "./glyphs";
import { footerKeuangan, gayaKeuangan, kopKeuangan, rupiah, type KopKeuangan } from "./keuangan-kop";
import { CONTENT_WIDTH_PORTRAIT as CW, headerOnlyLayout, th } from "./pdf-layout";
import { KOSONG_RINGKAS } from "./teks-kosong";
import { PDF } from "./pdf-tokens";

/**
 * LAYAR 4 → PDF — **jejak keputusan berwenang** (§10.20). A4 POTRET.
 *
 * ⚠️ Mockup TIDAK meminta tombol ini; ia disusun sebelum tangga §3.2 ada.
 * Penambahannya keputusan owner 21 Agu 2026, bukan tombol yang muncul diam-diam.
 *
 * ⛔ LIMA HAL YANG TAK BOLEH DIRINGKAS — auditorlah pembacanya:
 *  1. selisih APA ADANYA, termasuk yang di dalam toleransi (§3.2 tak pernah
 *     menolkannya; kertas yang menolkannya berbohong lebih awet dari layar);
 *  2. `tier` DAN **siapa yang berwenang pada tier itu** — bukan hanya penekan
 *     tombolnya (`LABEL_WEWENANG_TIER`, yang dijaga sepakat dengan predikatnya);
 *  3. `reason_code` + tanggal target bila kodenya menuntut;
 *  4. jalur `backdate_override` bila hari itu memakainya — pengaju, penyetuju,
 *     kapan dikonsumsi;
 *  5. **langkah harian** yang dinilai, DAN pernyataan bahwa kumulatifnya belum
 *     tersedia.
 *
 * ⛔ HARI YANG BELUM DITUTUP BOLEH DICETAK, dan kertasnya **mengatakan itu di
 *    muka** — kertas tanpa status terbaca sebagai kertas final.
 */
export interface TutupHariDocInput {
  kop: KopKeuangan;
  /** `null` = hari ini belum punya baris penilaian sama sekali. */
  dayClose: DayCloseRow | null;
  /** Selisih yang dinilai layar saat ini (§1.2) — sumber angka bila belum ada baris. */
  langkahHarian: number | null;
  tier: Tier | null;
  overrides: readonly OverrideRow[];
  /** Label kode alasan (dari master), supaya kertas tak hanya memuat kodenya. */
  labelReason: Record<string, string>;
}

function baris(label: string, isi: Content | string): TableCell[] {
  return [
    { text: pdfText(label), fontSize: 8.5, bold: true },
    typeof isi === "string" ? { text: pdfText(isi), fontSize: 8.5 } : isi,
  ];
}

export function buildTutupHariDoc(i: TutupHariDocInput): TDocumentDefinitions {
  const dc = i.dayClose;
  const ditutup = dc?.status === "closed";

  // ⛔ STATUS DI MUKA. Bukan di kaki, bukan sebagai catatan kecil.
  const spanduk: Content = {
    table: {
      widths: [CW - 12],
      body: [
        [
          {
            text: pdfText(
              ditutup
                ? "HARI INI SUDAH DITUTUP — jejak keputusannya di bawah."
                : dc === null
                  ? "HARI INI BELUM PUNYA BARIS PENILAIAN. Selisihnya belum pernah dihitung, " +
                    "jadi lembar ini BUKAN bukti penutupan."
                  : "HARI INI BELUM DITUTUP. Angka di bawah adalah keadaan saat dicetak dan " +
                    "MASIH BISA BERUBAH — lembar ini bukan lembar final.",
            ),
            fontSize: 9,
            bold: true,
            color: ditutup ? PDF.success : PDF.warning,
            margin: [6, 5, 6, 5],
          },
        ],
      ],
    },
    layout: "noBorders",
    fillColor: ditutup ? "#EAF7EE" : "#FEF6E7",
    margin: [0, 0, 0, 10],
  };

  // Selisih APA ADANYA — dari baris DB bila ada, kalau tidak dari penilaian layar.
  const selisih = dc?.differenceRp ?? i.langkahHarian;
  const tier = (dc?.tier ?? i.tier) as Tier | null;

  const isiTabel: TableCell[][] = [
    [th("Butir"), th("Isi")],
    baris(
      "Selisih (langkah harian)",
      selisih === null
        ? { text: KOSONG_RINGKAS, fontSize: 8.5, italics: true, color: PDF.textMuted }
        : {
            // Tak pernah dinolkan, tak pernah dibulatkan ke "nihil" — termasuk
            // yang di dalam toleransi.
            text: `Rp ${rupiah(selisih)}${Math.abs(selisih) < 0.005 ? " (nol persis)" : ""}`,
            fontSize: 8.5,
            bold: true,
            color: Math.abs(selisih) < 0.005 ? PDF.success : PDF.danger,
          },
    ),
    baris("Tier", tier === null ? KOSONG_RINGKAS : tier),
    baris(
      "Wewenang pada tier ini",
      tier === null ? KOSONG_RINGKAS : LABEL_WEWENANG_TIER[tier],
    ),
    baris("Ditutup oleh", dc?.closedByEmail ?? (ditutup ? "(identitas tak diketahui)" : "—")),
    baris("Waktu penutupan", dc?.closedAt ?? "—"),
    baris("Disetujui oleh", dc?.approvedByEmail ?? "—"),
    baris("Waktu persetujuan", dc?.approvedAt ?? "—"),
    baris(
      "Kode alasan",
      dc?.reasonCode == null
        ? "—"
        : `${dc.reasonCode}${i.labelReason[dc.reasonCode] ? ` — ${i.labelReason[dc.reasonCode]}` : ""}`,
    ),
    baris(
      "Tanggal target penyelesaian",
      dc?.targetDate ?? (dc?.reasonRequiresTarget === true ? "WAJIB, tetapi kosong" : "—"),
    ),
  ];

  const isi: Content[] = [
    ...kopKeuangan(i.kop),
    spanduk,
    { table: { headerRows: 1, widths: [170, CW - 170], body: isiTabel }, layout: headerOnlyLayout },
  ];

  // Butir 4 — jalur override, bila hari itu memakainya.
  const aktif = i.overrides.filter((o) => !o.void);
  isi.push({ text: pdfText("Jalur backdate override"), style: "judul", fontSize: 11, margin: [0, 12, 0, 4] });
  if (aktif.length === 0) {
    isi.push({
      text: pdfText("Tidak ada. Hari ini tidak memakai jalur override."),
      fontSize: 8.5,
      color: PDF.textSecondary,
    });
  } else {
    isi.push({
      table: {
        headerRows: 1,
        widths: [90, CW - 330, 80, 80, 80],
        body: [
          [th("Kode"), th("Alasan"), th("Diajukan"), th("Disetujui"), th("Dikonsumsi")],
          ...aktif.map((o): TableCell[] => [
            { text: pdfText(o.reasonCode ?? "—"), fontSize: 8 },
            { text: pdfText(o.alasan ?? "—"), fontSize: 8 },
            { text: pdfText(o.requestedBy ?? "—"), fontSize: 7.5 },
            { text: pdfText(`${o.approvedBy ?? "—"}\n${o.approvedAt ?? ""}`), fontSize: 7.5 },
            { text: pdfText(o.consumedAt ?? "belum"), fontSize: 7.5 },
          ]),
        ],
      },
      layout: headerOnlyLayout,
    });
  }

  // Butir 5 — kumulatifnya BELUM ADA, dan kertas mengatakannya.
  isi.push({
    margin: [0, 12, 0, 0],
    text: pdfText(
      "Yang dinilai gerbang adalah LANGKAH HARIAN di atas. Angka pemeriksa KUMULATIF " +
        "(BSCheck) belum tersedia — saldo pembuka ekuitas belum punya sumber di SolaMax. " +
        "Lembar ini tidak menyembunyikan itu.",
    ),
    fontSize: 7.5,
    color: PDF.textSecondary,
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
