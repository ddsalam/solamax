# Runbook — sapuan orphan `terra_resmi` di tujuh unit

**Dibuat:** 2026-09-01 · **Prasyarat:** commit "fix(terra_resmi) tutup celah UPSERT tak
pernah menghapus" sudah ter-deploy. **Pemilik keputusan:** Dion.

## Kenapa runbook ini ada

`terra_resmi` dulunya full-sync + UPSERT murni **tanpa jalur hapus**: sesi tera yang
dihapus permanen di POS menjadi baris **yatim abadi** di mirror. Tiga kejadian produksi
2026 — BL 13-08, 28 Oktober 29-08, IB 27-08 — masing-masing butuh DELETE manual ke
Postgres. Perbaikan kode menambahkan `replace_window` (hot-path 7 hari) dan
`sweepTerraResmi` (sejarah). Runbook ini memakai sapuan itu untuk **membersihkan
sisa orphan lama di tujuh unit**.

> 🔑 **Yang baru:** sebelum perbaikan, cakupan kerusakan **tak terukur dari mirror**
> (catatan BL 24-08). Sekarang terukur: jalankan sapuan, lalu hitung selisih baris.

## ⚠️ Urutan yang TIDAK boleh dibalik

1. **Backend dulu.** `replace_window` untuk `terra_resmi` divalidasi di backend
   (whitelist `REPLACE_WINDOW_DOMAINS`). Bila **agent** diperbarui lebih dulu, tiap
   payload `terra_resmi` ditolak **422** dan domain itu berhenti tersinkron.
2. **Baru agent**, satu mesin SPBU sekali jalan.

## Baseline (2026-09-01, sebelum sapuan)

| unit | kode | nama | baris | sesi | rentang |
|---:|---|---|---:|---:|---|
| 1 | 6478111 | Imam Bonjol | 1.952 | 406 | 2022-09-02 → 2026-09-01 |
| 2 | 6378301 | Bakau | 823 | 239 | 2020-02-02 → 2026-09-01 |
| 3 | 6478101 | Adisucipto | **0** | 0 | — (sah: unit ini tak punya sesi tera) |
| 4 | 6478106 | Bundaran Kotabaru | 3.130 | 747 | 2020-01-04 → 2026-08-31 |
| 5 | 6478201 | Batu Layang | 1.294 | 259 | 2020-03-12 → 2026-07-10 |
| 6 | 6478311 | Korek | 962 | 260 | 2021-09-19 → 2026-09-01 |
| 7 | 63781002 | 28 Oktober | 2.038 | 460 | 2020-01-13 → 2026-08-26 |

Total **10.199 baris**. Simpan angka ini — selisihnya nanti = jumlah orphan.

## 🔴 Risiko yang harus dinilai SEBELUM menyapu penuh

Sapuan menghapus baris mirror yang **tidak ada di sumber pada jendela itu**. Itu benar
untuk orphan. Tapi bila `tr_hterra` di suatu mesin pernah **dipangkas/diarsipkan**,
sejarah lama yang sah juga akan terhapus — dan dari mirror saja **kita tak bisa
membedakan keduanya**.

⇒ **Jangan langsung sapu penuh.** Ikuti tangga di bawah: pratinjau → satu unit sempit →
ukur → baru lebarkan.

## Langkah 0 — pratinjau, nol risiko

Di mesin SPBU, **tanpa** menghentikan agent yang berjalan:

```
cd C:\solamax-agent
node solamax-agent.cjs --deep-sweep terra_resmi 2500 30 --dry-run
```

`--dry-run` tidak mengirim apa pun. Tiap baris log `[dry-run] payload` mencetak
`replace_window` (rentang yang AKAN dihapus) dan `counts` (baris yang akan
dimasukkan kembali). Jendela ber-`counts` kosong = **kandidat penghapusan**.

> Pratinjau ini menyeluruh sejak 2026-09-01. Sebelumnya `--dry-run` berhenti di jendela
> pertama dan menyesatkan (tampak "cuma sedikit").

## Langkah 1 — perbarui agent, satu mesin (mulai dari Batu Layang)

BL dipilih lebih dulu: sejarahnya paling pendek (berhenti 2026-07-10), sudah pernah
diaudit penuh, dan satu orphan-nya sudah diketahui & dibersihkan — jadi paling mudah
dinilai apakah hasilnya masuk akal.

Ikuti **RUNBOOK-SPBU.md Bagian I** persis — agent tidak memuat ulang berkas sendiri:

```
copy /Y C:\solamax-agent\solamax-agent.cjs C:\solamax-agent\solamax-agent.PREV.cjs
```

lalu timpa **hanya** `solamax-agent.cjs`, kemudian **Task Scheduler → End**,
**Task Manager → Details → akhiri sisa `node.exe`**, lalu **Task Scheduler → Run**.
Verifikasi di `logs\agent-<tgl>.log` bahwa siklus baru jalan tanpa 422.

## Langkah 2 — sapuan sempit, ukur

```
node solamax-agent.cjs --deep-sweep terra_resmi 90 30
```

Lalu hitung ulang baris BL (SQL di bawah). Turun sedikit = orphan bersih. Turun
**banyak** = berhenti, jangan lanjut ke unit lain, periksa dulu apakah `tr_hterra`
di mesin itu dipangkas.

## Langkah 3 — lebarkan bertahap

Bila Langkah 2 masuk akal: `--deep-sweep terra_resmi 400 30`, ukur lagi, lalu
`2500 30` untuk sejarah penuh (data terlama 2020-01-04 ≈ 2.430 hari).

## Langkah 4 — ulangi per unit

Urutan disarankan: BL → Korek → Bakau → 28 Oktober → Kotabaru → IB.
**Adisucipto dilewati** (0 baris; `syncTerraResmi` keluar lebih awal saat sumber
kosong dan memang tak mengirim `replace_window`).

## Pengukuran (jalankan dari Mac, read-only)

```
cloud-sql-proxy solamax:asia-southeast2:solamax-pg --port 5432
```

```sql
SET app.unit_ids = '1,2,3,4,5,6,7';
SELECT u.unit_id, u.code, count(t.*) AS baris, count(DISTINCT t.ckdterra) AS sesi,
       min(t.business_date) AS tgl_awal, max(t.business_date) AS tgl_akhir
FROM public.unit u
LEFT JOIN public.terra_resmi t ON t.unit_id = u.unit_id
GROUP BY u.unit_id, u.code ORDER BY u.unit_id;
```

⚠️ `app.unit_ids` **wajib** di-set: RLS FORCE membuat query tanpa GUC memulangkan
**0 baris tanpa error** — nol baris ≠ data kosong.

## Setelah selesai

Sapuan manual ini **sekali saja**. Sesudahnya penghapusan tertangkap otomatis:
hot-path `replace_window` 7 hari (~2 menit) + sapuan terjadwal tier-1 (30 hari,
harian) dan tier-2 (sejarah penuh, off-peak).

Catat hasilnya (baris sebelum/sesudah per unit) ke
`wikis/spbu-sola/wiki/` — itu jawaban pertama yang pernah ada atas
"berapa banyak orphan `terra_resmi` sebenarnya".
