"use client";

import { Spinner } from "./Spinner";
import { useDelayedFlag } from "./timing";

/**
 * LoadingOverlay — loader LOKAL (rule 5): menutup HANYA ancestor ber-posisi
 * terdekat (bungkus konten), bukan seluruh layar. Spinner di-gate
 * LOADER_DELAY_MS (anti-kedip). Konten lama tetap terlihat samar di belakang
 * (rule 4). `aria-busy` di wadah + `role=status` pada lapisan.
 */
export function LoadingOverlay({
  active,
  label = "Memuat…",
  children,
}: {
  active: boolean;
  label?: string;
  children: React.ReactNode;
}) {
  const show = useDelayedFlag(active);
  return (
    <div className="load-overlay-wrap" aria-busy={active}>
      {children}
      {show && (
        <div className="load-overlay" role="status" aria-live="polite">
          <Spinner size="md" label={label} />
          <span className="load-overlay-msg">{label}</span>
        </div>
      )}
    </div>
  );
}
