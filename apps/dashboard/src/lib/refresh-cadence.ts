/**
 * Kadensi auto-refresh per KELAS RUTE — aturan MURNI (tanpa import), teruji unit.
 *
 * AKAR MASALAH (diukur di produksi pilot, log Cloud Run 23–30 Jul 2026):
 * `<AutoRefresh seconds={60} />` dipasang di layout `(app)`, jadi SETIAP halaman
 * yang tab-nya terbuka memicu render RSC penuh tiap 60 detik. Hasilnya
 * **79,6% dari SELURUH detik-render halaman = ±94,7 menit/hari** dihabiskan untuk
 * auto-refresh, bukan untuk navigasi pengguna:
 *
 *   rute                          n     detik   %detik-dari-poll   detik/poll
 *   /unit/[code]/laporan/[date]  5725   32.170        90,0%          5,48
 *   /laporan-harian              1232    8.787        45,9%          7,08
 *   /unit/[code]/rincian/[date]  4195    4.537        75,1%          0,93
 *   /board                        399    1.933        83,5%          6,36
 *   /monitoring/denah/[code]     1041    1.115        92,0%          1,21
 *   /monitoring/ketaatan          149      132        14,2%          2,35
 *
 * Angka itu memisahkan dua kelas dengan tegas: poll halaman **realtime** MURAH
 * (denah 1,21 dtk — ia memang harus sering, ATG live), poll halaman **analisa**
 * MAHAL (5,48–7,08 dtk, dan pada beban puncak merosot ke 24–44 dtk — itulah yang
 * menyaturasi pool dan merobohkan halaman yang sudah tampil; 3 dari 6 kegagalan
 * `/board` yang teramati terjadi pada permintaan poll, bukan navigasi).
 *
 * KENAPA analisa TIDAK dimatikan sama sekali, padahal itu opsi yang sah:
 * badge kesegaran shell menerima `lastSync` sebagai ISO dari server tetapi teks
 * relatifnya ("Sinkron terlama: X, 2 mnt lalu") hanya dihitung **saat render**.
 * Tanpa refresh sama sekali, badge itu MEMBEKU dan terus berbunyi "2 mnt lalu"
 * selamanya — pengawas akan melihat pernyataan kesegaran yang salah, yang lebih
 * buruk daripada tak ada badge. Mematikannya baru jujur setelah badge dibuat
 * menua sendiri di klien; itu pekerjaan terpisah. Sampai saat itu: perlambat,
 * jangan matikan.
 *
 * 300 dtk dipilih karena ia batas atas yang masih membuat badge jujur (kesegaran
 * salah maksimal 5 menit, sementara kadensi ingest agent ±per menit) sambil
 * memotong biaya poll analisa 5×.
 */

/** Halaman realtime (ATG live / kepatuhan) — kadensi TIDAK diturunkan. */
export const REFRESH_REALTIME_S = 60;

/** Halaman analisa (board, laporan, rincian, usulan, hub, admin). */
export const REFRESH_ANALISA_S = 300;

/**
 * Detik antar auto-refresh untuk sebuah pathname.
 *
 * Subtree `/monitoring` = realtime. Sisanya = analisa. Pencocokan sengaja
 * `=== "/monitoring"` ATAU berawalan `"/monitoring/"` — bukan `startsWith("/monitoring")`
 * telanjang, supaya rute hipotetis seperti `/monitoringx` tidak ikut terklasifikasi
 * realtime secara diam-diam.
 */
export function refreshSecondsFor(pathname: string): number {
  const realtime = pathname === "/monitoring" || pathname.startsWith("/monitoring/");
  return realtime ? REFRESH_REALTIME_S : REFRESH_ANALISA_S;
}
