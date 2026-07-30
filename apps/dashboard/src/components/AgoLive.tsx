"use client";

import { useEffect, useState } from "react";
import { ago } from "@/lib/format";

/**
 * Teks kesegaran yang MENUA SENDIRI di klien ("2 mnt lalu" → "3 mnt lalu")
 * tanpa render ulang server dan tanpa satu pun permintaan jaringan.
 *
 * AKAR MASALAH: `ago(iso, now = new Date())` menghitung teks relatif **saat
 * dipanggil**, dan ia dipanggil di dalam render. Selama shell di-refresh tiap 60
 * detik itu tak terlihat; begitu kadensi analisa turun ke 300 dtk (PR #164) teks
 * itu jadi basi sampai 5 menit, dan kalau auto-refresh halaman analisa nanti
 * dimatikan sama sekali ia MEMBEKU selamanya — badge yang terus berbunyi
 * "2 mnt lalu" sementara agent sudah mati berjam-jam. Itu kelas cacat yang sama
 * dengan insiden Bakau 34 jam (badge hijau, agent mati): alat pengawasan yang
 * menyatakan kesegaran SALAH lebih buruk daripada yang tak menyatakan apa pun.
 *
 * Komponen ini adalah PRASYARAT untuk mematikan auto-refresh halaman analisa.
 * Ia TIDAK mengubah kadensi apa pun — lihat `lib/refresh-cadence.ts`.
 *
 * HIDRASI. Render pertama memakai `awal`, yaitu string yang **sudah dihitung di
 * server** dan dikirim sebagai prop. Ia identik pada pass SSR dan pass hidrasi
 * karena ia data, bukan hasil `new Date()` yang dievaluasi dua kali. Menghitung
 * `ago(iso)` langsung di render awal TIDAK aman: pass SSR memakai jam server dan
 * pass hidrasi memakai jam klien, jadi teksnya bisa berbeda tepat di batas
 * pembulatan menit. (Ketidakcocokan laten itu sudah ada sebelum PR ini di
 * AppShell/Sidebar — ikut tertutup di sini.)
 *
 * Setelah mount, efek langsung menghitung ulang sekali (mengoreksi selisih
 * SSR→hidrasi) lalu menyalakan ticker.
 */
export function AgoLive({ iso, awal }: { iso: string; awal: string }) {
  const [teks, setTeks] = useState(awal);

  useEffect(() => {
    const hitung = () => setTeks(ago(iso));
    hitung(); // koreksi jeda SSR → hidrasi, sebelum tick pertama
    // 30 dtk: satuan terkecil teks ini adalah MENIT, jadi 30 dtk membatasi
    // keterlambatan di setengah satuan. Per-detik hanya menambah render tanpa
    // pernah mengubah teks. Murni hitungan lokal — nol permintaan jaringan.
    const id = setInterval(hitung, 30_000);
    return () => clearInterval(id);
  }, [iso]);

  return <>{teks}</>;
}
