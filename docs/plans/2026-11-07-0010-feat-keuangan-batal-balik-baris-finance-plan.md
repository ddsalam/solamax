---
title: Batalkan dan Balik baris pintu Finance (Input keuangan blok 4) - Plan
type: feat
date: 2026-11-07
topic: keuangan-batal-balik-baris-finance
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Batalkan dan Balik baris pintu Finance (Input keuangan blok 4) - Plan

## Goal Capsule

- **Objective:** Finance bisa mengeluarkan baris pintu Finance yang salah dari setiap laporan, tanpa menyunting sejarah, dan siapa serta mengapa tetap terbaca di barisnya. Kasus pemicu: tiga baris ganda Bakau 2 Okt 2026 (+12.440) yang menggelembungkan Cash flow check dan laba bersih.
- **Means:** Dua tindakan di blok 4. **Batalkan** (void beralasan) untuk baris pintu Finance di hari terbuka. **Balik** (pengajuan Finance, persetujuan HoF/Direksi, satu `correction_entry` reversal) untuk baris pintu Finance di hari tertutup. Satu aturan SQL "baris berlaku" dipakai setiap pembaca laporan (KTD1).
- **Product authority:** Dion. `apps/dashboard/KEUANGAN-HARIAN.md` tetap mengikat. Rencana ini menambah satu pengecualian tercatat atas §10.33 (KTD6).
- **Execution profile:** Deep · dua migrasi baru (0059, 0060) · menyentuh laba, kas, buku besar, wewenang.
- **Stop conditions:** Berhenti dan tanya Dion bila (a) sebuah migrasi lama harus disunting, (b) trigger `manual_entry_immutable_after_close`/`manual_entry_backdate_gate` harus diubah, (c) sebuah pembaca uang tak bisa memakai aturan bersama, (d) merge ke `main` atau gerbang `pilot` diperlukan.
- **Who finishes:** `ce-work` di worktree `feat/batal-balik-baris-finance` (dari `origin/staging`). Dua PR ke `staging` (Rilis 1 Batalkan, Rilis 2 Balik). Dion me-merge, membuka PR `staging → main`, dan menyetujui gerbang `pilot`.
- **Open blockers:** Tidak ada.

---

## Product Contract

### Summary

Blok 4 Input keuangan mendapat dua tindakan untuk baris **pintu Finance**. **Batalkan** tersedia selama hari belum ditutup: kode alasan dan alasan tertulis wajib, baris di-void, dan baris itu hilang dari semua keluaran. **Balik** tersedia sesudah hari ditutup: Finance mengajukan, HoF/Direksi/super admin (bukan pengaju) menyetujui, lalu sebuah `correction_entry` reversal tertaut membuat baris itu tidak berlaku di hari aslinya. Baris pengawas dan baris yang bertaut ke mutasi kas tidak bisa dibatalkan dari sini.

### Problem Frame

Bakau (unit 2), 2 Okt 2026: tiga baris pintu Finance adalah duplikat tanpa mutasi kas, yaitu "Biaya MDR EDC" −7.560 (ganda dengan MDR otomatis settlement BCA), "Biaya Admin Bank" −30.000, dan "NK - LAINNYA" +50.000 berkode **6-9900** (ganda dengan baris 4200 yang bertaut BCA dan dipertahankan). Neto +12.440 itu menggelembungkan Cash flow check Layar 2 dan laba bersih. Finance hanya bisa menambalnya dengan reklasifikasi ke 1-1800 (data pilot sesudah 6 Nov sudah memuat tambalan itu, `wikis/spbu-sola/wiki/sources/2026-11-06-selisih-pemeriksa-tutup-hari-bakau-2-dan-4-okt.md` di vault; karena itu fixture memakai keadaan SEBELUM tambalan). Halaman sudah menjanjikan "Koreksi / balik" (`LABEL_TINDAKAN.correct`), tetapi tak ada jalannya.

Kondisi kode `origin/staging` 4285521:

- `manual_entry.void/voided_at/voided_by_user_id` ada sejak 0007, tetapi tak ada kolom alasan. Satu-satunya void Finance terjadi tidak langsung, lewat pembatalan mutasi kas (`kas-actions.ts` `voidMutasiKas`, `cocok-bank-actions.ts` `batalkanCocok`).
- `correction_entry` (0021) dan `backdate_override` (0027) hanya tabel: tak ada jalur tulis, tak ada layar persetujuan, tak ada pembaca laporan.
- `manual_entry_nominal_positif` (0042) melarang nominal negatif, jadi pembalik tidak bisa berupa baris `manual_entry` negatif.
- `pilahManualEntry` tidak menyaring void di cabang `keluar`/`manualBeban`. Beban laporan benar hanya karena `kumpulkanBeban` menyaring lagi.
- Pembacaan buku besar (`buku-besar-sumber.ts`) dan laporan menyaring `NOT m.void` di masing-masing kuerinya sendiri. Tidak ada satu fragmen bersama.

### Key Decisions

- **Balik berlaku di hari asli baris, bukan dibukukan maju.** Laporan hari tertutup itu berubah sesudah persetujuan, dan ditolak bila bulannya sudah ditutup dengan buku besar. Governs R9, R12. (session-settled: user-directed — chosen over dibukukan maju per §10.33 dengan `ADJ-FWD-REVERSAL`: Dion memilihnya dua kali, terakhir sesudah konflik dengan §10.33 ditunjukkan.)
- **Wewenang Batalkan dan mengajukan Balik = anggota reklasifikasi** (staf `keuangan`, super admin, Head of Finance), dengan predikat sendiri. Governs R4, R10. (session-settled: user-directed — chosen over `canInputKeuangan`, yang menolak HoF.)
- **Rilis bertahap:** Rilis 1 Batalkan, Rilis 2 Balik. (session-settled: user-approved — chosen over satu rilis gabungan.)
- **Alasan Batalkan memakai daftar kode baru grup `void`**, bukan meminjam kode `adjustment`. (session-settled: user-approved.)

### Requirements

**Batalkan (hari terbuka)**

- R1. Batalkan hanya untuk baris `source_door='finance'`, belum void, `cash_ledger_id IS NULL`, di hari yang `day_close`-nya tidak `closed`, dan bulan yang belum punya baris `tutup_bulan` (K5 maupun buku besar).
- R2. Kode alasan grup `void` dan alasan tertulis (≥ 5 karakter) wajib. Keduanya tersimpan di baris bersama `voided_at`/`voided_by_user_id`.
- R3. Server menolak baris pengawas, baris bertaut kas, baris di hari tertutup, dan baris yang sudah void, meski tombolnya disembunyikan. Pesan menyebut jalur yang benar (Kembalikan untuk perbaikan / batalkan mutasi kas asal / Ajukan balik). Di Rilis 1, sebelum Balik ada, pesan hari tertutup berbunyi "hari sudah ditutup — pembalikan menyusul" dan tak ada tombol yang menjanjikan Balik.
- R4. Pelaku: staf Keuangan, Head of Finance, super admin. Yang lain melihat siapa pelakunya, bukan nama tindakan lepas.

**Satu aturan "baris berlaku"**

- R5. Baris void atau dibalik bernilai nol di Income Statement, Cash Flow (`panelCashFlow`), langkah neraca (`langkahHarianRinci`), Papan keuangan, buku besar, panel "Perlu ditautkan", titipan, dan ekspor PDF/CSV.
- R6. Aturan itu ditulis sekali (satu fragmen SQL + satu saringan TS) dan dijaga uji yang memerah bila pembaca uang baru menulis `NOT void` sendiri.
- R7. Void sesudah reklasifikasi tidak dihitung dua kali. Riwayat reklasifikasi tetap tampil.

**Balik (hari tertutup)**

- R8. Ajukan balik hanya untuk baris pintu Finance, tidak void, belum dibalik, `cash_ledger_id IS NULL`, di hari `closed`. Kode alasan grup `adjustment` (ADJ-DUP, ADJ-AMOUNT, ADJ-DATE, ADJ-PARTY) dan alasan tertulis wajib. Paling banyak satu pengajuan menunggu per baris.
- R9. Persetujuan menulis satu `correction_entry`: `original_txn_id`, `reason_code` (kode pengajuan), `value_before` = nominal, `value_after` = 0, `submitted_by` = pengaju, `approved_by` = penyetuju, `approved_at`, `evidence_ref` = `correction_request:<id>`, `kind='reversal'`. Alasan tertulis tinggal di `correction_request`. Baris asli tidak di-UPDATE. Paling banyak satu reversal per baris (DB).
- R10. Penyetuju memenuhi `canCloseException` (Direksi, super admin, HoF) dan bukan pengaju. Server menegakkan keduanya. DB menegakkan pemisahan tugas (CHECK pada `correction_request` dan `correction_entry_segregation` 0021). Keanggotaan hanya di server, sebab HoF hidup di ENV (§10.4, catatan 0027). Penolakan wajib bercatatan. Pengaju boleh menarik pengajuannya selama menunggu.
- R11. Baris menampilkan status pengajuan/persetujuan: siapa, kapan, kode, alasan.
- R12. Balik ditolak bila bulan baris sudah punya baris `tutup_bulan` (K5 maupun buku besar).
- R12b. `day_close` hari itu tidak disentuh (§10.15): selisih saat ditutup tetap beku, dan dampak balik tampil terpisah sebagai "dibalik sesudah ditutup" di Layar 4, Papan, dan PDF tutup hari, mengikuti preseden `koreksi_susulan_rp` (§10.34).

**Jejak**

- R13. Batalkan, pengajuan balik, dan balik yang disetujui muncul di Pemantauan pemakaian.
- R14. Keputusan dan pengecualian §10.33 dicatat di `KEUANGAN-HARIAN.md`.

### Acceptance Examples

- AE1. Fixture "Bakau 2 Okt" sebelum reklasifikasi 1-1800: Cash flow check 11.676,5 dan laba bersih 11.073.820. Sesudah tiga baris di-void: −763,5 dan 11.061.380 (keduanya −12.440). Covers R5.
- AE2. Baris yang sudah direklasifikasi ke 1-1800 lalu di-void menghasilkan angka yang sama dengan baris yang hanya di-void. Covers R7.
- AE3. Baris pengawas, baris di hari tertutup, dan baris bertaut kas → server menolak Batalkan, DB tidak berubah. Covers R3.
- AE4. Pengaju menyetujui pengajuannya sendiri → ditolak server, dan INSERT langsung yang melanggar ditolak CHECK DB. Covers R10.
- AE5. Baris hari tertutup yang dibalik bernilai nol di laporan hari itu, jurnalnya terbentuk ulang, dan `day_close` hari itu tak berubah. Covers R5, R9, R12b.

### Scope Boundaries

- Tidak ada Edit, tidak ada pembatalan baris pengawas, tidak ada perubahan nominal (koreksi `corrected_entry`).
- Trigger 0024/0026/0027 dan migrasi lama tidak disentuh.
- Baris bertaut kas di hari tertutup tetap tanpa jalan (celah lama §10.33, butuh jalur pembatalan kas di hari tertutup).

### Deferred to Follow-Up Work

- Balik untuk baris pengawas di hari tertutup (§2.3 Adjust/Reverse atas Rincian Penjualan).
- `corrected_entry` (balik + nilai baru dalam satu persetujuan).
- Kotak masuk persetujuan lintas unit. Rilis ini memakai Pemantauan + baris di blok 4.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Satu fragmen "baris berlaku".** `keuangan-berlaku.ts` mengekspor `SQL_ME_TAK_BERLAKU(alias)` = `alias.void OR EXISTS (reversal correction_entry untuk alias.id dan alias.unit_id)` dan `barisBerlaku()` untuk TS. Pembaca uang memilih `${SQL_ME_TAK_BERLAKU("m")} AS void` (kolom `void` berarti "tidak berlaku"), atau menyaring `NOT ${…}`. Pembaca khusus pengawas (Rincian, kepatuhan, setoran) tetap `NOT void`, karena Balik hanya untuk pintu Finance; mereka masuk daftar izin uji penjaga. (session-settled: user-directed — chosen over saringan per kueri.)
- KTD2. **`pilahManualEntry` menyaring sekali di puncak.** Semua cabang bekerja dari `aktif`. `kumpulkanBeban` tetap menyaring (pertahanan lapis kedua, tak diubah).
- KTD3. **Void ditulis di `batal-balik-tulis.ts`** (fungsi ber-`PoolClient` + aktor, pola `antar-unit-tulis.ts`). Server action tipis di `batal-balik-actions.ts`. Penjaga ada di dalam transaksi: `FOR UPDATE` atas baris, `kunciHariBersama` atas (unit, hari) supaya `tutupHari` tak menyelip, kunci bulan bersama (`bulanTertutupTerkunci` bila ada, pola tutup bulan) lalu periksa `day_close`, adanya baris `tutup_bulan`, pintu, tautan kas. Trigger 0026 tetap jaring terakhir.
- KTD4. **Migrasi 0059** (Rilis 1): grup `void` di CHECK `reason_code_applies_to` + empat kode `VOID-*`. Kolom `void_reason_code`, `void_reason_applies_to`, `void_alasan` di `manual_entry` dengan FK komposit ke `reason_code(code, applies_to)` dan CHECK pasangan/isi. Kewajiban "alasan wajib" untuk void Finance ditegakkan di jalur tulis, karena void lain (pengawas, kaskade kas) sah tanpa alasan.
- KTD5. **Migrasi 0060** (Rilis 2): tabel `app.correction_request` (pengajuan → disetujui/ditolak/ditarik). Isinya: CHECK pasangan `decided_by`/`decided_at` terisi tepat bila status ≠ menunggu, CHECK `decided_by <> requested_by` untuk disetujui, catatan wajib untuk ditolak, satu pengajuan menunggu per baris, RLS predikat 0016, GRANT tanpa DELETE, dan trigger BEFORE UPDATE yang menolak perubahan baris ber-status ≠ menunggu atau perubahan `requested_by`. Setiap transisi = satu transaksi: `FOR UPDATE` pengajuan + baris, `UPDATE … WHERE status='menunggu' RETURNING`, dan `correction_entry` hanya ditulis bila UPDATE itu memulangkan baris. Indeks unik parsial: satu `correction_entry` reversal per `(source_kind, original_txn_id)`.
- KTD6. **Balik = baris tak berlaku di hari aslinya** lewat KTD1. `bentukJurnalSesudahTulis` mengenali `correction_entry` yang ditulis transaksi ini (UNION baru di `SQL_DITULIS_TRANSAKSI_INI`, pola reklasifikasi), sehingga jurnal hari tertutup terbentuk ulang. Bulan tertutup (baris `tutup_bulan` apa pun) ditolak (R12), sehingga pembentukan ulang jurnal tak pernah dilewati diam-diam. `day_close` tak disentuh (R12b). Dampaknya dihitung dari `correction_entry` hari itu dan ditampilkan di samping selisih beku. ⚖️ Pengecualian atas §10.33 dan catatan §10.15 dicatat di KEUANGAN-HARIAN. (session-settled: user-directed — chosen over dibukukan maju.)
- KTD7. **Predikat baru:** `canBatalkanBarisFinance` dan `canAjukanBalikBaris` (anggota sama dengan `canReklasifikasi`), serta `canSetujuiBalikBaris` (anggota sama dengan `canCloseException`). Ditulis berdiri sendiri, satu predikat per keputusan, masing-masing dengan uji HoF.

### High-Level Technical Design

Daur pengajuan Balik (arah saja, bukan spesifikasi):

```
(baris Finance, hari closed)
   └─ Ajukan  ── Finance ──▶ correction_request[menunggu]
                                 ├─ Tarik   (pengaju)              ──▶ [ditarik]
                                 ├─ Tolak   (penyetuju, catatan)   ──▶ [ditolak]
                                 └─ Setujui (penyetuju ≠ pengaju)  ──▶ [disetujui]
                                        └─ INSERT correction_entry(reversal) + bentuk ulang jurnal hari itu
```

Aliran "berlaku" ke laporan:

```
manual_entry ─┬─ SQL_ME_TAK_BERLAKU ─▶ getBebanDanPendapatan ─▶ pilahManualEntry(aktif) ─▶ IS / CF / langkah / Papan / ekspor
              ├─ NOT SQL_ME_TAK_BERLAKU ─▶ buku-besar-sumber (tertaut, hari) ─▶ jurnal
              └─ NOT SQL_ME_TAK_BERLAKU ─▶ tautan, titipan, kelengkapan, sumber-data, pantau
```

### Inventaris pembaca `app.manual_entry` (bukti grep, `origin/staging` 4285521)

Grep nama tabel di `apps/`: 34 pembaca di `apps/dashboard/src` (tak ada di `apps/backend/src`, tak ada view/trigger yang membaca). Q = saring di kueri, D = saring di hilir, N = tidak.

| Pembaca | Keluaran | Hari ini | Rencana |
|---|---|---|---|
| `keuangan-laporan-queries.ts` `getBebanDanPendapatan` | IS, CF, langkah neraca, Papan, tutup hari, ekspor PDF/CSV | D | KTD1 kolom `void` + KTD2 |
| `keuangan-beban.ts` `pilahManualEntry` | sama | `keluar`/`manualBeban` N | KTD2 |
| `keuangan-laporan-queries.ts` `getTitipanDiterima` | neraca titipan | Q | KTD1 |
| `buku-besar-sumber.ts` `SQL_TERTAUT`, `SQL_MANUAL_HARI` | jurnal | Q | KTD1 |
| `buku-besar-tulis.ts` `SQL_DITULIS_TRANSAKSI_INI` | pemicu jurnal | N (sengaja) | + UNION `correction_entry` (KTD6) |
| `tautan-queries.ts` `getKasTautan`, `getBebanTautan` | Perlu ditautkan | Q | KTD1 |
| `keuangan-input-queries.ts` `getBiayaHarian` | blok 4 | D | + kolom status balik & alasan void |
| `keuangan-input-queries.ts` `getKelengkapanInput` | tutup hari, sumber data | Q | KTD1 |
| `keuangan-input-queries.ts` `getReklasHarian` | riwayat reklas | N | tetap (riwayat sah ditampilkan) |
| `sumber-data/page.tsx` `getFakta` | Sumber data | Q | KTD1 |
| `keuangan-pantau-queries.ts` kejadian `keterangan_janggal` | Pemantauan | Q | KTD1 |
| `keuangan-pantau-queries.ts` `reklasifikasi_biaya`, aktivitas | Pemantauan | N (sengaja) | tetap + kejadian baru (R13) |
| `queries.ts` `getComplianceMatrix`, `getAdminDays`, `getManualEntries` | Ketaatan, anomali, Rincian | Q, pengawas saja | izin uji penjaga |
| `keuangan-input-queries.ts` `getSetoranPengawas`, `keuangan-pantau-queries.ts` setoran, `kas-actions.ts` `setujuiSetoran`, `setoran-tulis.ts` | setoran (pengawas) | Q | izin uji penjaga |
| `kas-actions.ts`, `cocok-bank-actions.ts`, `tautan-actions.ts`, `reklas-actions.ts`, `manual-entry-actions.ts` | penjaga tulis | Q/D | tetap; `reklas`/`tautan` menolak baris dibalik |
| `pos-queries.ts`, `keuangan-integritas.ts`, `MAX(urut)` ×5 | rujukan/integritas | N (sengaja) | tetap |

Ekspor (`lib/export/*`) tidak membaca DB. Mereka mewarisi model di atas.

### Implementation Constraints

- Pesan dan komentar dalam Bahasa Indonesia, mengikuti berkas sekitarnya.
- Setiap kueri baru masuk `queries.sqlcheck.integration.test.ts` (K1).
- `pnpm --filter @solamax/shared build` sebelum `pnpm check` di worktree baru.

---

## Implementation Units

### U1. Satu aturan "baris berlaku" (Rilis 1)

- **Goal:** R5, R6, R7. KTD1, KTD2.
- **Files:** baru `apps/dashboard/src/lib/keuangan-berlaku.ts`. Ubah `keuangan-beban.ts`, `keuangan-laporan-queries.ts`, `buku-besar-sumber.ts`, `tautan-queries.ts`, `keuangan-input-queries.ts`, `app/(app)/keuangan/sumber-data/page.tsx`, `keuangan-pantau-queries.ts`. Uji: `keuangan-beban.test.ts`, `keuangan-laporan-model.test.ts`, baru `keuangan-berlaku.guard.test.ts`.
- **Approach:** Di Rilis 1 fragmen hanya `alias.void`. Rilis 2 menambah suku reversal di satu tempat itu. Uji penjaga membaca sumber berkas yang memuat `app.manual_entry` dan menolak `NOT void` / `NOT m.void` di luar daftar izin bernama.
- **Test scenarios:**
  - `pilahManualEntry`: baris void di `pengeluaran` berakun beban → tidak ada di `manualBeban` (merah hari ini). Di `pendapatan_lain`, di akun ekuitas, di pindah dana → nol.
  - AE1 fixture Bakau 2 Okt → selisih tepat −12.440 pada Cash flow check (`panelCashFlow`) dan laba bersih (`labaBersihDari`/`panelIncome`), dan pada `langkahHarianRinci`.
  - AE2 reklas 1-1800 lalu void = void saja.
  - Ekspor: model laporan harian/CSV dari bahan dengan baris void = bahan tanpa baris itu.
  - Penjaga: berkas baru dengan `NOT m.void` pada kueri `manual_entry` → merah.
- **Execution note:** Setiap uji dijalankan merah dulu (kembalikan perbaikannya, pastikan gagal, pulihkan).

### U2. Migrasi 0059 + predikat Batalkan (Rilis 1)

- **Goal:** R2, R4. KTD4, KTD7.
- **Files:** `apps/backend/prisma/migrations/0059_manual_entry_batal/migration.sql`, `apps/backend/prisma/schema.prisma`, `apps/dashboard/src/lib/keuangan-wewenang.ts` (+ uji).
- **Test scenarios:** predikat: staf `keuangan`, super admin, HoF (peran `admin_perusahaan` + email) diizinkan, pengawas/direksi ditolak. DB: kode alasan bukan grup `void` → FK/CHECK menolak; alasan kosong dengan kode → CHECK menolak.

### U3. Tulis Batalkan + server action (Rilis 1)

- **Goal:** R1, R2, R3. KTD3.
- **Files:** baru `apps/dashboard/src/lib/batal-balik-tulis.ts`, `batal-balik-actions.ts`, `batal-balik-model.ts` (pemeriksa murni + pesan) dan uji: `batal-balik-model.test.ts`, `batal-balik.integration.test.ts` (DB nyata, ROLLBACK), `batal-balik-actions.guard.test.ts`.
- **Test scenarios:** (integrasi, Postgres sekali pakai bermigrasi sampai 0059) baris Finance hari terbuka → void + alasan tersimpan, jurnal hari itu terbentuk ulang. Baris pengawas → ditolak, tak berubah. Hari `closed` → ditolak oleh server sebelum trigger. Trigger tetap menolak UPDATE langsung. Bertaut kas → ditolak. Sudah void → ditolak. Bulan tertutup (K5 maupun buku besar) → ditolak.

### U4. Layar blok 4 + Pemantauan (Rilis 1)

- **Goal:** R3, R4, R13.
- **Files:** `components/keuangan/BiayaPanel.tsx`, `keuangan-biaya-model.ts` (+ uji), `keuangan-input-queries.ts` (`getBiayaHarian` + `BarisBiaya` mendapat `bertautKas`, `hariTutup`, `voidAt`, `voidOleh`, `voidReasonCode`, `voidAlasan`), `app/(app)/keuangan/unit/[code]/[date]/input/page.tsx`, `keuangan-pantau-queries.ts`/`-model.ts`.
- **Approach:** tombol Batalkan → form di tempat, mengikuti pola `formReklas` (kode, alasan, dampak laba dari fungsi murni `dampakBatal(section, akunEfektif, amount)`: 0 bila akun efektif bukan pembentuk laba, kalau tidak +nominal untuk pengeluaran / −nominal untuk pendapatan) → baris tampil "dibatalkan · waktu oleh email · kode · alasan". Banner blok 4 diperbarui. Kejadian `batal_biaya_finance` (kuning).
- **Kolom Tindakan per keadaan (Rilis 1):**

  | baris | pelaku berwenang | lainnya |
  |---|---|---|
  | Finance, hari terbuka, tanpa tautan kas | Reklasifikasi · Batalkan | "Batalkan oleh staf Keuangan / Head of Finance" |
  | Finance, bertaut kas | Reklasifikasi + teks "batalkan lewat mutasi kas asal" | sama, tanpa tombol |
  | Pengawas | Reklasifikasi (seperti sekarang) | seperti sekarang |
  | Hari tertutup | Reklasifikasi + teks "pembalikan menyusul" (Rilis 2 menggantinya dengan Ajukan balik) | — |
  | Void | — (status "dibatalkan …") | sama |

- **Test scenarios:** `tindakanTersedia` menegaskan seluruh tabel di atas. `dampakBatal`: beban 7.560 → laba +7.560; pendapatan 6-9900 50.000 → −50.000; baris direklas ke 1-1800 → 0 (AE2). Verifikasi tampilan: tangkapan layar lokal.

### U5. Migrasi 0060 + tulis Balik (Rilis 2)

- **Goal:** R8, R9, R10, R12. KTD5, KTD6.
- **Files:** `apps/backend/prisma/migrations/0060_correction_request/migration.sql`, schema, `keuangan-berlaku.ts` (suku reversal), `buku-besar-tulis.ts`, `batal-balik-tulis.ts`/`-actions.ts`/`-model.ts`, `keuangan-wewenang.ts`.
- **Test scenarios:** (integrasi) Tarik dan Setujui bersamaan → tepat satu menang, tak ada `correction_entry` bila Tarik menang. UPDATE langsung atas pengajuan yang sudah diputus → trigger menolak. Bulan tertutup K5 (`buku_besar=false`) → ditolak. `day_close` tak berubah sesudah persetujuan. Ajukan di hari tertutup → `menunggu`. Ajukan kedua untuk baris yang sama → ditolak. Setujui oleh pengaju → server menolak, dan INSERT DB langsung → CHECK menolak. Setujui oleh HoF → `correction_entry` tertulis dengan tujuh field, baris asli `xmin` tak berubah, laporan hari itu tanpa baris, jurnal terbentuk ulang. Reversal kedua → indeks unik menolak. Tolak tanpa catatan → ditolak. Bulan bertutup buku besar → ditolak. Baris hari terbuka → ditolak (pakai Batalkan).

### U6. Layar Balik + Pemantauan + dokumentasi (Rilis 2)

- **Goal:** R11, R13, R14.
- **Files:** `BiayaPanel.tsx`, `keuangan-biaya-model.ts`, `keuangan-input-queries.ts`, `keuangan-pantau-*`, layar tutup hari/Papan/`export/tutup-hari-doc.ts` (angka "dibalik sesudah ditutup"), `apps/dashboard/KEUANGAN-HARIAN.md`.
- **Daur di baris (form di tempat, pola `formReklas`):**

  | keadaan | teks Status | pengaju | Finance lain | penyetuju (≠ pengaju) |
  |---|---|---|---|---|
  | tersedia (hari tertutup, Finance, tanpa kas, belum dibalik) | disahkan · terkunci | Ajukan balik | Ajukan balik | Ajukan balik bila juga Finance |
  | menunggu | menunggu persetujuan balik · oleh · kapan · kode · alasan | Tarik | — | Setujui · Tolak (catatan wajib) |
  | ditolak / ditarik | kembali "tersedia" + keputusan terakhir | Ajukan lagi | Ajukan lagi | — |
  | dibalik | dibalik · disetujui oleh · kapan · kode · alasan | — | — | — |

  Form pengajuan dan persetujuan menampilkan `dampakBatal` dengan tanggal tertutupnya. Kejadian Pemantauan `balik_biaya_menunggu` bertaut ke `/keuangan/unit/<code>/<date>/input` selama menunggu, dan `balik_biaya` sesudah disetujui.
- **Test scenarios:** model menegaskan tabel daur di atas. Baris dibalik tidak dijumlah di total pintu. Selisih beku + "dibalik sesudah ditutup" = langkah yang dihitung ulang.

### U7. Rilis dan verifikasi

- **Goal:** rilis aman ke `staging`.
- **Approach:** PR Rilis 1 → `staging`, lalu PR Rilis 2 → `staging` (bergantung PR 1). Urutan rumah 0021: migrasi backend dulu, baru image dashboard. Di pilot, setujui gerbang `pilot` backend (migrate) sebelum dashboard. Risiko yang diterima: pembentukan jurnal sesudah tulis tak pernah menggagalkan tulisan (`bentukJurnalSumberDitulis` mencatat ke audit_log), jadi kegagalannya diperiksa di log uji integrasi. Sesudah merge Dion, cek tier testing `-rlsstg` di tingkat revisi (`status.traffic`, digest image = build). `main`/`pilot` milik Dion.
- **Test expectation:** none -- rilis; buktinya ada di Verification Contract.

---

## Verification Contract

- `pnpm --filter @solamax/shared build` lalu `pnpm check` hijau.
- K1: `SQLCHECK_DB=1 DATABASE_URL=<Postgres lokal bermigrasi sampai 0060> vitest run src/lib/queries.sqlcheck.integration.test.ts`.
- Integrasi DB nyata untuk U3/U5 terhadap Postgres sekali pakai (bukan pilot).
- Setiap uji perbaikan dibuktikan merah dengan perbaikannya dikembalikan.
- Tangkapan layar lokal: tombol Batalkan, dialog alasan, baris dibatalkan.
- CI PR hijau. Sesudah merge Dion: revisi `-rlsstg` melayani 100% trafik dengan digest = build.

## Definition of Done

- R1–R14 terpenuhi atau tercatat ditunda dengan alasan.
- Dua PR ke `staging` terbuka dengan bukti uji. Laporan akhir menyebut yang tidak tercakup dan langkah Dion (merge, gerbang `pilot`, uji Bakau 2 Okt di pilot).
