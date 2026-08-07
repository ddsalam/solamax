# Usulan: tutup lingkaran alarm Laporan + jadikan G4 otomatis

**Status: USULAN. Tidak ada yang diimplementasikan. Menunggu pilihan owner.**

---

## U1 · Sambungkan dua alarm Laporan Operasional ke `adminStatus`

### Kenapa sekarang, dan bukan sebelumnya

Dua alarm di [`laporan-model.ts:344-355`](../apps/dashboard/src/lib/laporan-model.ts)
berbunyi **N/A sejak investigasi pertama sesi ini**:

```
na("Setoran Bank Sesuai",        "belum terhubung — lihat Ketaatan Administrasi")
na("Pengeluaran Sudah Disahkan", "belum terhubung — lihat Ketaatan Administrasi")
```

String alasannya sendiri sudah kami perbarui di #202 karena yang lama
(`"Domain setoran"` / `"modul kas dorman"`) menjadi **faktual salah** begitu
indikator kas diganti. Jadi kedua baris ini sudah dua kali menarik perhatian
tanpa pernah dijawab.

**Yang berubah hari ini:** sekarang ada **tepat satu pembuat vonis** yang bisa
menjawab keduanya. Sebelum #224 ada dua, dan menyambungkan alarm ke salah satunya
akan menciptakan pembuat vonis ketiga.

Dan lingkarannya memang berawal dari sini: kita mengganti indikator kas pagi tadi
justru karena "Pengeluaran Sudah Disahkan" tak punya sumber yang hidup.

### Bentuk yang diusulkan

`laporan-model.ts` menerima **`verdict: AdminVerdict`** (bukan menghitung apa
pun sendiri), lalu memetakannya:

| `verdict.kode` | "Setoran Bank Sesuai" | "Pengeluaran Sudah Disahkan" |
| --- | --- | --- |
| `selaras` | **ok** — "setoran selaras (±Rp 1.000)" | **ok** — "pengeluaran tercatat & disahkan" |
| `lebih_setor` | **warn** — sebut selisihnya | ok |
| `kurang_setor` | **fail** — sebut selisihnya | ok |
| `setoran_kosong` | **fail** — "setoran belum diisi" | ok |
| `belum_diisi` | **fail** | **fail** — "pengeluaran belum diisi" |
| `tak_terhitung` | **na** — "penjualan belum lengkap" | ok bila ada baris |
| `pra_adopsi` / `belum_adopsi` / `config_hilang` | **na** dengan alasan spesifik | idem |
| `belum_tempo_*` | **na** — "belum jatuh tempo" | idem |

Halaman Laporan sudah memuat `getManualEntries` untuk blok RECAP, jadi tambahan
query-nya hanya **`getShiftInfo`** — dan halaman Rincian sudah membuktikan pola
itu murah.

### Yang membuat usulan ini KECIL, dan itu disengaja

- **Nol aturan baru.** Semua keputusan tetap `adminStatus`. Yang ditambah hanya
  PEMETAAN verdict → label alarm.
- **Nol pembuat vonis baru.** Kalau nanti aturannya berubah, ketiga permukaan
  berubah bersama.
- **Ikuti pola yang sudah terbukti:** parameter verdict dibuat **WAJIB**, jadi
  memanggil `buildLaporanModel` tanpa menyediakannya = error type-check.

### Risiko yang saya lihat, disebutkan lebih dulu

1. **Blok alarm Laporan jadi ikut merah** pada hari yang setorannya tak selaras.
   Itu memang maksudnya — tapi ia mengubah `alarmScore`, yang menggerakkan warna
   ringkasan halaman. **Ukur dulu** berapa hari dari 91 sel settle yang akan
   mengubah skor alarm, sebelum memutuskan. Persis pelajaran lantai adopsi.
2. **"Pengeluaran Sudah Disahkan" tidak benar-benar diuji `adminStatus`.**
   `adminStatus` menilai KELENGKAPAN pengisian, bukan "pengesahan". Memetakannya
   ke ok/fail berarti **mengubah arti label itu**. Kalau owner ingin arti aslinya
   (ada persetujuan/approval), sumbernya belum ada dan alarmnya harus **tetap
   N/A** — dengan alasan yang jujur, bukan disambungkan ke proksi.
   **Saya condong ke: sambungkan "Setoran Bank Sesuai" SAJA**, dan biarkan
   "Pengeluaran Sudah Disahkan" N/A sampai ada sumber pengesahan yang nyata.
   Menyambungkan label ke sesuatu yang bukan artinya adalah cara halus untuk
   berbohong di papan.

---

## U2 · Jadikan G4 otomatis — aturan yang menuntut orang mengingat belum selesai

### Pengamatan owner yang tepat

G4 menangkap #223 **karena owner menahan PR-nya**, bukan karena aturannya
berjalan sendiri. Sebuah aturan yang menuntut seseorang ingat menerapkannya
**belum selesai jadi aturan** — itu kelas yang sama dengan `enforce_admins:false`
(gerbang yang bisa dilewati) dan `expect(CASES.length).toBe(34)` (guard yang
menegaskan dirinya sendiri).

### Tiga bentuk, dari paling murah

**(a) Template PR — checklist.** `.github/pull_request_template.md` dengan satu
kotak: *"Kalau PR ini menambahkan TEMUAN ke `session-notes/`, apakah temuannya
sudah bertahan satu siklus sejak pertama diasersikan?"*
· Biaya ~nol · **Kelemahan: masih menuntut orang membacanya.** Ia memindahkan
pengingat lebih dekat, tapi tidak menegakkan apa pun.

**(b) Label + cek CI.** Job kecil: kalau diff PR menyentuh `session-notes/**`
DAN PR tak berlabel `arsip-siklus-kedua`, cek GAGAL dengan pesan yang menyebut
G4. Owner memasang label saat temuannya sudah bertahan satu putaran.
· **Menegakkan**, jejaknya di riwayat PR · Biaya: satu workflow + disiplin label
· **Kelemahan jujur:** label bisa dipasang refleks. Ia mengubah "ingat aturannya"
jadi "putuskan sadar", yang lebih baik tapi bukan pembuktian.

**(c) Cek berbasis waktu.** Sama seperti (b), tapi mengukur umur commit yang
menyentuh berkas catatan: gagal bila temuan ditambahkan **dan** di-merge dalam
jendela yang sama (mis. < 4 jam).
· Paling dekat dengan maksud G4 · **Kelemahan: rapuh** — "satu siklus" adalah
konsep percakapan, bukan konsep jam. Sesi hari ini berputar 12+ kali dalam
sehari; ambang jam apa pun akan salah di salah satu arah.

### Rekomendasi: **(b)**, dan alasan menolak yang lain

**(c) ditolak** karena memaksakan definisi waktu pada konsep yang bukan waktu —
persis kesalahan "aritmetika TTL" yang saya buat pagi ini: mengukur yang mudah
diukur alih-alih yang dimaksud.

**(a) tidak cukup sendirian** — ia satu-satunya yang tak menegakkan apa pun, dan
seluruh keluhan tentang G4 adalah bahwa ia belum menegakkan.

**(b) diterima dengan batasnya disebut**: ia tidak membuktikan temuannya sudah
diuji, hanya memaksa seseorang **menyatakan** demikian secara eksplisit dan
meninggalkan jejak. Itu peningkatan nyata dari "berharap ada yang ingat", dan
saya tidak akan mengklaimnya lebih dari itu.

⚠️ **Prasyarat yang TIDAK boleh dilewati** (pelajaran G1 yang baru dibayar):
setelah cek itu dipasang, **tonton ia GAGAL sekali** pada PR catatan tanpa label,
lalu **hijau** setelah label dipasang. Gerbang yang belum pernah dilihat menolak
bukan gerbang.

---

**Tidak ada yang dikerjakan. Menunggu pilihan owner.**
