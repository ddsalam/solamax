/**
 * Pemuat pdfmake sisi-klien via dynamic import() — dimuat HANYA saat ekspor
 * dipicu, jadi tidak masuk bundle server (standalone) maupun initial load.
 * Menormalkan bentuk ekspor vfs_fonts yang berbeda antar-build.
 */
import type { TDocumentDefinitions } from "pdfmake/interfaces";

/** Subset yang kita pakai dari pdfmake 0.2.x (API berbasis callback). */
export interface CreatedPdf {
  getDataUrl(cb: (url: string) => void): void;
  download(filename?: string): void;
}

interface PdfMakeLike {
  vfs?: unknown;
  createPdf: (doc: TDocumentDefinitions) => CreatedPdf;
}

let cached: Promise<PdfMakeLike> | null = null;

function loadPdfMake(): Promise<PdfMakeLike> {
  if (!cached) {
    cached = (async () => {
      const [pdfMakeMod, vfsMod] = await Promise.all([
        import("pdfmake/build/pdfmake"),
        import("pdfmake/build/vfs_fonts"),
      ]);
      const pdfMake = ((pdfMakeMod as { default?: PdfMakeLike }).default ??
        (pdfMakeMod as unknown)) as PdfMakeLike;
      // vfs_fonts bisa: map langsung, {default: map}, {pdfMake:{vfs}}, {vfs}.
      const raw = (vfsMod as { default?: unknown }).default ?? (vfsMod as unknown);
      const asObj = raw as { pdfMake?: { vfs?: unknown }; vfs?: unknown };
      pdfMake.vfs = asObj?.pdfMake?.vfs ?? asObj?.vfs ?? raw;
      return pdfMake;
    })();
  }
  return cached;
}

export async function createPdf(doc: TDocumentDefinitions): Promise<CreatedPdf> {
  const pdfMake = await loadPdfMake();
  return pdfMake.createPdf(doc);
}
