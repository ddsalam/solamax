"use client";

import { useDelayedFlag } from "./timing";

/**
 * LoadingButton — ganti flip "…" lama. Saat `pending`: tombol langsung
 * `disabled` + `aria-busy` (anti double-submit, INSTAN), tapi spinner baru
 * muncul setelah LOADER_DELAY_MS (anti-kedip aksi cepat). Mewarisi gaya tombol
 * lewat `className` (.btn-navy/.btn-tint…). Spinner memakai seed .spinner.
 */
export function LoadingButton({
  pending,
  children,
  pendingLabel,
  className = "",
  disabled = false,
  onClick,
  type = "button",
}: {
  pending: boolean;
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  const showSpinner = useDelayedFlag(pending);
  return (
    <button
      type={type}
      className={`${className} btn-spin`}
      disabled={disabled || pending}
      aria-busy={pending}
      onClick={onClick}
    >
      {showSpinner && <span className="spinner sm" aria-hidden="true" />}
      <span>{pending && pendingLabel ? pendingLabel : children}</span>
    </button>
  );
}
