"use client";

import { Spinner } from "./Spinner";
import { useDelayedFlag } from "./timing";

/**
 * StateView — bedakan empat keadaan secara eksplisit (rule 8): loading / empty /
 * error / success. Memperluas gaya yang sudah ada (.na-panel / .empty-inline),
 * bukan menduplikasi. `inline` = baris ringkas (dipakai area pesan form: error
 * role=alert, success role=status). Block = panel penuh dengan tombol "Coba
 * lagi" opsional. Loader di-gate LOADER_DELAY_MS (anti-kedip).
 */
export type ViewState = "loading" | "empty" | "error" | "success";

export function StateView({
  state,
  children,
  loadingLabel = "Memuat…",
  emptyText = "Belum ada data.",
  error,
  successText,
  onRetry,
  inline = false,
}: {
  state: ViewState;
  children?: React.ReactNode;
  loadingLabel?: string;
  emptyText?: string;
  error?: string | null;
  successText?: string | null;
  onRetry?: () => void;
  inline?: boolean;
}) {
  const showLoader = useDelayedFlag(state === "loading");

  if (state === "loading") {
    if (!showLoader) return null;
    return (
      <div className="state-loading" role="status" aria-busy="true" aria-live="polite">
        <Spinner size="md" label={loadingLabel} />
        <span className="fs15 t-secondary">{loadingLabel}</span>
      </div>
    );
  }

  if (state === "empty") {
    return <div className="empty-inline">{emptyText}</div>;
  }

  if (state === "error") {
    if (inline) {
      return (
        <span className="fs15 t-danger" role="alert">
          {error ?? "Terjadi kesalahan."}
        </span>
      );
    }
    return (
      <div className="state-error" role="alert">
        <div className="state-error-title">Gagal memuat</div>
        <div className="state-error-msg">{error ?? "Terjadi kesalahan."}</div>
        {onRetry && (
          <div className="state-error-actions">
            <button type="button" className="btn-tint sm" onClick={onRetry}>
              Coba lagi
            </button>
          </div>
        )}
      </div>
    );
  }

  // success
  if (successText) {
    return (
      <span className="fs15 w600 t-success" role="status" aria-live="polite">
        {successText}
      </span>
    );
  }
  return <>{children}</>;
}
