/**
 * docDefinition pdfmake untuk Laporan Operasional Harian — layout KERTAS A4
 * potret, banyak section (acid test). Murni (tanpa instance pdfmake). Setiap
 * section tabular = tabel sendiri (headerRows:1 + dontBreakRows) → header berulang
 * & baris tak terpotong lintas-halaman; native "Halaman X dari Y". Gating
 * DOMAIN/REKON_READY & ringkas/lengkap (config.detail) mengikuti layar; section
 * gated-empty diomit. Angka via lib/format yang sama dgn layar (identik ke rupiah).
 */
import type { Content, ContentTable, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import type { ExportConfig } from "./config";
import { pdfText } from "./glyphs";
import { CONTENT_WIDTH_PORTRAIT as CW, headerOnlyLayout, ledgerLayout, th } from "./pdf-layout";
import { PDF } from "./pdf-tokens";
import { DOMAIN, REKON_READY } from "@/lib/flags";
import { fmtL, idn, parenNeg, pct, rp, signed } from "@/lib/format";
import { alurSelisihNote, type LaporanModel } from "@/lib/laporan-model";

export interface LaporanDocMeta {
  unitDotted: string;
  unitName: string;
  dateLong: string;
  monthName: string;
  dayOfMonth: number;
  daysInMonth: number;
  /** DO_STALE_DAYS (dari lib/queries) — diteruskan agar builder tetap murni. */
  staleDays: number;
  generatedLabel: string;
}

const glColor = (n: number | null): string =>
  n === null ? PDF.textMuted : n < 0 ? PDF.danger : n > 0 ? PDF.success : PDF.textMuted;

function sectionHeading(title: string, meta?: string): Content {
  return {
    columns: [
      { text: title, style: "sectionTitle", width: "auto" },
      meta ? { text: meta, style: "sectionMeta", alignment: "right", width: "*" } : { text: "", width: "*" },
    ],
    marginTop: 12,
    marginBottom: 3,
  };
}

function table(widths: (number | string)[], body: TableCell[][], headerOnly = false): ContentTable {
  return {
    table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths, body },
    layout: headerOnly ? headerOnlyLayout : ledgerLayout,
    marginBottom: 4,
  };
}

// ── Alarm Indikator ──
function alarmSection(m: LaporanModel): Content[] {
  const visible = m.checks.filter((c) => c.state !== "na");
  if (visible.length === 0) return [];
  const mark = (s: string) => (s === "ok" ? "OK" : s === "fail" ? "x" : s === "provisional" ? "~" : "—");
  const markColor = (s: string) =>
    s === "ok" ? PDF.success : s === "fail" ? PDF.danger : s === "provisional" ? PDF.warning : PDF.textMuted;
  const labelColor = (s: string) =>
    s === "fail" ? PDF.danger : s === "provisional" ? PDF.warning : PDF.textPrimary;
  const body: TableCell[][] = [[th("Cek"), th("Indikator"), th("Catatan")]];
  for (const c of visible) {
    body.push([
      { text: mark(c.state), color: markColor(c.state), bold: true, alignment: "center" },
      { text: pdfText(c.label), color: labelColor(c.state), bold: c.state === "fail" || c.state === "provisional" },
      { text: pdfText(c.note), color: PDF.textMuted, fontSize: 8 },
    ]);
  }
  return [
    sectionHeading(
      "Alarm Indikator",
      `${m.header.scoreText} sesuai${m.header.provisionalCount > 0 ? ` · ${m.header.provisionalCount} sementara` : ""}`,
    ),
    table([28, "*", 220], body),
  ];
}

// ── Omset, Gain(Losses) & Tera ──
function salesSection(m: LaporanModel): Content[] {
  const s = m.sales;
  const body: TableCell[][] = [
    [
      th("Produk"),
      th("Sales (L)", "right"),
      th("Gain/Losses (L)", "right"),
      th("Tera (L)", "right"),
      th("Omzet (Rp)", "right"),
    ],
  ];
  for (const r of s.rows) {
    body.push([
      { text: pdfText(r.nama), color: PDF.textPrimary },
      { text: idn(r.vol), alignment: "right" },
      { text: r.gl !== null ? signed(r.gl) : "—", alignment: "right", color: glColor(r.gl), bold: r.gl !== null && r.gl < 0 },
      { text: r.tera > 0 ? idn(r.tera) : "—", alignment: "right", color: PDF.textMuted },
      { text: rp(r.omzet), alignment: "right", noWrap: true },
    ]);
  }
  const tf = PDF.totalFill;
  body.push([
    { text: "TOTAL", style: "totalCell", fillColor: tf },
    { text: idn(s.totVol), style: "totalCell", alignment: "right", fillColor: tf },
    { text: signed(s.glTotal), bold: true, alignment: "right", color: s.glTotal < 0 ? PDF.danger : PDF.success, fillColor: tf },
    { text: s.totTera > 0 ? idn(s.totTera) : "—", alignment: "right", color: PDF.textMuted, fillColor: tf },
    { text: rp(s.totOmzet), style: "totalCell", alignment: "right", noWrap: true, fillColor: tf },
  ]);

  const lossNote =
    s.glPctDay === null
      ? "Opname penutup tanggal bisnis ini belum ada."
      : s.glProvisional
        ? `Losses harian (RESUME) ${signed(s.glTotal)} L berjalan — belum final, menunggu opname penutup${s.glGarbageCount > 0 ? `; ${s.glGarbageCount} baris dikecualikan` : ""}.`
        : `Losses harian (RESUME) ${signed(s.glTotal)} L = ${pct(Math.abs(s.glPctDay), 2)} dari sales — ambang 100 L / 0,5%${s.glGarbageCount > 0 ? `; ${s.glGarbageCount} baris dikecualikan` : ""}.`;
  const bauranNote = `Bauran NPSO: gasoline ${s.gasMix !== null ? pct(s.gasMix) : "—"} · gasoil ${s.oilMix !== null ? pct(s.oilMix) : "—"}.`;

  return [
    sectionHeading("Omset Penjualan, Gain (Losses) & Tera Harian", "per produk · totalisator nozzle"),
    table(["*", 66, 82, 58, 92], body),
    { text: `${lossNote} ${bauranNote}`, style: "footNote", alignment: "left", marginBottom: 2 },
  ];
}

// ── Saldo + Recap ──
function recapSection(m: LaporanModel): Content[] {
  if (!m.recap.hasRecap) return [];
  const out: Content[] = [sectionHeading("Saldo Hutang/Piutang & Recap Harian")];
  if (m.recap.hasSaldo) {
    const body: TableCell[][] = [[th("Keterangan"), th("Nilai (Rp)", "right")]];
    for (const s of m.recap.saldoRows) {
      body.push([
        { text: s.label },
        {
          text: s.danger ? `(${rp(Math.abs(s.val))})` : rp(s.val),
          alignment: "right",
          noWrap: true,
          color: s.danger ? PDF.danger : PDF.textPrimary,
          bold: s.danger,
        },
      ]);
    }
    out.push(table(["*", 150], body, true));
  }
  const rb: TableCell[][] = [[th("Recap"), th("Nilai (Rp)", "right"), th("Catatan")]];
  for (const b of m.recap.recapBoxes) {
    rb.push([
      { text: b.label },
      { text: rp(b.val), alignment: "right", noWrap: true },
      { text: pdfText(b.note), color: PDF.textMuted, fontSize: 8 },
    ]);
  }
  out.push(table(["*", 120, 160], rb));
  return out;
}

// ── G/L Kumulatif ──
function glMonthlySection(m: LaporanModel, meta: LaporanDocMeta): Content[] {
  const g = m.glMonthly;
  const body: TableCell[][] = [[th("Produk"), th("G/L bulan (L)", "right"), th("% vs vol", "right")]];
  for (const r of g.rows) {
    body.push([
      { text: pdfText(r.nama) },
      { text: `${signed(r.selisih)} L`, alignment: "right", color: glColor(r.selisih), bold: r.selisih < -100 },
      { text: r.vol > 0 ? pct(Math.abs(r.selisih) / r.vol, 2) : "—", alignment: "right", color: PDF.textMuted },
    ]);
  }
  if (g.rows.length === 0)
    body.push([{ text: "Belum ada opname penutup bulan ini.", colSpan: 3, italics: true, color: PDF.textMuted }, "", ""]);
  const metaLine =
    g.glPctMonth !== null
      ? `bulan berjalan 1–${meta.dayOfMonth} ${meta.monthName} · ${signed(g.glMonthTotal)} L · ${pct(Math.abs(g.glPctMonth), 2)}`
      : `bulan berjalan 1–${meta.dayOfMonth} ${meta.monthName}`;
  return [sectionHeading("Gain (Losses) Kumulatif", metaLine), table(["*", 110, 90], body)];
}

// ── Realisasi & Target ──
function targetSection(m: LaporanModel, meta: LaporanDocMeta): Content[] {
  const body: TableCell[][] = [
    [
      th("Produk"),
      th("Penj. Kumulatif", "right"),
      th("Rata²/hari", "right"),
      th("Penerimaan", "right"),
      th("Alokasi/bln", "right"),
      th("(Kurang)/Lebih", "right"),
    ],
  ];
  for (const p of m.target.rows) {
    const selColor =
      p.sel === null ? PDF.textMuted : p.sel < -2000 ? PDF.danger : p.sel < 0 ? PDF.warning : PDF.success;
    body.push([
      { text: pdfText(p.nama) },
      { text: fmtL(p.vol), alignment: "right" },
      { text: fmtL(p.avgPerDay), alignment: "right", color: PDF.textSecondary },
      { text: fmtL(p.terima), alignment: "right", color: PDF.textSecondary },
      { text: p.alok !== null ? fmtL(p.alok) : "—", alignment: "right", color: PDF.textSecondary },
      {
        text: p.sel !== null ? parenNeg(Math.round(p.sel)) : "target belum diisi",
        alignment: "right",
        color: selColor,
        bold: p.sel !== null && p.sel < -2000,
      },
    ]);
  }
  if (m.target.rows.length === 0)
    body.push([{ text: "Belum ada penjualan bulan ini.", colSpan: 6, italics: true, color: PDF.textMuted }, "", "", "", "", ""]);
  return [
    sectionHeading(
      "Realisasi & Target Bulanan",
      `vs prorata ${meta.dayOfMonth}/${meta.daysInMonth} hari · workbook 2026`,
    ),
    table(["*", 74, 68, 68, 68, 84], body),
  ];
}

// ── DO Harian + Alokasi ──
function doSection(m: LaporanModel, staleDays: number): Content[] {
  const d = m.doHarian;
  const full = DOMAIN.do;
  const head: TableCell[] = full
    ? [th("Produk"), th("DO Awal", "right"), th("Penerimaan", "right"), th("Penebusan DO", "right"), th("Sisa DO", "right")]
    : [th("Produk"), th("Penerimaan", "right")];
  const body: TableCell[][] = [head];
  for (const r of d.rows) {
    const warn = full && r.recon !== 0;
    const label = `${r.label}${warn ? " !" : ""}`;
    // Sub-baris di bawah angka Sisa — identik layar: segmen macet + rekonsiliasi
    // alur (baris ⚠ balance: DO Awal + Penebusan − Penerimaan + selisih = Sisa).
    const sisaSub: Content[] = [];
    if (r.sisaMacet > 0)
      sisaSub.push({
        text: `${fmtL(r.sisaBerjalan)} berjalan · ${fmtL(r.sisaMacet)} macet`,
        alignment: "right", fontSize: 7, color: PDF.warning,
      });
    const alurNote = r.recon !== 0 ? alurSelisihNote(r.alurSelisih) : null;
    if (alurNote)
      sisaSub.push({
        text: pdfText(`! ${alurNote}`),
        alignment: "right", fontSize: 7, color: PDF.warning,
      });
    body.push(
      full
        ? [
            { text: label, bold: true, color: warn ? PDF.warning : PDF.textPrimary },
            { text: fmtL(r.doAwal), alignment: "right", color: PDF.textSecondary },
            { text: fmtL(r.penerimaan), alignment: "right", color: PDF.textSecondary },
            { text: fmtL(r.penebusan), alignment: "right", color: PDF.textSecondary },
            sisaSub.length > 0
              ? {
                  stack: [
                    { text: fmtL(r.sisa), alignment: "right", color: warn ? PDF.warning : PDF.textSecondary },
                    ...sisaSub,
                  ],
                }
              : { text: fmtL(r.sisa), alignment: "right", color: warn ? PDF.warning : PDF.textSecondary },
          ]
        : [
            { text: r.label, bold: true },
            { text: fmtL(r.penerimaan), alignment: "right", color: PDF.textSecondary },
          ],
    );
  }
  const tf = PDF.totalFill;
  body.push(
    full
      ? [
          { text: "TOTAL", style: "totalCell", fillColor: tf },
          { text: fmtL(d.totals.doAwal), style: "totalCell", alignment: "right", fillColor: tf },
          { text: fmtL(d.totals.penerimaan), style: "totalCell", alignment: "right", fillColor: tf },
          { text: fmtL(d.totals.penebusan), style: "totalCell", alignment: "right", fillColor: tf },
          { text: fmtL(d.totals.sisa), style: "totalCell", alignment: "right", fillColor: tf },
        ]
      : [
          { text: "TOTAL", style: "totalCell", fillColor: tf },
          { text: fmtL(d.totals.penerimaan), style: "totalCell", alignment: "right", fillColor: tf },
        ],
  );

  const out: Content[] = [
    sectionHeading("Laporan DO Harian"),
    table(full ? ["*", 78, 84, 84, 78] : ["*", 100], body),
  ];
  if (full) {
    out.push({
      text:
        `Sisa DO = saldo LEDGER PENUH per-SO (Σ ditebus − diterima, ≥0; semua riwayat). ` +
        `"!" = alur hari itu tak terserap penuh ke SO-nya: Sisa = DO Awal + Penebusan − Penerimaan + selisih-tak-terserap (tertera di baris). ` +
        `Bagian "macet" umumnya tidak tampil di popup F12 EasyMax — rinci di panel Alokasi.`,
      style: "footNote",
      alignment: "left",
    });
    // Alokasi tidak sesuai
    if (d.suspects.length > 0 || d.suspectsNonaktif.count > 0 || d.anomRows.length > 0) {
      out.push(sectionHeading("Alokasi Penerimaan Tidak Sesuai"));
      if (d.suspects.length > 0 || d.suspectsNonaktif.count > 0) {
        const sb: TableCell[][] = [[th("No. SO · Produk"), th("Outstanding", "right"), th("Sejak", "right")]];
        for (const s of d.suspects)
          sb.push([
            { text: pdfText(`${s.cnoso} · ${s.nama}`) },
            { text: fmtL(s.outstanding), alignment: "right", color: PDF.warning },
            { text: `${s.sejak} · ${s.umur_hari} hr`, alignment: "right", color: PDF.textMuted },
          ]);
        if (d.suspectsNonaktif.count > 0)
          sb.push([
            { text: pdfText(`Produk nonaktif (tanpa tangki) · ${d.suspectsNonaktif.count} SO`), color: PDF.textMuted },
            { text: fmtL(d.suspectsNonaktif.liters), alignment: "right", color: PDF.textMuted },
            { text: "ringkasan", alignment: "right", color: PDF.textMuted },
          ]);
        out.push(table(["*", 90, 90], sb));
      }
      if (d.anomRows.length > 0) {
        const ab: TableCell[][] = [[th("Produk"), th("Tanpa Penebusan", "right"), th("Lebih Terima", "right")]];
        for (const a of d.anomRows)
          ab.push([
            // Label identik layar: produk nonaktif diberi tag "· nonaktif".
            { text: pdfText(`${a.label}${a.aktif ? "" : " · nonaktif"}`), bold: true },
            { text: a.orphan ? fmtL(a.orphan) : "—", alignment: "right", color: PDF.warning },
            { text: a.over_receipt ? fmtL(a.over_receipt) : "—", alignment: "right", color: PDF.warning },
          ]);
        out.push(table(["*", 110, 110], ab));
      }
      out.push({
        text: `DO belum tuntas >${staleDays} hari = kemungkinan salah input di EasyMax — verifikasi & ralat di POS.`,
        style: "footNote",
        alignment: "left",
      });
    }
  }
  return out;
}

// ── Harga ──
function hargaSection(m: LaporanModel): Content[] {
  const full = DOMAIN.hargaBeli;
  const head: TableCell[] = full
    ? [th("Produk"), th("Beli", "right"), th("Jual", "right"), th("Margin", "right"), th("%", "right")]
    : [th("Produk"), th("Jual", "right")];
  const body: TableCell[][] = [head];
  for (const p of m.harga.rows) {
    const jual = p.harga !== null ? rp(p.harga) : "—";
    body.push(
      full
        ? [{ text: pdfText(p.nama), bold: true }, { text: "—", alignment: "right", color: PDF.textMuted }, { text: jual, alignment: "right", color: PDF.textSecondary }, { text: "—", alignment: "right", color: PDF.textMuted }, { text: "—", alignment: "right", color: PDF.textMuted }]
        : [{ text: pdfText(p.nama), bold: true }, { text: jual, alignment: "right", color: PDF.textSecondary }],
    );
  }
  return [sectionHeading(full ? "Harga Beli, Jual & Margin" : "Harga Jual"), table(full ? ["*", 80, 80, 80, 50] : ["*", 120], body)];
}

// ── Rekonsiliasi A–I ──
function rekonSection(m: LaporanModel): Content[] {
  const body: TableCell[][] = [[th("No"), th("Keterangan"), th("", "right"), th("Jumlah", "right")]];
  for (const r of m.rekon.rows) {
    const label: Content[] = [{ text: r.label, bold: r.em, color: PDF.textPrimary }];
    if (r.formula) label.push({ text: r.formula, fontSize: 7.5, color: PDF.textMuted });
    body.push([
      { text: r.l, bold: true, color: PDF.navy },
      { stack: label },
      { text: r.op ?? "", alignment: "right", color: PDF.textMuted },
      {
        text: r.val !== null ? rp(r.val) : "belum tersedia",
        alignment: "right",
        bold: r.em,
        noWrap: true,
        color: r.val !== null ? PDF.textPrimary : PDF.textMuted,
      },
    ]);
  }
  return [
    sectionHeading("Summary Rekonsiliasi", "uang tunai (H) harus sama dengan setoran bank (I)"),
    table([18, "*", 20, 110], body),
    {
      text: "Rekonsiliasi menunggu Domain 4–7 (B tera, C piutang, D EDC, F pendapatan lain, I setoran). Saat lengkap: verdict H = I.",
      style: "footNote",
      alignment: "left",
    },
  ];
}

export function buildLaporanDocDefinition(args: {
  model: LaporanModel;
  meta: LaporanDocMeta;
  config: ExportConfig;
  logoDataUrl?: string;
}): TDocumentDefinitions {
  const { model, meta, config, logoDataUrl } = args;
  const detail = config.detail;

  const kopRight: Content = logoDataUrl
    ? { image: logoDataUrl, width: 120, alignment: "right" }
    : { text: "SolaMax", style: "kopSpbu", alignment: "right" };

  const scopeBits = [
    `Unit: SPBU ${meta.unitDotted} · ${pdfText(meta.unitName)}`,
    `Tanggal bisnis: ${meta.dateLong}`,
    `Alarm: ${model.header.scoreText}`,
    detail ? "Versi: lengkap" : "Versi: ringkas",
    "Mata uang: Rupiah (Rp), lokal id-ID",
  ];

  const content: Content[] = [
    {
      columns: [
        {
          width: "*",
          stack: [
            { text: `SPBU ${meta.unitDotted} · ${pdfText(meta.unitName)}`, style: "kopSpbu" },
            { text: `Tanggal bisnis ${meta.dateLong}`, style: "kopAddr", marginTop: 2 },
          ],
        },
        { width: 130, stack: [kopRight] },
      ],
    },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: CW, y2: 0, lineWidth: 1.2, lineColor: PDF.navy }], marginTop: 6 },
    { text: "LAPORAN OPERASIONAL HARIAN", style: "docTitle", alignment: "center", marginTop: 14 },
    { text: `Tanggal bisnis ${meta.dateLong}`, style: "docDate", alignment: "center", marginBottom: 8 },
    { text: scopeBits.join("   ·   "), style: "scopeLine", marginBottom: 2 },
    ...alarmSection(model),
    ...salesSection(model),
    ...recapSection(model),
  ];

  if (detail) {
    content.push(...glMonthlySection(model, meta));
    content.push(...targetSection(model, meta));
    content.push(...doSection(model, meta.staleDays));
    content.push(...hargaSection(model));
  }
  if (REKON_READY) content.push(...rekonSection(model));

  content.push({
    text:
      `Sumber: EasyMax POS · sinkron tiap 1–5 menit${model.corrections > 0 ? ` · ${model.corrections} revisi hari ini` : ""} · ` +
      `Dibuat ${meta.generatedLabel} WIB`,
    style: "footNote",
    alignment: "center",
    marginTop: 14,
  });

  return {
    content,
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [40, 40, 40, 44],
    info: {
      title: `Laporan Operasional Harian — SPBU ${meta.unitDotted} — ${meta.dateLong}`,
      author: "SolaMax",
      subject: "Laporan Operasional Harian SPBU",
      creator: "SolaMax Dashboard",
    },
    defaultStyle: { font: "Roboto", fontSize: 9, color: PDF.textPrimary, lineHeight: 1.12 },
    header: (currentPage) =>
      currentPage > 1
        ? {
            columns: [
              { text: `Laporan Operasional Harian · SPBU ${meta.unitDotted}`, fontSize: 7.5, color: PDF.textMuted },
              { text: meta.dateLong, fontSize: 7.5, color: PDF.textMuted, alignment: "right" },
            ],
            margin: [40, 20, 40, 0],
          }
        : undefined,
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `SolaMax · Laporan Operasional Harian · SPBU ${meta.unitDotted}`, fontSize: 7.5, color: PDF.textMuted },
        { text: `Halaman ${currentPage} dari ${pageCount}`, fontSize: 7.5, color: PDF.textMuted, alignment: "right" },
      ],
      margin: [40, 12, 40, 0],
    }),
    styles: {
      kopSpbu: { fontSize: 13, bold: true, color: PDF.navy },
      kopAddr: { fontSize: 9, color: PDF.textSecondary },
      docTitle: { fontSize: 16, bold: true, color: PDF.navy, characterSpacing: 1 },
      docDate: { fontSize: 10, color: PDF.textSecondary },
      scopeLine: { fontSize: 8, color: PDF.textMuted },
      sectionTitle: { fontSize: 11, bold: true, color: PDF.navy },
      sectionMeta: { fontSize: 8, color: PDF.textMuted },
      th: { bold: true, color: PDF.onNavy, fontSize: 8 },
      totalCell: { bold: true, color: PDF.navy },
      footNote: { fontSize: 8, color: PDF.textMuted },
    },
  };
}
