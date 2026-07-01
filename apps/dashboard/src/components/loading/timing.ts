"use client";

import { useEffect, useState } from "react";

/**
 * Ambang anti-kedip untuk loader DALAM-komponen (StateView / LoadingOverlay /
 * spinner LoadingButton): jangan tampilkan spinner bila aksi selesai < 200 ms,
 * supaya aksi cepat tak berkedip. CATATAN: ini TIDAK berlaku untuk route
 * `loading.tsx` — Next merendernya instan saat navigasi (itu justru obat layar
 * beku). Lihat AUTH-RBAC / catatan loading-states.
 */
export const LOADER_DELAY_MS = 200;

/** True hanya setelah `active` bertahan ≥ `delayMs`. Reset saat `active` mati. */
export function useDelayedFlag(active: boolean, delayMs: number = LOADER_DELAY_MS): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const id = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(id);
  }, [active, delayMs]);
  return shown;
}
