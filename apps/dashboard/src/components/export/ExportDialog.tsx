"use client";

/**
 * Shell panel ekspor (reusable): kolom opsi (children) + preview PDF live
 * (iframe dari data URL → preview == output, Prinsip 9) + aksi unduh + status
 * idle/working/ready/success/error via loading-kit.
 */
import { useEffect } from "react";
import { LoadingButton } from "@/components/loading/LoadingButton";
import { Spinner } from "@/components/loading/Spinner";
import type { ExportStatus } from "./usePdfExport";

export function ExportDialog({
  open,
  title,
  onClose,
  children,
  status,
  error,
  previewUrl,
  filename,
  lastFilename,
  onDownload,
  orientation = "portrait",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  status: ExportStatus;
  error: string | null;
  previewUrl: string | null;
  filename: string;
  lastFilename: string | null;
  onDownload: () => void;
  orientation?: "portrait" | "landscape";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const working = status === "working";

  return (
    <div className="export-backdrop" onClick={onClose} role="presentation">
      <div
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="export-head">
          <span className="fs16 w700 t-brand">{title}</span>
          <button type="button" className="export-close" aria-label="Tutup" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="export-body">
          <div className="export-opts">
            {status === "success" && lastFilename && (
              <div className="export-success" role="status">
                <span className="dot success" /> Berhasil diunduh: <strong>{lastFilename}</strong>
              </div>
            )}
            {children}
            <div className="export-filename">
              <span className="fs15 t-tertiary">Nama file</span>
              <span className="fs15 t-secondary mono export-filename-val">{filename}</span>
            </div>
          </div>

          <div className="export-preview-wrap">
            {working && (
              <div className="export-preview-state">
                <Spinner size="md" label="Menyusun preview…" />
                <span className="fs15 t-tertiary mt2">Menyusun preview…</span>
              </div>
            )}
            {status === "error" && (
              <div className="export-preview-state">
                <span className="fs16 w600 t-danger">Gagal membuat PDF</span>
                <span className="fs15 t-tertiary mt1">{error}</span>
              </div>
            )}
            {!working && status !== "error" && previewUrl && (
              <iframe className="export-preview" src={previewUrl} title="Preview PDF" />
            )}
          </div>
        </div>

        <div className="export-foot">
          <span className="fs15 t-tertiary">
            A4 · {orientation === "landscape" ? "lanskap" : "potret"} · id-ID · WIB
          </span>
          <div className="export-foot-actions">
            <button type="button" className="btn-tint" onClick={onClose}>
              Tutup
            </button>
            <LoadingButton
              pending={working}
              pendingLabel="Menyiapkan…"
              className="btn-navy"
              onClick={onDownload}
            >
              Unduh PDF
            </LoadingButton>
          </div>
        </div>
      </div>
    </div>
  );
}
