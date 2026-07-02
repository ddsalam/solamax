"use client";

/**
 * Toolbar + workflow ekspor Laporan Operasional Harian — menggantikan
 * window.print() lama. Mempertahankan tab layar Ringkas/Lengkap (URL ?view) &
 * link "Versi ringkas / Cetak" ke Rincian. PDF dibangun dari model yang SAMA
 * dengan layar (angka identik) + data ber-scope (tak ada fetch baru). Toggle
 * lengkap/ringkas PDF terpisah dari view layar (config.detail).
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExportButton } from "@/components/export/ExportButton";
import { ExportDialog } from "@/components/export/ExportDialog";
import { useLogoDataUrl } from "@/components/export/useLogoDataUrl";
import { usePdfExport } from "@/components/export/usePdfExport";
import { DEFAULT_EXPORT_CONFIG, type ExportConfig } from "@/lib/export/config";
import { buildReportFilename } from "@/lib/export/filename";
import { buildLaporanDocDefinition, type LaporanDocMeta } from "@/lib/export/laporan-doc";
import type { LaporanModel } from "@/lib/laporan-model";

export function LaporanExport({
  code,
  businessDate,
  generatedDate,
  detail,
  model,
  meta,
}: {
  code: string;
  businessDate: string;
  generatedDate: string;
  /** View layar saat ini (dari URL ?view). Jadi default toggle PDF. */
  detail: boolean;
  model: LaporanModel;
  meta: LaporanDocMeta;
}) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<ExportConfig>({ ...DEFAULT_EXPORT_CONFIG, detail });
  const logo = useLogoDataUrl();
  const { status, previewUrl, error, lastFilename, preview, download } = usePdfExport();

  const filename = useMemo(
    () =>
      buildReportFilename({
        reportName: "Laporan-Operasional-Harian",
        unitCode: code,
        period: businessDate,
        generated: generatedDate,
      }),
    [code, businessDate, generatedDate],
  );

  const buildDoc = useCallback(
    (cfg: ExportConfig) => buildLaporanDocDefinition({ model, meta, config: cfg, logoDataUrl: logo }),
    [model, meta, logo],
  );

  useEffect(() => {
    if (!open) return;
    void preview(buildDoc(config));
  }, [open, config, buildDoc, preview]);

  return (
    <div className="lap-toolbar no-print">
      <div className="seg">
        <Link
          href={`/unit/${code}/laporan/${businessDate}?view=ringkas`}
          className={`seg-btn${!detail ? " active" : ""}`}
        >
          Ringkas
        </Link>
        <Link
          href={`/unit/${code}/laporan/${businessDate}`}
          className={`seg-btn${detail ? " active" : ""}`}
        >
          Lengkap
        </Link>
      </div>
      <div className="lap-toolbar-right">
        <Link href={`/unit/${code}/rincian/${businessDate}`} className="btn-tint">
          Versi ringkas / Cetak
        </Link>
        <ExportButton
          onDownload={() => void download(buildDoc(config), filename)}
          onOptions={() => setOpen(true)}
          pending={!open && status === "working"}
        />
      </div>

      <ExportDialog
        open={open}
        title="Ekspor PDF — Laporan Operasional Harian"
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
              checked={config.detail}
              onChange={(e) => setConfig((c) => ({ ...c, detail: e.target.checked }))}
            />
            <span className="fs15 t-secondary">Laporan lengkap (semua section)</span>
          </label>
          <span className="fs15 t-tertiary">
            Nonaktif = ringkas (Alarm, Omset/G-L/Tera, Recap saja).
          </span>
        </div>
      </ExportDialog>
    </div>
  );
}
