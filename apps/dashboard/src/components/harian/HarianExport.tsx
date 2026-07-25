"use client";

/**
 * Entry ekspor PDF Laporan Harian — pola BoardExport. PDF dibangun dari MODEL
 * yang SAMA dengan layar (angka identik) + HANYA unit ber-scope. Client-side
 * pdfmake (lazy) via usePdfExport.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExportButton } from "@/components/export/ExportButton";
import { ExportDialog } from "@/components/export/ExportDialog";
import { useLogoDataUrl } from "@/components/export/useLogoDataUrl";
import { usePdfExport } from "@/components/export/usePdfExport";
import { buildReportFilename } from "@/lib/export/filename";
import { buildHarianDocDefinition, type HarianDocMeta } from "@/lib/export/harian-doc";
import type { HarianModel } from "@/lib/harian-model";

export function HarianExport({ model, meta }: { model: HarianModel; meta: HarianDocMeta }) {
  const [open, setOpen] = useState(false);
  const logo = useLogoDataUrl();
  const { status, previewUrl, error, lastFilename, preview, download } = usePdfExport();

  const filename = useMemo(
    () => buildReportFilename({ reportName: "Laporan-Harian", scope: meta.ptLabel, period: model.date, generated: model.date }),
    [meta.ptLabel, model.date],
  );

  const buildDoc = useCallback(
    () => buildHarianDocDefinition({ model, meta, logoDataUrl: logo }),
    [model, meta, logo],
  );

  useEffect(() => {
    if (!open) return;
    void preview(buildDoc());
  }, [open, buildDoc, preview]);

  return (
    <div className="lap-toolbar no-print">
      <ExportButton onDownload={() => void download(buildDoc(), filename)} onOptions={() => setOpen(true)} pending={!open && status === "working"} />
      <ExportDialog
        open={open}
        title="Ekspor PDF — Laporan Harian Total"
        onClose={() => setOpen(false)}
        status={status}
        error={error}
        previewUrl={previewUrl}
        filename={filename}
        lastFilename={lastFilename}
        onDownload={() => void download(buildDoc(), filename)}
        orientation="landscape"
      >
        <div className="export-group">
          <div className="fs15 w700 t-tertiary">Dokumen</div>
          <span className="fs15 t-secondary">A4 lanskap · hanya unit yang dapat Anda lihat · grafik vektor.</span>
          <span className="fs15 t-tertiary">Penanda data-basi, provisional, dan penutup-nol ikut tercetak.</span>
        </div>
      </ExportDialog>
    </div>
  );
}
