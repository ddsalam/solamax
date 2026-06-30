"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { Spinner } from "@/components/loading/Spinner";

/**
 * Poll sederhana: refresh data server component tiap N detik. router.refresh()
 * dibungkus useTransition → `isPending` benar selama RSC dimuat ulang. Indikator
 * "memperbarui…" = pil SUDUT TERTANCAP (position:fixed, di LUAR alur dokumen) →
 * NOL pergeseran tata letak (rule 9). Konten lama tetap tampil selama refresh
 * (rule 4): refresh lunak Next tak pernah mengosongkan layar.
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const id = setInterval(() => {
      startTransition(() => router.refresh());
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);

  if (!isPending) return null;
  return (
    <div className="refresh-pill no-print" role="status" aria-live="polite">
      <Spinner size="sm" inline label="Memperbarui data" />
      <span>Memperbarui…</span>
    </div>
  );
}
