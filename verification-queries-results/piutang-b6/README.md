# Bukti visual B6 — Saldo Piutang per Pelanggan

Diambil 10 September 2026 dari build lokal branch
`codex/piutang-build-b6` yang membaca fixture sintetis di
`solamax:asia-southeast2:solamax-pg-rlsstg`. Tidak ada data produksi yang
disalin. Fixture dibersihkan setelah pengambilan gambar; verifikasi akhir
menemukan nol pointer, row, manifest, source cycle, dan pelanggan fixture.

| Bukti | Keadaan yang dibuktikan |
|---|---|
| [01-ready-desktop.png](screenshots/01-ready-desktop.png) | Snapshot siap, tiga bucket terpisah, batas Awal/Akhir, provenance, filter, dan tabel |
| [02-not-ready.png](screenshots/02-not-ready.png) | Snapshot belum siap tanpa angka, tabel, atau ekspor numerik |
| [03-zero-saldo-filtered.png](screenshots/03-zero-saldo-filtered.png) | Pelanggan `NOL/02` tetap hadir dengan enam `Rp0` dan penanda saldo nol |
| [04-no-online.png](screenshots/04-no-online.png) | Unit tanpa pelanggan berkode titik tidak menampilkan seksi Online |
| [05-pagination-page-2.png](screenshots/05-pagination-page-2.png) | Paginasi 50 baris dan state URL pada halaman kedua |
| [07-detail-slash-code.png](screenshots/07-detail-slash-code.png) | Detail pelanggan dengan kode yang mengandung `/` serta slot aktivitas masa depan |
| [08-mixed-ready-not-ready.png](screenshots/08-mixed-ready-not-ready.png) | Tanggal yang sama dapat siap pada satu unit dan belum siap pada unit lain |

Identitas `visual-fixture@local.invalid` yang tampak pada gambar hanya dipakai
oleh harness lokal saat screenshot. Bypass tersebut dihapus sebelum verifikasi,
build, dan commit final; tidak menjadi bagian dari perubahan B6.
