# BASELINE AKSES PENGGANTI — 2026-07-28

> **Menggantikan `baseline-gate0.txt` sebagai "keadaan saat ini".** Berkas lama TIDAK
> ditimpa dan TIDAK dibuang: ia menjadi **sejarah** — potret akses sebelum arc
> "Kelola Akses multi-unit / multi-tenant". Reproduksinya ada di §4 supaya
> perbandingan tetap bisa dilakukan meski scratchpad sesi sudah hilang.
>
> Kenapa ada dua: sepanjang arc, "identik dengan `baseline-gate0.txt`" adalah
> kriteria penerimaan yang paling keras — setiap pergeseran otomatis berarti cacat,
> tanpa perlu menimbang niat. Sejak owner sengaja melebarkan akses, kriteria itu
> tak lagi berlaku apa adanya. Baseline baru merekam titik nol yang baru,
> **berikut alasan mengapa titiknya bergeser** — supaya orang berikutnya tidak
> perlu menebak.

---

## 1. Keadaan akses efektif — LIVE `solamax-pg` (`system_identifier 7650126488674766864`)

Dihitung lewat **lapis aplikasi** (`apps/dashboard/scripts/akses-efektif.mts`:
`ACTIVE_MEMBERSHIPS_SQL` → `toAssignments` → `resolveRole` → `unitVisible`), bukan
dengan mengulang SQL post-condition migrasi — dua jaring yang saling bebas.

| email | role | PT | unit efektif |
|---|---|---|---|
| babanzana610@gmail.com | admin_perusahaan | 2 | 6478111, 6378301, 6478201 |
| damiandionsalam@gmail.com | super_admin | (global) | ketujuhnya |
| ddsalam@solagas.com | direksi | 6 | ketujuhnya |
| merita.abadisukses@solagroup.co | pengawas | 1 | 6478106 |
| pengawas.spbubakau@gmail.com | pengawas | 1 | 6378301 |
| sola.adis.raya@solagroup.co | pengawas | 1 | 6478101 |
| solapetraenergi@gmail.com | pengawas | 1 | 63781002 |
| spbu6378301sbbl@solagroup.co | pengawas | 1 | 6378301 |
| spbu6478201bl@solagroup.co | pengawas | 1 | 6478201 |
| spbu6478311milop@solagroup.co | pengawas | 1 | 6478311 |
| spbuimambonjolpontianak@gmail.com | pengawas | 1 | 6478111 |
| thhendrasalam@gmail.com | direksi | 6 | ketujuhnya |

```
membership 23 · user_role 12 · user_unit 8 · audit_log 27
lintas_tenant 0 · role_campur 0
```

`user_unit` tetap **8** karena semua penugasan baru memakai `all_units = true` —
"semua unit perusahaan ini", yang **mewarisi unit ke-8 kelak secara otomatis**.
Daftar unit beku hanya dipakai delapan pengawas lama.

---

## 2. Apa yang berubah dari `baseline-gate0.txt`, dan atas persetujuan siapa

**Sembilan orang IDENTIK** dengan baseline lama — diverifikasi mekanis, bukan mata.

Tiga berbeda, ketiganya disengaja:

| email | sebelum | sesudah | dasar |
|---|---|---|---|
| `thhendrasalam@gmail.com` | direksi · 2 unit | direksi · **7 unit** (6 PT) | rencana grant lintas-PT, owner 2026-07-27/28 |
| `ddsalam@solagas.com` | direksi · 2 unit | direksi · **7 unit** (6 PT) | idem |
| `babanzana610@gmail.com` | admin_perusahaan · 2 unit | admin_perusahaan · **3 unit** | **pelebaran disetujui owner 2026-07-27** — di luar rencana 10 grant; owner sendiri yang menjalankannya (PT Batu Layang Jaya) |

**Role tak bergeser untuk siapa pun.** `user_role` tetap 12, dan satu-satunya baris
`set_role` adalah **no-op** (lihat §3).

---

## 3. Revisi harapan tersegel — 2026-07-27, ditetapkan owner sebelum orakel dijalankan

Segel awal (`membership 12→22`, `audit_log 11→21`) direvisi **oleh owner**, bukan oleh
pemeriksa, karena grant `babanzana610@` menggeser angka dasar dari 12/11 menjadi 13/13
**sebelum** 10 grant dijalankan.

> Kalau pemeriksa boleh mengubah angka harapan setelah melihat angka nyata, segelnya
> kehilangan seluruh gunanya — apa pun yang terjadi bisa dibuat cocok. Karena itu
> revisi ini dicatat sebagai **revisi**, lengkap dengan sebab dan tanggalnya.

```
membership   13 → 23        ANGKA KERAS      → tercapai: 23 ✓
user_unit    tetap 8                          → 8  ✓
user_role    tetap 12                         → 12 ✓
set_role     nol baris baru                   → 1  ✗ (lihat bawah)
audit_log    23, diuji BERSYARAT (bukan kesamaan angka)
```

### Kenapa `audit_log` diuji bersyarat, bukan sebagai angka

`audit_log` terbukti **bukan penghitung penugasan yang andal**: simpan-berulang
menambah baris audit tanpa menambah membership, dan itu benar-benar terjadi dua kali.
Karena itu angka kerasnya `membership`, sementara `audit_log` diuji begini —
**kelebihan hanya sah bila `membership_id`-nya berulang**:

```sql
WITH ulang AS (
  SELECT (detail->>'membership_id')::uuid AS mid, count(*) AS baris,
         string_agg(to_char(created_at AT TIME ZONE 'Asia/Pontianak','MM-DD HH24:MI'),
                    ' · ' ORDER BY created_at) AS waktu
  FROM app.audit_log
  WHERE action = 'grant_access' AND created_at >= DATE '2026-07-27'
  GROUP BY 1 HAVING count(*) > 1
)
SELECT u.*, EXISTS (SELECT 1 FROM app.membership m WHERE m.id = u.mid) AS membership_ada FROM ulang u;
```

⚠️ Dua klausa filter itu **wajib**. Tanpa `action='grant_access'`, pasangan
`grant_access`+`revoke_access` membership `b416d845…` terjaring — padahal pasangan
itulah yang dipakai `0019` memulihkan `tenant_id`. Tanpa `created_at >= 2026-07-27`,
grant lama `49750c50…` (22-07, di-`ON CONFLICT`-update 27-07) juga terjaring. Keduanya
riwayat sah, bukan temuan.

Hasil akhir — dua kelebihan, keduanya sah:

| `membership_id` | baris | waktu | pemilik · tenant |
|---|---|---|---|
| `49247e20…` | 2 | 07-27 13:48 · 13:49 | babanzana610@ · PT Batu Layang Jaya |
| `d4eaca20…` | 3 | 07-28 15:55 · 16:05 · 16:06 | ddsalam@solagas.com · PT Sola Petra Energi |

Keduanya berbagi `membership_id` dan membership-nya ada → simpan-berulang, **bukan**
penugasan tak direncanakan. Penyebabnya tercatat: pada 27-07 banner umpan balik belum
ada; pada 28-07 banner ada tapi masih ter-render di puncak dokumen (diperbaiki #146).

**Invarian 2** — `mid` unik `grant_access` ≥27-07 vs membership baru: **12 vs 11**.
Selisih 1 = `49750c50…`, membership `thhendrasalam@` @ PT Sola Petra Abadi yang sudah
ada sejak 22-07 lalu di-`ON CONFLICT`-update. Dengan rumusan yang diperketat —
*`mid` unik yang membership-nya juga dibuat ≥27-07* — hasilnya **11 = 11** ✓.
Rumusan tersegel dipertahankan apa adanya; selisihnya dicatat sebagai penjelasan,
bukan dibaca ulang menjadi lulus.

### Penyimpangan yang diketahui dan tak berdampak

```
2026-07-28 15:54:55 | set_role | damiandionsalam@gmail.com | target 3 | direksi → direksi
```

Harapan tersegel berbunyi "nol baris `set_role` baru"; ada **satu**. **Dikonfirmasi
owner sebagai tindakannya sendiri** — tombol "Set" ditekan sebelum grant. Nilainya
`lama = baru = direksi`: **no-op**, role tidak bergeser, `user_role` tetap 12.
Dicatat sebagai penyimpangan **diketahui dan tak berdampak**, bukan dibulatkan
menjadi nol.

---

## 4. `baseline-gate0.txt` — direproduksi verbatim (sejarah, jangan diubah)

Potret 2026-07-26, sebelum migrasi `0019` dan sebelum grant apa pun.

```
               email               |       role       |               tenant               |                       unit_efektif
-----------------------------------+------------------+------------------------------------+----------------------------------------------------------
 babanzana610@gmail.com            | admin_perusahaan | pt-sola-petra-abadi                | 6478111,6378301
 damiandionsalam@gmail.com         | super_admin      | (global)                           | 6478111,6378301,6478101,6478106,6478201,6478311,63781002
 ddsalam@solagas.com               | direksi          | pt-sola-petra-abadi                | 6478111,6378301
 merita.abadisukses@solagroup.co   | pengawas         | pt-merita-abadi-sukses             | 6478106
 pengawas.spbubakau@gmail.com      | pengawas         | pt-sola-petra-abadi                | 6378301
 sola.adis.raya@solagroup.co       | pengawas         | pt-sola-adis-raya                  | 6478101
 solapetraenergi@gmail.com         | pengawas         | pt-sola-petra-energi               | 63781002
 spbu6378301sbbl@solagroup.co      | pengawas         | pt-sola-petra-abadi                | 6378301
 spbu6478201bl@solagroup.co        | pengawas         | pt-batu-layang-jaya                | 6478201
 spbu6478311milop@solagroup.co     | pengawas         | pt-mitra-indah-lestari-oil-pratama | 6478311
 spbuimambonjolpontianak@gmail.com | pengawas         | pt-sola-petra-abadi                | 6478111
 thhendrasalam@gmail.com           | direksi          | pt-sola-petra-abadi                | 6478111,6378301
```

---

## 5. Cara memperbarui baseline ini lain kali

1. Jalankan `akses-efektif.mts` terhadap LIVE (read-only, proxy per-langkah).
2. Bandingkan **mekanis** dengan tabel §1 — bukan dengan mata.
3. Setiap baris yang bergeser wajib punya **dasar tertulis** (siapa menyetujui, kapan,
   mengapa) sebelum masuk baseline berikutnya. Pergeseran tanpa dasar = berhenti dan
   lapor, bukan direkam.
4. Baseline baru ditulis **di samping** yang ini, bukan menimpanya.
