"use client";

/**
 * Toolbar + workflow ekspor Usulan Penebusan SO (view form) — menggantikan
 * window.print() lama untuk mode form. Link "← Daftar usulan" dipertahankan.
 * PDF dibangun dari model yang SAMA dengan layar (nilai KL identik) + data
 * ber-scope (tak ada fetch baru).
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExportButton } from "@/components/export/ExportButton";
import { ExportDialog } from "@/components/export/ExportDialog";
import { useLogoDataUrl } from "@/components/export/useLogoDataUrl";
import { usePdfExport } from "@/components/export/usePdfExport";
import { DEFAULT_EXPORT_CONFIG, type ExportConfig } from "@/lib/export/config";
import { buildReportFilename } from "@/lib/export/filename";
import { buildUsulanDocDefinition, type UsulanDocMeta } from "@/lib/export/usulan-doc";
import type { UsulanModel } from "@/lib/usulan-model";

export function UsulanExport({
  code,
  businessDate,
  generatedDate,
  model,
  meta,
}: {
  code: string;
  businessDate: string;
  generatedDate: string;
  model: UsulanModel;
  meta: UsulanDocMeta;
}) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<ExportConfig>(DEFAULT_EXPORT_CONFIG);
  const logo = useLogoDataUrl();
  const { status, previewUrl, error, lastFilename, preview, download } = usePdfExport();

  const filename = useMemo(
    () =>
      buildReportFilename({
        reportName: "Usulan-Penebusan-SO",
        unitCode: code,
        period: businessDate,
        generated: generatedDate,
      }),
    [code, businessDate, generatedDate],
  );

  const buildDoc = useCallback(
    (cfg: ExportConfig) => buildUsulanDocDefinition({ model, meta, config: cfg, logoDataUrl: logo }),
    [model, meta, logo],
  );

  useEffect(() => {
    if (!open) return;
    void preview(buildDoc(config));
  }, [open, config, buildDoc, preview]);

  return (
    <div className="lap-toolbar no-print">
      <Link href={`/unit/${code}/usulan/${businessDate}`} className="btn-tint">
        ← Daftar usulan
      </Link>
      <ExportButton
        onDownload={() => void download(buildDoc(config), filename)}
        onOptions={() => setOpen(true)}
        pending={!open && status === "working"}
      />
      <ExportDialog
        open={open}
        title="Ekspor PDF — Usulan Penebusan SO"
        onClose={() => setOpen(false)}
        status={status}
        error={error}
        previewUrl={previewUrl}
        filename={filename}
        lastFilename={lastFilename}
        onDownload={() => void download(buildDoc(config), filename)}
      >
        <div className="export-group">
          <div className="fs15 w700 t-tertiary">Isi</div>
          <label className="export-check">
            <input
              type="checkbox"
              checked={config.includeSignature}
              onChange={(e) => setConfig((c) => ({ ...c, includeSignature: e.target.checked }))}
            />
            <span className="fs15 t-secondary">Sertakan blok tanda tangan</span>
          </label>
        </div>
      </ExportDialog>
    </div>
  );
}
