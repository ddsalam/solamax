"use client";

/**
 * Inti workflow ekspor (reusable): kelola status + preview + unduh dari sebuah
 * docDefinition pdfmake. Report lain (Laporan/Usulan) dapat memakainya ulang.
 */
import { useCallback, useState } from "react";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { createPdf } from "./loadPdfMake";

export type ExportStatus = "idle" | "working" | "ready" | "success" | "error";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Gagal membuat PDF";
}

export function usePdfExport() {
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFilename, setLastFilename] = useState<string | null>(null);

  /** Bangun preview (data URL) — dipakai iframe agar preview == output. */
  const preview = useCallback(async (doc: TDocumentDefinitions) => {
    setStatus("working");
    setError(null);
    try {
      const pdf = await createPdf(doc);
      const url = await new Promise<string>((resolve, reject) => {
        try {
          pdf.getDataUrl((u: string) => resolve(u));
        } catch (e) {
          reject(e);
        }
      });
      setPreviewUrl(url);
      setStatus("ready");
    } catch (e) {
      setError(errMsg(e));
      setStatus("error");
    }
  }, []);

  /** Unduh PDF dengan nama file yang ditentukan. */
  const download = useCallback(async (doc: TDocumentDefinitions, filename: string) => {
    setError(null);
    try {
      const pdf = await createPdf(doc);
      pdf.download(filename);
      setLastFilename(filename);
      setStatus("success");
      return true;
    } catch (e) {
      setError(errMsg(e));
      setStatus("error");
      return false;
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setPreviewUrl(null);
    setError(null);
  }, []);

  return { status, previewUrl, error, lastFilename, preview, download, reset };
}
