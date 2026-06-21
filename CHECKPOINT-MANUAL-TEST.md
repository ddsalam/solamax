# Checkpoint — Manual Test (Rincian Penjualan F1a–F1c + 3 temuan)

Server: **http://localhost:3000** (dev, sudah jalan). DB lokal seeded **2026‑06‑14** (sample kecil; angka
TIDAK harus = PDF — itu verifikasi staging. Lokal = uji PERILAKU). Unit: `6478111`.

## A. Pra-flight
- [ ] Buka http://localhost:3000 → **login Google** (email yang di-invite). Mendarat di Hub `/`.
- [ ] Tak ada error merah di layar / console DevTools saat load.

## B. Tiga temuan (fokus checkpoint)

### Finding 1 — Omset §1 (artefak data, bukan bug; sembuh via T2)
- [ ] `/unit/6478111/rincian/2026-06-14` → **§1 OMSET PENJUALAN TERISI** (ada baris produk + total).
- [ ] Buka `/unit/6478111/laporan/2026-06-14` → **Omset hari ini = angka yang SAMA** dgn §1 Rincian (paritas).
- [ ] `/unit/6478111/rincian/2026-06-17` → §1 **kosong "Tidak ada transaksi"** = BENAR (tak ada sales 17‑Jun;
      DB hanya 01/14/15). Bukan bug.

### Finding 2 — picker (unit+tanggal) sinkron URL
- [ ] Di `/rincian/2026-06-14`, **input tanggal topbar = 14**, bukan tanggal cookie basi.
- [ ] Ubah tanggal di topbar → 2026‑06‑15 → URL pindah ke `/rincian/2026-06-15` DAN input menampilkan **15**
      (tak balik ke nilai lama).
- [ ] Klik Sidebar **"Laporan Operasional"** dari Rincian 14‑Jun → mendarat `/laporan/2026-06-14` (tanggal
      DIPERTAHANKAN, bukan lompat ke tanggal cookie).
- [ ] Klik balik Sidebar **"Rincian Penjualan"** → kembali `/rincian/2026-06-14` (tanggal tetap).
- [ ] (Multi-unit, jika ada >1 unit) ganti unit di topbar di rute laporan → URL & picker ikut unit baru.
- [ ] Halaman grup-wide (`/board`, `/monitoring/ketaatan`) → picker pakai seed cookie (boleh beda dari rute
      laporan) — TIDAK regресi.

### Finding 3 — mata uang negatif tampil minus
- [ ] Di Rincian 14‑Jun, lihat **Summary** (A–I). Catat nilai **H (Uang Tunai = E+F−G)**.
- [ ] **Paksa H negatif:** di panel "Input manual (pengawas)" seksi **6 · Pengeluaran**, tambah satu entri
      Pengeluaran dgn jumlah BESAR (mis. 999.000.000) → submit. Summary **G** naik, **H jadi negatif** dan
      tampil **`−Rp …`** (ada tanda minus), bukan positif menyesatkan.
- [ ] Hapus entri uji (klik **Batalkan**) → H kembali normal.

## C. Halaman Rincian — seksi auto (F1c) @ 14‑Jun
- [ ] **§2 PELANGGAN** terisi (sampel) — nama pelanggan + Volume + Rupiah; TOTAL PELANGGAN tampil.
- [ ] **§3 EDC** terisi per-channel (nama dari master card) + TOTAL EDC. Jika ada blank-card → **meta seksi
      menampilkan "⚠ blank-card …"** (tidak disembunyikan).
- [ ] **§5 PENDAPATAN NON TUNAI** (deposit) terisi (1 baris sampel).
- [ ] **Summary A–I**: A=Omset, C=Pelanggan, D=EDC tampil angka; E = A−(B+C+D); H = E+F−G; B (Terra) & I
      (Setoran) kosong/disembunyikan (di luar lingkup v1) — TIDAK menampilkan nilai palsu.
- [ ] `?kosong=tampil` (tambahkan ke URL) → seksi kosong muncul dgn "Tidak ada transaksi" (auto-heal toggle).

## D. Input manual (seksi 4 & 6) — server action ber-scope
- [ ] Seksi **4 · Pendapatan Lain**: tambah entri (keterangan + jumlah) → muncul di daftar + §4 + Summary **F**
      naik. **Batalkan** (void) → hilang dari daftar + F turun.
- [ ] Seksi **6 · Pengeluaran**: idem → Summary **G**.
- [ ] Validasi: jumlah kosong / 0 / keterangan kosong → tombol Tambah disabled atau pesan error (tak tertulis).
- [ ] (Keamanan, opsional) entri manual hanya tertulis utk unit dalam scope — di-tegakkan server
      (`requireUnit`); tak bisa diuji via UI tanpa unit lain (lihat unit test `manual-entry-actions.test.ts`).

## E. Regresi / invariants
- [ ] Halaman lain tetap jalan: `/board`, `/unit/6478111/laporan/2026-06-14`, `/monitoring`,
      `/monitoring/denah/6478111`, `/monitoring/ketaatan` — render tanpa error.
- [ ] Tak ada nilai mata uang lain yang rusak akibat fix `rp()` (positif tetap `Rp …`).
- [ ] Refresh halaman Rincian (AutoRefresh 60s atau F5) → picker tetap = tanggal URL (tak balik ke cookie).

## Catatan
- Angka lokal = sampel kecil, BUKAN cocok-PDF. Verifikasi angka vs PDF 14–18 Jun = **staging** (E2E Dion).
- Headless (tanpa browser): `pnpm --filter @solamax/dashboard exec vitest run src/lib/format.test.ts src/lib/selection-keys.test.ts` + `pnpm check`.
