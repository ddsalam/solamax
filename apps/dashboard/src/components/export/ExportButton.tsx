"use client";

/**
 * Entry point ekspor (Prinsip 1): tombol utama "Unduh PDF" (satu klik, default
 * bagus) + "Opsi ekspor…" untuk membuka panel konfigurasi + preview.
 */
import { LoadingButton } from "@/components/loading/LoadingButton";

export function ExportButton({
  onDownload,
  onOptions,
  pending = false,
}: {
  onDownload: () => void;
  onOptions: () => void;
  pending?: boolean;
}) {
  return (
    <div className="export-actions">
      <LoadingButton
        pending={pending}
        pendingLabel="Menyiapkan…"
        className="btn-navy"
        onClick={onDownload}
      >
        Unduh PDF
      </LoadingButton>
      <button type="button" className="btn-tint" onClick={onOptions} disabled={pending}>
        Opsi ekspor…
      </button>
    </div>
  );
}
