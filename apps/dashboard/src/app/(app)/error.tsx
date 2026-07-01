"use client";

import { useEffect } from "react";

/**
 * Error boundary grup (app) — tangkap throw RSC (termasuk statement_timeout 120
 * dtk pada laporan berat) → render keadaan terancang + "Coba lagi" (reset()),
 * BUKAN overlay default Next. Copy Bahasa, ramah. StateView memegang
 * empty/inline-error di dalam komponen; ini menutup level rute.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Jejak ke konsol server/klien; tak menampilkan detail ke pengguna.
    console.error("Render gagal:", error);
  }, [error]);

  return (
    <div className="state-error" role="alert">
      <div className="state-error-title">Halaman gagal dimuat</div>
      <div className="state-error-msg">
        Terjadi kendala saat menyiapkan data. Bila ini laporan berat, server mungkin
        butuh waktu lebih lama dari biasanya. Coba muat ulang, atau pilih rentang/tanggal
        yang lebih singkat.
      </div>
      <div className="state-error-actions">
        <button type="button" className="btn-navy" onClick={() => reset()}>
          Coba lagi
        </button>
      </div>
    </div>
  );
}
