"use client";

import React from "react";
import { useRouter } from "next/navigation";

/**
 * Error boundary PER-SEKSI untuk board.
 *
 * AKAR MASALAH: `board/page.tsx` men-stream beberapa seksi lewat `<Suspense>`,
 * tetapi tak ada boundary di antaranya — satu seksi yang melempar menjatuhkan
 * SELURUH halaman ke error boundary grup `(app)`, padahal filter, KPI, tren,
 * ranking, dan anomali sudah ter-render. Itulah gejala yang teramati:
 * "KPI sempat muncul, lalu halaman berubah jadi gagal".
 *
 * `error.tsx` di dalam `board/` TIDAK menyelesaikan ini: ia membungkus seluruh
 * segmen, jadi error di seksi mana pun tetap mengganti seluruh halaman — hanya
 * boundary-nya yang pindah lebih dekat. Yang dibutuhkan adalah boundary di
 * sekeliling TIAP `<Suspense>`, dengan fallback sendiri.
 *
 * ⚠️ Ini BUKAN perbaikan akar. Timeout koneksi pada jendela G/L yang belum
 *    ter-cache tetap bisa terjadi; yang berubah adalah akibatnya — halaman
 *    tetap berguna, hanya blok yang gagal yang turun anggun. Perbaikan akar =
 *    menurunkan biaya query G/L (pekerjaan terpisah).
 *
 * Error boundary WAJIB class component (React tak punya versi hook).
 */
export class SectionBoundary extends React.Component<
  { judul: string; children: React.ReactNode },
  { gagal: boolean }
> {
  state = { gagal: false };

  static getDerivedStateFromError() {
    return { gagal: true };
  }

  render() {
    if (!this.state.gagal) return this.props.children;
    return <SectionFallback judul={this.props.judul} />;
  }
}

/** Fallback: sebut seksi mana yang gagal, dan beri jalan keluar yang nyata. */
function SectionFallback({ judul }: { judul: string }) {
  const router = useRouter();
  return (
    <div className="card card-pad mt5 section-fallback">
      <div className="fs16 w600 t-warning">{judul} tidak tersedia untuk rentang ini</div>
      <p className="fs15 t-secondary mt2">
        Server butuh waktu lebih lama dari biasanya menyiapkan bagian ini. Bagian lain di
        halaman ini tetap sahih. Coba lagi, atau pilih rentang tanggal yang lebih pendek.
      </p>
      <button type="button" className="btn-outline mt3" onClick={() => router.refresh()}>
        Coba lagi
      </button>
    </div>
  );
}
