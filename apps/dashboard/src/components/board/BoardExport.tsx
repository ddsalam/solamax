"use client";

/**
 * Entry point ekspor board (fresh — board tak punya window.print() lama). Toolbar
 * ringkas: "Unduh PDF" + "Opsi ekspor…". PDF dibangun dari model yang SAMA dengan
 * layar (angka identik) + HANYA unit ber-scope (principle 11 multi-unit).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExportButton } from "@/components/export/ExportButton";
import { ExportDialog } from "@/components/export/ExportDialog";
import { useLogoDataUrl } from "@/components/export/useLogoDataUrl";
import { usePdfExport } from "@/components/export/usePdfExport";
import { DEFAULT_EXPORT_CONFIG } from "@/lib/export/config";
import { buildReportFilename } from "@/lib/export/filename";
import { buildBoardDocDefinition, type BoardDocMeta } from "@/lib/export/board-doc";
import type { BoardModel } from "@/lib/board-model";

export function BoardExport({
  generatedDate,
  model,
  meta,
}: {
  generatedDate: string;
  model: BoardModel;
  meta: BoardDocMeta;
}) {
  const [open, setOpen] = useState(false);
  const logo = useLogoDataUrl();
  const { status, previewUrl, error, lastFilename, preview, download } = usePdfExport();

  const filename = useMemo(
    () =>
      buildReportFilename({
        reportName: "Ringkasan-Direksi",
        scope: "PT Sola Petra Abadi",
        period: generatedDate,
        generated: generatedDate,
      }),
    [generatedDate],
  );

  const buildDoc = useCallback(
    () => buildBoardDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG, logoDataUrl: logo }),
    [model, meta, logo],
  );

  useEffect(() => {
    if (!open) return;
    void preview(buildDoc());
  }, [open, buildDoc, preview]);

  return (
    <div className="lap-toolbar no-print board-export">
      <ExportButton
        onDownload={() => void download(buildDoc(), filename)}
        onOptions={() => setOpen(true)}
        pending={!open && status === "working"}
      />
      <ExportDialog
        open={open}
        title="Ekspor PDF — Ringkasan Direksi"
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
          <span className="fs15 t-secondary">
            A4 lanskap · hanya unit yang dapat Anda lihat · grafik vektor.
          </span>
          <span className="fs15 t-tertiary">
            Periode &amp; verdict mengikuti tampilan board saat ini.
          </span>
        </div>
      </ExportDialog>
    </div>
  );
}
