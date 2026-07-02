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

/**
 * Nonaktifkan ligatur (fi/fl). Roboto memetakan "fi" ke SATU glyph ligatur yang
 * ToUnicode-nya jatuh ke satu char → teks ter-ekstrak "fsik"/"fnal" (copy, cari,
 * screen-reader rusak) walau CETAKAN terlihat benar. Objek {liga:false} diteruskan
 * pdfmake→pdfkit→fontkit (terbukti memisah glyph f+i, masing-masing ToUnicode benar).
 * @types mengetik fontFeatures sbg string[]; runtime menerima objek → cast.
 */
const DISABLE_LIGATURES = { liga: false, dlig: false } as unknown as NonNullable<
  TDocumentDefinitions["defaultStyle"]
>["fontFeatures"];

/**
 * Terapkan default bersama SEKALI untuk SEMUA laporan (jalur render tunggal):
 * saat ini menonaktifkan ligatur via defaultStyle (diwariskan ke semua run).
 * Tidak menimpa bila laporan sudah menyetel fontFeatures sendiri.
 */
export function applyPdfDefaults(doc: TDocumentDefinitions): TDocumentDefinitions {
  const ds = (doc.defaultStyle ?? {}) as Record<string, unknown>;
  if (ds.fontFeatures !== undefined) return doc;
  return {
    ...doc,
    defaultStyle: { ...ds, fontFeatures: DISABLE_LIGATURES } as TDocumentDefinitions["defaultStyle"],
  };
}

export async function createPdf(doc: TDocumentDefinitions): Promise<CreatedPdf> {
  const pdfMake = await loadPdfMake();
  return pdfMake.createPdf(applyPdfDefaults(doc));
}
