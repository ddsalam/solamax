# Usul guard divergensi `main` / `staging`

Tanggal pengukuran: 11 September 2026 WIB
Status: **usul siap ditinjau; belum dipasang ke workflow atau branch protection**

## Ringkasan keputusan yang diusulkan

Pasang pemeriksaan terjadwal dan pasca-push yang memerah bila `main` memuat
patch non-merge yang belum ada di `staging`. Promosi normal `staging` → `main`
harus diam. Hotfix langsung ke `main` hanya boleh diam sementara jika SHA
persisnya sudah didaftarkan dengan waktu mulai, waktu akhir, dan alasan yang
ditinjau owner. Skrip menolak jendela lebih dari 24 jam dan menolak waktu akhir
yang melewati 24 jam sejak patch benar-benar mendarat pada first-parent `main`.
Sesudah tenggat itu, guard memerah sampai patch dibawa kembali ke `staging`;
menggeser waktu mulai dan akhir tidak dapat memperbarui tenggat.

Artefak executable untuk menilai usul ini:

- `scripts/ci/check-main-staging-divergence.sh`
- `scripts/ci/check-main-staging-divergence.selftest.sh`

Tidak ada berkas di `.github/workflows/` yang diubah dan tidak ada kontrak branch
protection yang dipasang oleh pekerjaan ini.

## Ukuran historis lebih dulu

Metode pengukuran:

1. ambil seluruh PR merged dengan base `main`, lalu keluarkan promosi dengan head
   `staging`;
2. periksa commit head PR itu terhadap graph lengkap `origin/staging`;
3. batas awal episode adalah `mergedAt` PR ke `main`; batas akhir adalah
   `mergedAt` PR pertama ke `staging` yang membuat seluruh commit head tersebut
   menjadi leluhur `staging`;
4. periksa first-parent `main` untuk membedakan merge PR dari direct push.

Ada enam PR non-`staging` yang pernah di-merge ke `main`. PR #1, #2, dan #3
sudah menjadi leluhur pada awal riwayat `staging`; ketiganya bukan episode
divergensi. Setelah alur `staging` hidup, ada **tiga** episode:

| Masuk `main` | Kembali ke `staging` | Lama patch hanya di `main` | Bentuk pemulihan |
|---|---|---:|---|
| #45, 2026-07-01 17:17:58Z | #47, 17:46:04Z | 28 menit 6 detik | commit head yang sama di-merge ke `staging` |
| #90, 2026-07-15 19:26:44Z | #91, 2026-07-16 07:50:56Z | 12 jam 24 menit 12 detik | tiga commit head yang sama di-merge ke `staging` |
| #324, 2026-09-07 07:33:43Z | #334, 2026-09-10 17:14:59Z | 3 hari 9 jam 41 menit 16 detik | back-merge `main` → `staging` |

Jadi #324 bukan kejadian pertama, tetapi merupakan episode terlama: sekitar 6,6
kali episode #90 dan 174 kali episode #45. First-parent `main` hanya mempunyai
satu commit non-merge, yaitu initial commit; tiga episode di atas semuanya lewat
PR, bukan direct push tersembunyi.

Riwayat Git saat ini tidak menyimpan snapshot ref setiap detik. Karena itu durasi
di atas memakai timestamp merge GitHub sebagai batas yang dapat diaudit, bukan
mengklaim observasi kontinu di antara kedua peristiwa.

## Kontrak pemeriksaan

Pemeriksaan memakai:

```text
git log --right-only --cherry-pick --no-merges staging...main
```

Artinya yang dibandingkan adalah patch, bukan sekadar SHA. Ini penting karena
merge promosi membuat SHA merge baru di `main`, sementara isi non-merge-nya sudah
ada di `staging`.

### Kapan harus hijau dan diam

- `main` hanya lebih maju karena merge promosi `staging` → `main`;
- commit berbeda SHA tetapi patch yang sama sudah ada di `staging`;
- seluruh patch main-only mempunyai entri hotfix eksplisit dengan SHA penuh,
  awal/akhir UTC RFC3339, jendela paling lama 24 jam yang sedang aktif, dan
  alasan, serta waktu akhirnya tidak melewati 24 jam dari landing yang diaudit;
- sesudah back-merge, karena patch hotfix sudah menjadi leluhur `staging`, bahkan
  bila entri pengecualian telah kedaluwarsa.

Format usulan berkas pengecualian adalah empat kolom dipisahkan tab:
`SHA penuh`, `mulai UTC`, `akhir UTC`, dan `alasan`. Jendela hotfix maksimal
**24 jam**. Selain membatasi selisih awal/akhir, skrip mencari commit first-parent
`main` paling awal yang sudah memuat patch tersebut: commit itu sendiri untuk
direct first-parent commit, atau descendant first-parent paling awal pada
ancestry path untuk patch yang masuk lewat merge PR. Timestamp committer Git
commit landing itu menjadi awal tenggat 24 jam yang tidak dapat diperbarui.
Waktu mulai entri boleh lebih lambat, tetapi waktu akhirnya tetap tidak boleh
melewati tenggat landing tersebut.

Landing ini dapat diaudit dari graph Git tanpa API tambahan, tetapi bukan
`mergedAt` yang diverifikasi dari GitHub. Workflow yang kelak dipasang perlu
memastikan ref remote sudah di-fetch lengkap, lalu berjalan pada push ke
`main`/`staging` dan terjadwal setidaknya setiap jam, supaya expiry dapat berubah
merah tanpa menunggu push berikutnya. Ia bukan grace period otomatis: SHA dan
alasan tetap harus tampak di review.

Ref dan jam sintetis hanya tersedia bagi self-test melalui penanda eksplisit
`SOLAMAX_DIVERGENCE_GUARD_SELFTEST=1` dan variabel berawalan
`SOLAMAX_GUARD_TEST_`. Eksekusi normal selalu memakai `origin/staging`,
`origin/main`, jam sistem saat itu, dan perintah Git sebenarnya.

### Kapan harus merah

- ref `main` atau `staging` tidak tersedia/fetch tidak lengkap;
- format berkas pengecualian salah, SHA didaftarkan dua kali, atau jendelanya
  lebih dari 24 jam;
- waktu akhir pengecualian melewati landing first-parent `main` + 24 jam,
  termasuk bila awal/akhir entri digeser untuk mencoba memperbaruinya;
- ada patch main-only tanpa pengecualian;
- waktu mulai pengecualian belum tiba;
- pengecualian patch main-only telah kedaluwarsa.

Pesan gagal menyebut SHA, subject, alasan kegagalan, dan jalan keluar: back-merge
`main` ke `staging` sebagai pilihan utama, atau daratkan patch persisnya di
`staging`. Memperpanjang pengecualian bukan bukti pemulihan.

## Self-test dan bukti jalan keluar

Jalankan:

```bash
scripts/ci/check-main-staging-divergence.selftest.sh
```

Self-test membuat repo sementara dan membuktikan keadaan inti beserta batas
adversarialnya:

1. promosi normal hijau;
2. patch sama dengan SHA berbeda pada kedua cabang hijau dan benar-benar hilang
   dari hasil `--cherry-pick`;
3. patch PR hotfix ke `main` tanpa deklarasi merah, meskipun commit di dalam PR
   dibuat jauh sebelum merge;
4. kegagalan `git log` merah, bukan disalahartikan sebagai diff kosong;
5. waktu akhir tepat landing + 24 jam diterima saat masih aktif;
6. durasi 24 jam + 1 detik ditolak;
7. jendela 24 jam yang digeser melewati tenggat landing ditolak;
8. jendela sah yang kedaluwarsa merah;
9. back-merge mengembalikan keadaan hijau.

Keadaan terakhir sengaja membuktikan jalan keluar dari keadaan merah. Dengan
itu, failure guard dapat dibedakan dari gerbang yang tidak mempunyai jalan
keluar.

## Batas yang tidak dijaga

Guard ini tidak membuktikan:

- bahwa isi hotfix benar, sudah dites, atau memang layak disebut darurat;
- bahwa orang yang menambah pengecualian berwenang; review/branch protection
  tetap harus menegakkan kepemilikan keputusan;
- perubahan yang dibuat hanya di conflict resolution sebuah merge commit,
  karena merge commit sengaja dikeluarkan agar promosi normal tidak false-red;
- kesetaraan patch untuk semua bentuk squash: satu commit squash yang merangkum
  beberapa commit `staging` tidak harus dikenali setara oleh `--cherry-pick`;
- waktu landing Git ini sama persis dengan `mergedAt` GitHub; yang digunakan
  adalah committer timestamp dari commit first-parent yang pertama memuat patch;
- keadaan remote bila runner memakai ref dangkal atau basi; fetch lengkap dan
  freshness ref adalah tanggung jawab integrasi workflow yang belum dipasang;
- bahwa branch tidak pernah di-force-push setelah pemeriksaan.

Batas conflict-resolution-only adalah yang paling penting. Mitigasinya bukan
memperumit guard ini tanpa batas, melainkan menjaga pemeriksaan promosi yang
menguji hasil merge dan, bila Dion menginginkannya, menambah guard tree-diff
terpisah dengan aturan konflik yang eksplisit. Usul ini khusus menutup kelas
kejadian #45/#90/#324: patch non-merge masuk `main` tetapi belum ada di
`staging`.
