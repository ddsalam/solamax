# Gerbang saya menjatuhkan deploy pilot — dua pelajaran, bukan satu tambalan

Tanggal: 2026-09-15 · Worker: Claude Opus 5 · Branch `codex/psql-url-helper`

```
psql: connection to server at "localhost" port 5432 failed: Connection refused
```

Langkah "Cakupan unit" membangun URL psql dengan `${DATABASE_URL%%\?*}` —
membuang **seluruh** query string, termasuk `host=/cloudsql/<instance>`. Cloud
SQL Auth Proxy memakai unix socket, jadi psql jatuh ke TCP localhost dan gagal.
Gerbang yang saya bangun untuk mencegah kegagalan senyap **menjatuhkan deploy
produksi**. Perbaikannya sudah mendarat lewat #364 → #365; yang di bawah ini
adalah kelasnya.

## 1 · Jawabannya sudah ada di repo, di berkas yang saya sunting hari itu juga

`strip_schema_param` di `check-snapshot-quiescent.sh` sudah benar, **lengkap
dengan komentarnya**: *"psql menolak parameter `schema` milik Prisma, tetapi
MEMBUTUHKAN `host` pada mode unix-socket Cloud SQL."* Saya menulisnya sendiri
pada sesi yang sama — lalu menulis logika baru di dalam YAML alih-alih
memakainya.

Ini instans lain dari pelajaran arc ini: **cari di arsip sebelum menulis ulang.**
Bedanya, kali ini arsipnya adalah tulisan saya sendiri, berumur beberapa jam.

**Perbaikan kelas**: logikanya dipusatkan di `scripts/ci/psql-url.sh` — dapat
di-source maupun dipakai sebagai perintah — dan **kedua** pemakainya menariknya
dari sana. Tidak ada lagi versi kedua yang bisa menyimpang.

`psql-url.selftest.sh` menguji enam bentuk URL, termasuk **bentuk persis yang
menjatuhkan pilot** (`?host=/cloudsql/…&schema=public`) dan satu kontrol yang
mudah terlewat: `options=-c%20search_path%3D…` **bukan** parameter `schema` dan
tidak boleh ikut dibuang. Self-test dapat diarahkan ke varian lewat
`PSQL_URL_SH`, dan dijalankan terhadap varian rusak ia **MERAH** dengan keluaran
yang persis: `…/solamax` tanpa `?host=`.

## 2 · Gerbang yang hanya berjalan di pilot belum teruji di tier sebenarnya

`coverage-check: "true"` hanya disetel pada tier pilot. Tier testing tidak
menyetelnya ⇒ langkah itu **tidak pernah berjalan** di staging ⇒ **kegagalan
pertamanya jatuh di produksi**. Gerbang yang dibangun untuk menangkap "belum
teruji di tier sebenarnya" ternyata sendiri belum teruji di tier sebenarnya.

**Perbaikan kelas**, bukan instans: input `coverage` kini bermode
`off | report | enforce`.

| Tier | Mode | Yang dituntut |
|---|---|---|
| testing (`-rlsstg`) | **report** | sambungan **dan** kueri WAJIB berhasil; vonis cakupan hanya diperingatkan |
| pilot (live) | **enforce** | semuanya menjatuhkan |

Pemisahannya mengikuti **apa yang sebenarnya gagal**: yang pecah di produksi
adalah **plumbing** (URL → sambungan → kueri), bukan logika keputusan — logika
itu sudah punya self-test tujuh keadaan. Jadi plumbing dituntut di kedua tier,
dan hanya vonisnya yang tier-spesifik. Daftar unit di tier testing sintetis, dan
menuntut vonisnya di sana akan melahirkan alarm yang selalu menyala — kelas yang
sudah ditolak dua kali dalam arc ini.

### Sentinel: "tidak ada keluaran" bukan sinyal

DB testing yang kosong memulangkan daftar unit kosong, yang **tidak dapat
dibedakan** dari sambungan yang gagal. `scripts/ci/unit-bercut.sql` karena itu
memulangkan `KUERI_JALAN|<daftar>`; langkahnya menolak apa pun yang sentinelnya
tidak muncul, dengan pesan yang menyebut bahwa itu kegagalan **sambungan**,
bukan "tidak ada unit".

Diverifikasi di PostgreSQL 16 lokal, dua arah:

```
DB berisi  : KUERI_JALAN|1,2,4
DB kosong  : KUERI_JALAN|          <- kueri terbukti jalan, daftarnya memang kosong
URL buruk  : keluar=2              <- preflight MERAH, bukan diam
```

## 3 · Ralat konteks yang saya bawa

Saya menulis "#362 tetap tidak saya merge". Ia **sudah** di-merge (19:54) dan
dipromosikan lewat #363 (20:01); dashboard produksi sudah membawa banner F1.
Saya melaporkan keadaan yang sudah basi tanpa memeriksanya ulang — kesalahan
yang sama bentuknya dengan memakai angka `2.134 MB` yang sudah tidak berlaku.

Keadaan sekarang: **ketujuh unit mengirim cut**, ketujuhnya punya job build
berjeda 15 menit 02:05–03:35, kapasitas 5.101 MB dan gerbang terbuka —
penukaran empat bundle hanya menambah 273 MB.

## 4 · Besok pagi

Verifikasi **tujuh** build, bukan tiga. `scripts/piutang-verifikasi/01-build-malam.sql`
sudah memvonis sendiri, tetapi daftar unitnya dipatok `(1,2,4)` di klausa G1 —
itu harus dilebarkan ke ketujuh unit sebelum dijalankan besok. Dicatat di sini
supaya tidak terlewat; belum diubah karena angka unitnya baru sah sesudah build
pertama ketujuhnya berjalan.
