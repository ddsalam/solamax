# Mockup Modul Keuangan — acuan rancangan Layar 1–5

`layar-1-5.html` adalah **salinan versi-terkendali** dari mockup *"SolaMax —
Modul Keuangan (mockup untuk persetujuan)"*, **Revisi 4**, disetujui owner
**10 Agustus 2026**. Buka berkasnya langsung di peramban.

Aslinya terbit sebagai **artifact claude.ai**, di luar git. Putaran K2
menunjukkan apa yang terjadi ketika sesuatu yang mengikat tidak punya rumah di
repo: acuan yang harus diikuti "apa adanya" tak bisa ditemukan oleh yang
mengerjakannya, dan tak bisa diperiksa oleh yang meninjaunya.

## Ini ACUAN, bukan kode

Berkas ini tidak di-build, tidak di-import, dan tidak ikut lint mana pun. Ia
memakai salinan token SolaGroup DS apa adanya supaya paletnya sama dengan
aplikasi, tetapi **kelasnya milik mockup**, bukan `app.css`.

Kalau ada yang tak bisa dibangun seperti di mockup: **katakan dan usulkan**.
Acuan yang diam-diam disimpangi berhenti jadi acuan.

## Kelima layar

| # | Layar | Status |
|---|---|---|
| 1 | Papan keuangan grup | belum dibangun |
| 2 | Laporan harian | belum dibangun |
| 3 | **Input keuangan** | blok 1 (harga beli) **live**; blok 2–4 menyusul |
| 4 | Gerbang tutup hari | belum dibangun (mesinnya ada — `keuangan-tutup-hari.ts`) |
| 5 | Sumber data | belum dibangun |

## ⚠️ Penyimpangan yang DIKETAHUI dari mockup

Daftar ini wajib bertambah setiap kali ada penyimpangan baru. Yang tidak
tercatat di sini dianggap tidak ada — dan penyimpangan tak tercatat adalah cara
sebuah acuan mati diam-diam.

### 1. Layar 3 · P1 bukan `reject` (K0-a, 12 Agu 2026)

Mockup menulis: *"Harga beli di atas harga jual **ditolak**"*.

**Tidak berlaku.** Yang berlaku adalah **peringatan wajib-diakui** (centang +
alasan tertulis, keduanya tersimpan) — [`KEUANGAN-HARIAN.md`](../../KEUANGAN-HARIAN.md)
§4.1. Diuji ke 2.048 hari sejarah Bakau: `reject` keras akan memblokir **436 sel
/ 336 hari (16,4%)** yang secara operasional sah pada masa transisi harga.

Teks mockup mendahului keputusan itu.

### 2. Layar 3 · angka pada mockup adalah data Bakau 15 Januari 2026

Bukan contoh karangan, dan bukan pula keadaan hari ini. Jangan dipakai sebagai
nilai harapan uji.

## Angka di mockup yang JANGAN dikutip ulang tanpa tanggalnya

Banner pembuka menyebut residu neraca Bakau (Rp 132.266 pada 15 Jan → Rp
3.635.936 pada 28 Jan → −Rp 39,45 miliar pada 27 Jul 2026). Semuanya **kumulatif
dan bertanggal**; §3.4 melarang membacanya sebagai baseline toleransi.
