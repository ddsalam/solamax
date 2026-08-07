# Ketaatan Administratif — pra-registrasi prediksi (FASE 0, butir D)

Ditulis **SEBELUM** `EXPLAIN ANALYZE` dijalankan dan sebelum halaman diukur.
Kalau melesat, selisihnya dilaporkan apa adanya — bukan ceritanya yang disesuaikan.

## Beban query sekarang (dibaca dari kode, belum diukur)

`monitoring/ketaatan/page.tsx:30-36` — per unit 3 query paralel
(`getComplianceMatrix`, `getTankCount`, `getLastInputs`), 7 unit = **21 query**.
`getComplianceMatrix` sendiri = 3 sub-query berkorelasi × 14 baris `generate_series`.

## Prediksi (dikunci 2026-08-07, sebelum pengukuran)

| Besaran | Prediksi |
| --- | --- |
| P1 · EXPLAIN ANALYZE query A–I usulan, 1 unit × 14 hari | **150–400 ms** |
| P2 · indeks yang dipakai | index-scan pada `(unit_id, business_date)` untuk terra/pelanggan/voucher/edc; `sales_header (unit_id, dtgljual)` untuk A; `manual_entry_unit_id_business_date_section_idx` untuk F/G/I |
| P3 · perlu indeks BARU? | **tidak** — semua komponen sudah berkunci tanggal datar |
| P4 · render `/monitoring/ketaatan` SEKARANG, hangat | **0,8–1,5 dtk** |
| P5 · render `/monitoring/ketaatan` SEKARANG, dingin | **2,5–4,0 dtk** |
| P6 · render dengan indikator BARU, hangat | **1,2–2,0 dtk** (+1 query/unit, paralel dengan 3 yang sudah ada → tambahan ≈ query terlambat, bukan penjumlahan) |
| P7 · render dengan indikator BARU, dingin | **3,0–5,0 dtk** |
| P8 · delta hangat (baru − sekarang) | **+0,2 s … +0,6 s** |

## Alasan P6/P8

Query baru ditambahkan ke `Promise.all` yang sudah ada → wall-clock naik hanya
bila query baru lebih lambat dari `getComplianceMatrix` (query terlambat saat ini).
Karena A memindai `sales_detail` (tabel terbesar, 159k+ baris/unit) sementara
`getComplianceMatrix` hanya `count()` pada `sales_header`, saya menduga query baru
**akan** jadi jalur kritis yang baru — karena itu P8 positif, bukan nol.

## Risiko yang saya duga akan mengejutkan saya

- Komponen A (`sales_detail JOIN sales_header`) 14 hari bisa jauh lebih mahal dari
  dugaan bila join-nya tidak ber-index pada `ckdjualbbm`.
- Pool: 7 unit × 4 query = 28 koneksi diminta terhadap `max: 10` → antre.
  Ini persisnya mekanisme PR #31 / PR #160. Perlu diperiksa, bukan diasumsikan aman.

---

## HASIL — diisi setelah pengukuran (2026-08-07)

| | Prediksi | Terukur | Verdict |
| --- | --- | --- | --- |
| P1 query A–I, 1 unit × 14 hr | 150–400 ms | **7,8–20 ms hangat** (7–114 ms dingin) | ❌ **meleset 10–20×, terlalu pesimis** |
| P2 indeks | index scan semua sumber | benar, KECUALI `manual_entry` → Seq Scan (428 baris; planner benar) | ⚠️ hampir |
| P3 indeks baru | tidak perlu | tidak perlu | ✅ |
| P8 delta fan-out 7 unit, hangat | +200…+600 ms | **+188 ms** (1.576 → 1.764 ms) | ⚠️ **tepat di bawah pita** |
| P4–P7 render halaman | 0,8–5,0 dtk | **BELUM DIUKUR** — rute di balik OAuth, butuh deploy staging | ⏳ |

### Premis yang salah, bukan cuma angkanya

Saya menduga query A–I akan jadi jalur kritis baru karena memindai `sales_detail`.
Yang benar: **`getComplianceMatrix` lama sendiri 166–325 ms/unit hangat** — 15–40×
lebih mahal dari query baru — karena tiga sub-query BERKORELASI dijalankan 14×
per unit, didominasi pemindaian `opname`. Query baru bersembunyi di baliknya.

### Caveat pengukuran

Semua angka dari **Mac lewat cloud-sql-proxy ke asia-southeast2** → mengandung RTT
internet yang TIDAK dialami Cloud Run se-region. Pembanding lama (1.576 ms) diukur
dengan harness `pg` mentah, yang baru (1.764 ms) lewat kode produksi di vitest —
tidak sepenuhnya setara. Angka yang mengikat = pengukuran pasca-deploy staging.

### Bug yang tertangkap HANYA oleh tes DB-live

`count(*)::int FILTER (WHERE …)` adalah sintaks Postgres yang TIDAK VALID (cast
harus membungkus: `(count(*) FILTER (…))::int`). `pnpm check` **hijau penuh**
dengan bug ini di dalamnya, karena tak satu pun unit test menyentuh DB. Halaman
Ketaatan akan 500 di staging. Ditemukan `ketaatan-live.integration.test.ts`.

---

## KOREKSI & BASELINE — dari rekaman produksi owner (2026-08-07, pra-promosi)

### 1. Koreksi klaim yang lebih kuat dari buktinya

Saya menulis "Board dan halaman Ketaatan **hari ini sudah** menceritakan dua cerita
berbeda". **Itu overclaim.** Owner memuat `/monitoring/ketaatan` produksi tiga kali
berturut-turut; ketiganya menghasilkan `2017-08-24` — minimum yang benar, identik
dengan hitungan `anomalies.ts`. Divergensinya **mungkin secara konstruksi, TIDAK
teramati pada n=3**.

Yang salah **tanpa syarat** dan tetap berdiri: tanggal itu milik **Bundaran
Kotabaru**, tapi strip melabelinya **"SEMUA UNIT"**. Label salah adalah fakta;
non-determinisme adalah risiko yang belum terwujud.

### 2. BASELINE PRA-PERUBAHAN — indikator lama tidak pernah bersinyal

Rekaman owner: heatmap produksi **7 unit × 14 hari = 98 sel, SEMUANYA HIJAU**.
Nol kuning, nol merah. Itu pembenaran terkuat untuk perubahan ini dan **tidak ada
di laporan Fase 0 saya** — kelewatan saya.

Reproduksi saya (2026-08-07 13:46 WIB, kode produksi, DB pilot) memberi **91 hijau
+ 7 merah**, bukan 98 hijau. Selisihnya BUKAN kontradiksi: ketujuh merah itu tepat
kolom **hari berjalan 2026-08-07**, yang pada pukul 13:46 masih `0 shift / 0 opname`
di ketujuh unit (EasyMax menulis `sales_header` saat shift TUTUP). Rekaman owner
hampir pasti diambil ketika "hari ini" masih 2026-08-06 — hari yang sudah punya
3 shift penuh. Untuk **91 sel yang sudah settle, klaim owner terkonfirmasi bulat:
91/91 hijau = nol sinyal dalam 13 hari.**

### 3. Sel yang berubah warna di bawah aturan BARU — jawabannya BUKAN nol

Atas 91 sel settle yang sama:

| | LAMA | BARU |
| --- | ---: | ---: |
| hijau | **91** | 38 |
| kuning | 0 | 6 |
| merah | 0 | **47** |

**53 dari 91 sel (58%) berubah warna.** Rincian: 46 `belum_diisi`, 6 `lebih_setor`
(termasuk Bakau 2026-08-06 **+3.362.265** yang belum pernah terlihat), 1
`kurang_setor` (IB 2026-08-03 **−476.993**). Indikator baru bersinyal; ia tidak
mengganti buta dengan buta.

### 4. ⚠️ TAPI — 83% merahnya adalah PRA-ADOPSI, bukan kelalaian

Tanggal pemakaian pertama `app.manual_entry` per unit:

| Unit | Entri pertama | Sel merah | Pra-adopsi? |
| --- | --- | ---: | --- |
| Imam Bonjol | 2026-06-21 | 1 | tidak (kurang setor nyata) |
| Bakau | 2026-07-08 | 0 | — |
| Adisucipto | 2026-07-16 | 7 | **tidak** — celah asli pasca-adopsi |
| Bundaran Kotabaru | 2026-08-02 | 8 | **ya, semua** |
| Batu Layang | 2026-08-03 | 9 | **ya, semua** |
| Korek | 2026-08-06 | 12 | **ya, semua** |
| 28 Oktober | 2026-08-04 | 10 | **ya, semua** |

**39 dari 47 sel merah (83%) mendahului entri manual PERTAMA unit itu.** Bukan
pengawas lalai — fiturnya memang belum dipakai di sana. Tanpa penanganan, papan
pilot menyala merah pada hari promosi karena alasan yang bukan pelanggaran; itu
penyakit "melatih orang mengabaikan alarm" yang SAMA, cuma bentuk baru.

Usulan (BELUM dikerjakan, menunggu keputusan owner): **lantai adopsi** — jangan
nilai hari sebelum `min(business_date)` unit ybs. Efeknya pada data sekarang:
47 → **8 sel merah** (7 Adisucipto + 1 IB), semuanya celah asli.

### 5. Badge sidebar — premis kami berdua meleset

Badge sudah menunjukkan **"9+"** sekarang. Menambah 0–1 item merah **tidak akan
terlihat**. Peringatan saya di PR #202 benar secara mekanis tapi tak berarti secara
praktis: anomali administrasi baru TIDAK akan tampak di badge. Badge yang mentok
9+ adalah isu tersendiri — diusulkan, tidak dikerjakan.
