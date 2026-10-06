/**
 * Seksi PDF "G/L Belum terverifikasi" — padanan components/GlUnverifiedPanel
 * untuk laporan operasional, laporan harian, dan board. Isi & urutan dari
 * lib/gl-verification (sumber yang sama dengan layar). Judul ber-headlineLevel
 * 1 + tabel → dijaga keepHeadingsWithTable agar tak yatim.
 */
import type { Content, TableCell } from "pdfmake/interfaces";
import { dateShort } from "@/lib/format";
import {
  GL_AUDIT_HEADING,
  GL_AUDIT_MISSING,
  GL_UNVERIFIED_TITLE,
  GL_VERIFY_CAVEATS,
  GL_VERIFY_STEPS,
  glAuditText,
  glReasonText,
  glTankText,
  glUnverifiedPanel,
  type GlUnverifiedItem,
} from "@/lib/gl-verification";
import { pdfText } from "./glyphs";
import { ledgerLayout, th } from "./pdf-layout";
import { PDF } from "./pdf-tokens";

export function glUnverifiedSection(
  items: GlUnverifiedItem[],
  opts: { hint: string; withUnit?: boolean },
): Content[] {
  if (items.length === 0) return [];
  const p = glUnverifiedPanel(items);
  const withUnit = opts.withUnit ?? false;
  const cell = (text: string, extra: Partial<Record<"color" | "bold", unknown>> = {}): TableCell =>
    ({ text: pdfText(text), fontSize: 7.5, ...extra }) as TableCell;
  const body: TableCell[][] = [[
    th("Tanggal"),
    ...(withUnit ? [th("SPBU")] : []),
    th("Produk"),
    th("Tangki"),
    th("Sebab"),
    th(pdfText(GL_AUDIT_HEADING)),
  ]];
  for (const it of p.shown) {
    body.push([
      cell(dateShort(it.d)),
      ...(withUnit ? [cell(it.unit?.name ?? "—")] : []),
      cell(it.produk, { bold: true }),
      cell(glTankText(it), { color: PDF.textSecondary }),
      cell(glReasonText(it), { color: PDF.textSecondary }),
      cell(glAuditText(it.audit) ?? GL_AUDIT_MISSING, { color: PDF.textSecondary }),
    ]);
  }
  const out: Content[] = [
    {
      // Same shape as the report section headings: title column + meta column.
      columns: [
        { text: GL_UNVERIFIED_TITLE, style: "sectionTitle", width: "auto" },
        { text: pdfText(`${p.total} nilai ditahan · ${opts.hint}`), fontSize: 7.5, color: PDF.textMuted, alignment: "right", width: "*" },
      ],
      marginTop: 12,
      marginBottom: 3,
      headlineLevel: 1,
    } as Content,
    {
      table: {
        headerRows: 1,
        keepWithHeaderRows: 1,
        dontBreakRows: true,
        // Portrait (operational) has no unit column; landscape reports do.
        widths: withUnit ? [52, 72, 72, 50, "*", 190] : [50, 72, 48, "*", 170],
        body,
      },
      layout: ledgerLayout,
      marginBottom: 3,
    },
  ];
  if (p.hidden > 0)
    out.push({
      text: pdfText(`+${p.hidden} nilai lain yang lebih lama tidak ditampilkan — semuanya tetap ditahan dari total.`),
      fontSize: 7, color: PDF.textMuted, marginBottom: 2,
    });
  p.reasons.forEach((r, i) => {
    const s = GL_VERIFY_STEPS[r];
    out.push({
      stack: [
        // Subjudul ikut blok langkah pertamanya (blok kecil, unbreakable): tak yatim.
        ...(i === 0 ? [{ text: "Cara memverifikasi", bold: true, fontSize: 8, color: PDF.navy, marginBottom: 2 }] : []),
        { text: pdfText(s.judul), bold: true, fontSize: 7.5, color: PDF.textSecondary },
        { ol: s.langkah.map((l) => ({ text: pdfText(l), fontSize: 7.5, color: PDF.textSecondary })) },
      ],
      marginTop: 2,
      unbreakable: true,
    } as Content);
  });
  out.push({ text: pdfText(GL_VERIFY_CAVEATS), fontSize: 7, color: PDF.textMuted, marginTop: 3 });
  return out;
}
