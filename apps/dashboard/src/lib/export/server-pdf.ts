import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { applyPdfDefaults } from "./pdf-defaults";

/** Server-only pdfmake bridge used by authenticated export handlers. */
export async function renderPdfBuffer(doc: TDocumentDefinitions): Promise<Buffer> {
  const [pdfMakeModule, fontsModule] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  type PdfMake = {
    vfs?: unknown;
    createPdf(definition: TDocumentDefinitions): { getBuffer(cb: (buffer: Buffer) => void): void };
  };
  const pdfMake = ((pdfMakeModule as { default?: PdfMake }).default ?? pdfMakeModule) as PdfMake;
  const raw = (fontsModule as { default?: unknown }).default ?? fontsModule;
  const fonts = raw as { pdfMake?: { vfs?: unknown }; vfs?: unknown };
  pdfMake.vfs = fonts.pdfMake?.vfs ?? fonts.vfs ?? raw;
  return new Promise((resolve) => pdfMake.createPdf(applyPdfDefaults(doc)).getBuffer(resolve));
}
