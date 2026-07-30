"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useTransition } from "react";
import { Spinner } from "@/components/loading/Spinner";
import { refreshSecondsFor } from "@/lib/refresh-cadence";

/**
 * Poll: refresh data server component tiap N detik. router.refresh() dibungkus
 * useTransition → `isPending` benar selama RSC dimuat ulang. Indikator
 * "memperbarui…" = pil SUDUT TERTANCAP (position:fixed, di LUAR alur dokumen) →
 * NOL pergeseran tata letak (rule 9). Konten lama tetap tampil selama refresh
 * (rule 4): refresh lunak Next tak pernah mengosongkan layar.
 *
 * DUA PEMBATAS, keduanya lahir dari pengukuran produksi (lihat lib/refresh-cadence.ts):
 *
 * 1. **Jeda saat tab tersembunyi.** Timer browser tetap menyala di tab latar
 *    (Chrome hanya membatasinya jadi ±1×/menit — persis kadensi lama), jadi tab
 *    yang ditinggal terbuka semalaman terus menagih render RSC penuh yang TAK
 *    SEORANG PUN LIHAT. Poll berhenti saat `visibilityState !== "visible"` dan
 *    dilanjutkan saat kembali.
 *
 * 2. **Kadensi per kelas rute.** 60 dtk masuk akal untuk denah ATG live (poll-nya
 *    1,21 dtk); ia tidak masuk akal untuk halaman analisa yang satu poll-nya
 *    5,5–7 dtk dan merosot ke 24–44 dtk saat pool tertekan.
 *
 * Saat tab kembali terlihat, refresh SEKALI segera — tetapi hanya bila jeda
 * tersembunyinya sudah melampaui kadensi. Tanpa syarat itu, sekadar berpindah
 * tab sebentar (alt-tab ke Excel lalu balik) memicu render penuh yang datanya
 * belum berubah — mengganti satu pemborosan dengan pemborosan lain.
 */
export function AutoRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const seconds = refreshSecondsFor(pathname);

  /** Kapan halaman ini terakhir punya data segar (render server = juga "segar"). */
  const lastAt = useRef(Date.now());

  const refresh = useCallback(() => {
    lastAt.current = Date.now();
    startTransition(() => router.refresh());
  }, [router]);

  // Navigasi = data baru dari server. Tanpa ini, kembali ke tab setelah pindah
  // halaman akan dihitung basi padahal barusan dirender.
  useEffect(() => {
    lastAt.current = Date.now();
  }, [pathname]);

  useEffect(() => {
    const ms = seconds * 1000;
    let id: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      if (id !== undefined) {
        clearInterval(id);
        id = undefined;
      }
    };
    // Idempoten: dipanggil dari mount DAN dari visibilitychange; tanpa penjaga
    // `id === undefined`, tab yang ditampilkan berulang akan menumpuk interval.
    const start = () => {
      if (id === undefined) id = setInterval(refresh, ms);
    };

    const sinkronkan = () => {
      if (document.visibilityState !== "visible") {
        stop();
        return;
      }
      if (Date.now() - lastAt.current >= ms) refresh();
      start();
    };

    sinkronkan();
    document.addEventListener("visibilitychange", sinkronkan);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", sinkronkan);
    };
  }, [seconds, refresh]);

  if (!isPending) return null;
  return (
    <div className="refresh-pill no-print" role="status" aria-live="polite">
      <Spinner size="sm" inline label="Memperbarui data" />
      <span>Memperbarui…</span>
    </div>
  );
}
