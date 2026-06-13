# SolaMax — Desain Auth + RBAC + Multi-Tenant (Fase Auth)

> **Status: DESAIN — nol implementasi.** Menggantikan rencana B1 (Cloud IAP). Tujuan:
> fondasi PRODUK ber-auth aplikasi yang **siap multi-tenant** (replikasi ke perusahaan SPBU
> lain), terima sign-in Google bebas (termasuk @gmail.com), akses & role dikelola
> `super_admin` dari dalam app. **Tidak ada kode/DDL dijalankan sampai Anda approve.**
> Aturan tetap: data EasyMax-mirror **read-only**; app hanya menulis tabel auth/kontrol.

Konteks awal: dashboard saat ini tanpa auth, role "Direksi" hardcoded di topbar, koneksi
DB `dashboard_ro` (SELECT-only). Desain ini menambah lapisan identitas + otorisasi tanpa
mengubah logika data/G-L yang sudah terbukti.

---

## 1. Login — library & sesi

**Rekomendasi: Auth.js v5 (`next-auth@5`) + Google OAuth provider.** Alasan:
- **Jangan hand-roll auth** — Auth.js menangani alur OAuth, tukar token, cookie sesi,
  proteksi CSRF/state, dan rotasi — area yang rawan bila ditulis sendiri.
- Integrasi resmi Next.js App Router (route handler `app/api/auth/[...nextauth]/route.ts`
  + helper `auth()` server-side).
- Cocok dengan stack kita: pakai **`@auth/pg-adapter`** di atas `pg` Pool yang sudah ada
  (tanpa menambah Prisma di dashboard).

**Provider:** Google OAuth — sign-in akun Google **apa pun** (sesuai keputusan: gmail bebas).
**Penting:** "terima gmail bebas" **bukan** "siapa pun dapat akses" — lihat §3 (invite-gated):
login berhasil tapi tanpa keanggotaan → layar "akun belum diberi akses", nol data.

**Strategi sesi: DATABASE session (bukan JWT).** Trade-off:
| | DB session (pilih) | JWT |
|---|---|---|
| Cabut akses | **seketika** (hapus baris sesi) | tertunda s/d token kedaluwarsa |
| Role/tenant berubah | **langsung berlaku** | basi s/d refresh |
| Beban | 1 query ringan/request | stateless (lebih cepat) |
Untuk dashboard pengawasan dengan `super_admin` yang mengelola akses & role, **kepastian
cabut-seketika + role selalu segar** lebih penting daripada hemat 1 query → DB session.

**Cookie & CSRF:** Auth.js set cookie sesi **httpOnly + Secure + SameSite=Lax**, plus token
CSRF bawaan untuk route auth. Tak ada token sesi yang terekspos ke JS klien.

**Opsi tambahan (ditunda):** email+password (Credentials provider) — **tidak** default karena
menyimpan hash password & menambah permukaan; Google OAuth menghindarinya. Bisa ditambah nanti
bila ada user tanpa akun Google.

---

## 2. Model data — RBAC + multi-tenant

Skema baru di Cloud SQL `solamax`, **schema terpisah `app`** (memisahkan identitas/otorisasi
dari data mirror EasyMax di `public`). Dimiliki & dimigrasikan oleh **backend Prisma**
(satu sumber migrasi; dashboard hanya membaca/menulisnya via adapter).

```
app.tenant                 -- perusahaan (multi-tenant)
  id            uuid pk
  name          text                  -- "SolaGroup"
  slug          text unique
  status        text default 'active' -- active | suspended
  created_at    timestamptz

app.auth_user              -- identitas (dikelola Auth.js adapter)
  id            uuid pk
  email         text unique           -- dari Google
  name, image   text
  email_verified timestamptz
app.auth_account, app.auth_session, app.auth_verification_token  -- bawaan Auth.js

app.membership             -- OTORISASI: user ⇒ tenant + role
  id            uuid pk
  user_id       uuid → auth_user
  tenant_id     uuid → tenant  (NULL = lintas-tenant, khusus super_admin)
  role          text  -- 'super_admin'|'admin_perusahaan'|'direksi'|'pengawas'
  status        text default 'active' -- active | invited | disabled
  created_at, created_by
  UNIQUE(user_id, tenant_id)

app.user_unit              -- scope unit utk pengawas (direksi/admin = semua unit tenant)
  membership_id uuid → membership
  unit_id       smallint → public.unit(unit_id)
  UNIQUE(membership_id, unit_id)
```

**Perubahan tabel data:** `public.unit` **+ kolom `tenant_id uuid`** (FK → app.tenant).
Setiap SPBU milik satu tenant. (Pilot: 1 tenant SolaGroup, 1 unit IB → backfill tenant_id.)

**Hierarki role (rank):**
| Role | Lingkup |
|---|---|
| `super_admin` | **lintas semua tenant** (Anda) — kelola tenant, user, role |
| `admin_perusahaan` | seluruh tenant-nya — kelola user di tenant itu |
| `direksi` | **semua SPBU** dalam tenant-nya (read analitik) |
| `pengawas` | **hanya unit(s)** di `user_unit` (1 SPBU) |

Pilot: `super_admin` (Anda) + nanti `direksi` SolaGroup. Struktur `tenant_id` ADA sejak awal
walau baru 1 tenant.

---

## 3. Penegakan akses — SERVER-SIDE (keamanan inti)

Prinsip: **default-deny + scope otomatis di lapisan query**, bukan sekadar sembunyikan di UI.

**a. Konteks sesi (server):** helper `getAuthContext()`:
1. `auth()` → sesi (atau null → redirect `/login`).
2. Muat `membership` (role, tenant_id) + `user_unit` (daftar unit_id) untuk user itu.
3. Bila user login TANPA membership aktif → kembalikan state `no-access` (render layar
   "akun Anda belum diberi akses; hubungi admin", nol query data). Inilah gerbang invite.
4. Hasil: `{ userId, role, tenantId, unitScope: number[] | 'ALL' }`.

**b. Scope di query layer:** setiap fungsi di `lib/queries.ts` menerima `AuthScope` wajib dan
menambah filter:
- `tenant`: `WHERE unit.tenant_id = $tenantId` (super_admin → boleh lintas / pilih tenant).
- `unit`: pengawas → `WHERE unit_id = ANY($unitScope)`; direksi/admin → semua unit tenant.
- Tanpa scope yang sah → fungsi melempar / kembalikan kosong (default-deny).
Contoh: `getUnitByCode(code, scope)` menolak (404/403) bila unit di luar tenant/scope user —
pengawas membuka URL unit lain = ditolak di server, bukan cuma disembunyikan.

**c. Middleware (proxy):** `middleware.ts` Auth.js memblok semua route (kecuali `/login`,
`/api/auth/*`, aset) bila tak ada sesi → redirect login. **Otorisasi granular tetap di server
component/route handler** lewat `getAuthContext()` + scope (middleware hanya gerbang auth).

**d. Pertahanan berlapis (opsi hardening, ditunda):** Postgres **RLS** per `tenant_id`
(set `app.current_tenant` per request) sebagai jaring kedua bila ada bug app-layer. Tidak
wajib untuk pilot; dicatat sebagai peningkatan.

---

## 4. Kredensial DB — role baru `dashboard_app`

`dashboard_ro` (SELECT-only di semua) **tak cukup** (app perlu tulis sesi/user/role).
`ingest` **tidak** dipakai app. Buat role baru:

```
dashboard_app:
  -- data mirror EasyMax (public): HANYA BACA
  GRANT USAGE ON SCHEMA public;
  GRANT SELECT ON ALL TABLES IN public;        -- sales_*, opname, delivery, cash_*,
                                               -- product, nozzle, tangki, account, unit, sync_state
  -- auth/kontrol (app): BACA + TULIS
  GRANT USAGE, CREATE? (no) ; GRANT USAGE ON SCHEMA app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN app;
  ALTER DEFAULT PRIVILEGES IN app GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES;
```
Hasil: app **tak bisa menulis** ke data mirror EasyMax (tetap milik `ingest`), tapi
kelola penuh tabel auth/kontrol. Memenuhi: read-only data, read/write hanya auth.
(Catatan: `unit.tenant_id` di-set saat migrasi/seed oleh `ingest`/superuser, bukan app.)

---

## 5. super_admin (pilot — minimal)

- **Bootstrap tanpa telur-ayam:** env `SUPERADMIN_EMAILS` (mis. email Anda). Saat login
  pertama email itu & belum ada membership → otomatis dibuat `membership(role=super_admin,
  tenant_id=NULL)`. Setelah itu kelola via app.
- **Layar `/admin` minimal (super_admin & admin_perusahaan):**
  1. **Undang user**: masukkan email + pilih tenant + role (+ unit bila pengawas) → buat
     `membership(status='invited')`; saat email itu sign-in Google, otomatis aktif.
  2. **Daftar user** per tenant + role + status.
  3. **Ubah role / nonaktifkan** (set `status='disabled'` → sesi dicabut).
- **Lanjut (fase berikutnya):** audit trail, transfer kepemilikan, bulk, dsb.

---

## 6. Ditunda secara sadar (BUKAN di fase ini)

1. **Deploy ke Cloud Run + promosi produksi** — setelah auth siap & Anda approve (fase B1-deploy
   terpisah; IAP tidak dipakai lagi, digantikan auth app).
2. **Onboarding mandiri perusahaan #2** (self-serve signup tenant) — pilot cukup super_admin
   buat tenant manual.
3. **Billing / langganan.**
4. **Postgres RLS** sebagai hardening lapis-DB (app-layer scoping dulu).
5. **Email-invite otomatis** (kirim email undangan) — pilot: super_admin tambah email, user
   tinggal sign-in.
6. **Login email+password** (Credentials) — default Google OAuth dulu.
7. **Audit log UI, manajemen role lanjutan, SSO korporat (SAML), 2FA.**
8. **Persona Pengawas/Admin-Area/Ops penuh** (layar khusus) — di luar auth ini.

---

## Alur ringkas (request)

```
Browser → middleware (ada sesi? tidak → /login)
        → server component → getAuthContext() → {role, tenantId, unitScope}
            → no membership? → layar "belum diberi akses" (nol data)
            → queries(scope) → Cloud SQL (dashboard_app): SELECT data di-scope tenant+unit
        → render hanya yang boleh
/api/auth/* (Auth.js): Google OAuth, set cookie httpOnly, sesi di app.auth_session
/admin (super_admin): tulis app.membership / app.user_unit
```

## Keputusan terbuka — perlu jawaban Anda sebelum implementasi

1. **Strategi sesi:** DB session (rekomendasi) — setuju? (vs JWT)
2. **Pemilik skema auth:** backend **Prisma** (rekomendasi, satu sumber migrasi) — setuju? Atau
   skema auth dikelola terpisah di dashboard?
3. **Pengawas multi-unit:** dukung sejak awal lewat `user_unit` (rekomendasi, fleksibel) atau
   kunci 1-unit dulu?
4. **Email super_admin** untuk `SUPERADMIN_EMAILS` (Anda yang mana — damiandionsalam@gmail.com?).
5. **Kebijakan email tak dikenal:** login Google sukses tanpa membership → layar "belum diberi
   akses" (rekomendasi, invite-only). Konfirmasi (vs auto-buat sebagai role terbatas).
6. **OAuth client GCP:** perlu dibuat (Client ID/secret) di project `solamax` — saya pandu
   langkahnya, **Anda** yang klik di Console & simpan secret (gitignored). OK?
7. **Domain restriction:** terima SEMUA Google (gmail bebas) sesuai instruksi — konfirmasi tak
   ada pembatasan `hd` domain (akses dibatasi via membership, bukan domain).

STOP — menunggu approval desain + jawaban 1–7. Tanpa implementasi/deploy sampai itu.
