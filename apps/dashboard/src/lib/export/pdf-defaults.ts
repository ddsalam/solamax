import type { TDocumentDefinitions } from "pdfmake/interfaces";

/**
 * Roboto's fi/fl ligatures corrupt copied and searched text in generated PDFs.
 * Keep this server-safe default shared by browser and authenticated exports.
 */
const DISABLE_LIGATURES = { liga: false, dlig: false } as unknown as NonNullable<
  TDocumentDefinitions["defaultStyle"]
>["fontFeatures"];

export function applyPdfDefaults(doc: TDocumentDefinitions): TDocumentDefinitions {
  const defaultStyle = (doc.defaultStyle ?? {}) as Record<string, unknown>;
  if (defaultStyle.fontFeatures !== undefined) return doc;
  return {
    ...doc,
    defaultStyle: {
      ...defaultStyle,
      fontFeatures: DISABLE_LIGATURES,
    } as TDocumentDefinitions["defaultStyle"],
  };
}
