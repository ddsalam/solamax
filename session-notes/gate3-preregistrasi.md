# PRA-REGISTRASI GATE 3 — disegel SEBELUM `0019` menyentuh produksi

> **Berkas ini APPEND-ONLY.** Bagian "Prediksi" tidak boleh disunting setelah
> orakelnya dijalankan; hasilnya ditambahkan di bawah sebagai bagian terpisah.
> Pelajaran 28 Oktober: prediksi hanya sah bila disegel lebih dulu — menyegel dari
> keluaran yang sudah dilihat memproduksi "kecocokan" yang tidak berarti apa-apa.

Disegel: 2026-07-26, sebelum PR #137 di-merge. Basis: pembacaan LIVE read-only
(proxy `:5443`, ±90 detik, 5 query, lalu dibongkar).

---

## A. Keadaan LIVE saat penyegelan (fakta, bukan prediksi)

```
membership=12  aktif=12  pengawas=8  non_pengawas_ber_tenant=3  global_null=1
unit=7  unit_tanpa_tenant=0  tenant=6  user_unit=8
user_role_campur=0        user_unit_lintas_tenant=0
audit_total=11  punya_tenant_langsung=10  pulih_via_join=1
```

Instance dipastikan LIVE: `system_identifier = 7650126488674766864`.

`prisma migrate deploy` terbukti membungkus satu berkas migrasi dalam **satu
transaksi** (probe terkendali di `-rlsstg`: `CREATE TABLE` sebelum `RAISE
EXCEPTION` **tidak tersisa**, `applied_steps_count = 0`). Karena itu kegagalan
post-condition di produksi = rollback bersih, nol perubahan tertinggal, revisi
lama terus melayani.

---

## B. Prediksi (disegel — jangan disunting)

**P1 — Migrasi lolos.** `prisma migrate deploy` selesai tanpa
`0019 batal: backfill all_units MENGGESER akses efektif …`. Bila muncul: **STOP**,
tidak ada yang tertinggal (transaksional), lapor.

**P2 — `all_units` sesudah backfill: `true` = 4 baris, `false` = 8 baris.**

⚠️ Klarifikasi terhadap harapan owner ("`true` untuk 3 non-pengawas"): angka 3 itu
menghitung non-pengawas **ber-tenant** saja. Backfill-nya
`all_units = (role <> 'pengawas')`, sehingga baris `super_admin` (tenant NULL) juga
menjadi `true`. Keduanya konsisten; saya segel angka **4** supaya tidak dibaca
sebagai meleset nanti. `super_admin` tak terpengaruh `all_units` (ia lewat cabang
terpisah di `unitVisible`), jadi ini tidak melebarkan akses siapa pun.

| `all_units` | siapa |
|---|---|
| `true` (4) | babanzana610@ (admin_perusahaan) · ddsalam@solagas (direksi) · thhendrasalam@ (direksi) · damiandionsalam@ (**super_admin, tenant NULL**) |
| `false` (8) | delapan pengawas: merita.abadisukses@ · pengawas.spbubakau@ · sola.adis.raya@ · solapetraenergi@ · spbu6378301sbbl@ · spbu6478201bl@ · spbu6478311milop@ · spbuimambonjolpontianak@ |

**P3 — `user_unit`: 8 baris, `tenant_id` selaras 8/8** dengan tenant membership-nya.

**P4 — `audit_log` ter-backfill 11/11** (10 langsung dari `detail->>'tenant_id'`,
1 `revoke_access` pulih lewat join ke baris grant-nya). **< 11 = STOP dan lapor** —
artinya `detail` di live tidak seperti yang dibaca di GATE 1. (Catatan pembanding:
`-rlsstg` hanya 2/3 karena satu baris warisan 2026-07-06 ber-`detail` NULL; LIVE
tidak punya baris seperti itu.)

**P5 — Enam constraint + satu trigger hadir**, diverifikasi lewat katalog:
`unit_unit_id_tenant_id_key` · `unit_tenant_id_fkey` (ON DELETE **RESTRICT**) ·
`membership_user_id_role_fkey` · `membership_user_id_tenant_id_key`
(**NULLS NOT DISTINCT**) · `user_unit_unit_tenant_fkey` ·
`user_unit_membership_tenant_fkey` · trigger `user_unit_fill_tenant`;
dan `public.unit.tenant_id` `is_nullable = NO`.

**P6 — Diff akses efektif IDENTIK** dengan `baseline-gate0.txt` untuk ke-12 baris,
dihitung lewat **lapis aplikasi** (`apps/dashboard/scripts/akses-efektif.mts`:
`ACTIVE_MEMBERSHIPS_SQL` → `toAssignments` → `resolveRole` → `unitVisible` atas
query unit yang sama dengan `getDataScope`) — jaring yang independen dari
post-condition SQL migrasi. Nilai yang diharapkan, per orang:

```
babanzana610@gmail.com             admin_perusahaan  6478111,6378301
damiandionsalam@gmail.com          super_admin       6478111,6378301,6478101,6478106,6478201,6478311,63781002
ddsalam@solagas.com                direksi           6478111,6378301
merita.abadisukses@solagroup.co    pengawas          6478106
pengawas.spbubakau@gmail.com       pengawas          6378301
sola.adis.raya@solagroup.co        pengawas          6478101
solapetraenergi@gmail.com          pengawas          63781002
spbu6378301sbbl@solagroup.co       pengawas          6378301
spbu6478201bl@solagroup.co         pengawas          6478201
spbu6478311milop@solagroup.co      pengawas          6478311
spbuimambonjolpontianak@gmail.com  pengawas          6478111
thhendrasalam@gmail.com            direksi           6478111,6378301
```
Satu unit pun bergeser = **kegagalan arc**, bukan efek samping.

**P7 — Jendela "skema baru + image lama" aman.** Setelah P1 mendarat di `main` dan
sebelum P2, dashboard produksi (revisi lama) tetap melayani: halaman termuat, dan
23 sesi DB yang hidup **tidak** jatuh ke nol-akses. Diverifikasi dengan membuka
dashboard, bukan disimpulkan dari dokumen.

**P8 — `_prisma_migrations` LIVE bertambah tepat satu baris**
(`0019_rbac_scope_alignment`), `finished_at` terisi, `rolled_back_at` NULL.

---

## C. Titik pulih

Backup on-demand **`1785083543035`** (2026-07-26T16:32:23Z, `SUCCESSFUL`,
"pra-migrasi-0019-rbac-scope") diambil tepat sebelum `0019` menyentuh produksi.
Backup otomatis kini aktif (08:00 UTC, retensi 7). PITR sengaja **tidak** diaktifkan
(butuh restart — keputusan terpisah milik owner).

Ini mengubah kegagalan dari tak-terpulihkan menjadi terpulihkan. Ia **tidak**
mengubah ambang kehati-hatian.
