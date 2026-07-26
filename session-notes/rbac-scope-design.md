# GATE 1 — Desain "Kelola Akses" multi-unit / multi-tenant

> Arc: `claude/manage-role-improvement` (basis = `origin/staging` `0ad4345`).
> Prasyarat: laporan GATE 0 (baseline 12 membership, 7 unit, 6 tenant).
> **Status: menunggu persetujuan owner. Nol perubahan kode aplikasi.**

---

## 0. Ringkasan keputusan

| # | Keputusan | Bentuk |
|---|---|---|
| D1 | Hak efektif = **gabungan** semua membership aktif | `getAuthContext` mengembalikan `assignments[]`, bukan 1 baris |
| D2 | Role **tunggal per orang**, global | Tabel `app.user_role` + FK komposit dari `membership` — **deklaratif, tanpa trigger** |
| D3 | Batas unit berlaku untuk **semua role** | `membership.all_units boolean NOT NULL DEFAULT false` |
| D4 | Keselarasan unit↔tenant **mustahil secara skema** | `user_unit.tenant_id` + FK komposit ke **dua** sisi |
| D5 | `super_admin` tetap global & tak-grantable | `UNIQUE NULLS NOT DISTINCT (user_id, tenant_id)` |
| D6 | Suspend menggantikan hard-delete | tulis `status='disabled'` (CHECK sudah ada sejak 0003) |
| D7 | Admin terdelegasi per-PT | `/admin` jadi permukaan ber-scope + 5 aturan keras |
| D8 | Pembaca audit ber-scope | `audit_log.tenant_id` + backfill dari JSONB |

---

## 1. Skema target

### 1.1 `public.unit` — tenant wajib + kunci komposit

```sql
ALTER TABLE public.unit ALTER COLUMN tenant_id SET NOT NULL;      -- live: 0 baris NULL
ALTER TABLE public.unit DROP CONSTRAINT unit_tenant_id_fkey;
ALTER TABLE public.unit ADD  CONSTRAINT unit_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES app.tenant(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE public.unit ADD  CONSTRAINT unit_unit_id_tenant_id_key UNIQUE (unit_id, tenant_id);
```

`ON DELETE SET NULL` → `RESTRICT`: dengan `NOT NULL`, menghapus tenant yang masih
punya unit harus **ditolak**, bukan diam-diam meyatimkan unit.

### 1.2 `app.user_role` — invarian "satu role per orang", deklaratif

```sql
CREATE TABLE app.user_role (
  user_id int  PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  role    text NOT NULL CHECK (role IN ('super_admin','admin_perusahaan','direksi','pengawas')),
  CONSTRAINT user_role_user_id_role_key UNIQUE (user_id, role)   -- target FK
);
ALTER TABLE app.membership ADD CONSTRAINT membership_user_id_role_fkey
  FOREIGN KEY (user_id, role) REFERENCES app.user_role(user_id, role) ON UPDATE CASCADE;
```

**Kenapa bentuk ini, bukan trigger dan bukan memindahkan `role` ke `app.users`:**
`user_role` punya **tepat satu baris per user** (PK `user_id`). FK komposit memaksa
`(user_id, role)` setiap membership menunjuk baris tunggal itu. Jadi invarian
lintas-baris — yang biasanya tak deklaratif di Postgres — menjadi **konsekuensi
kunci**, bukan kode yang bisa lupa dijalankan. Trigger ditolak karena ia validasi
prosedural (bisa di-`DISABLE`, tak terlihat di `\d`); memindahkan `role` ke
`app.users` ditolak karena `app.users` milik adapter Auth.js (kolom asing di tabel
yang di-manage pustaka = risiko saat upgrade).

Efek samping yang menguntungkan: mengubah role seseorang = **satu** `UPDATE
app.user_role SET role=…`, dan `ON UPDATE CASCADE` merambatkannya ke seluruh
membership orang itu secara atomik.

### 1.3 `app.membership` — `all_units` + perbaikan unique NULL

```sql
ALTER TABLE app.membership ADD COLUMN all_units boolean NOT NULL DEFAULT false;
UPDATE app.membership SET all_units = (role <> 'pengawas');       -- lihat §3 (identitas)
DROP INDEX app.membership_user_id_tenant_id_key;
ALTER TABLE app.membership ADD CONSTRAINT membership_user_id_tenant_id_key
  UNIQUE NULLS NOT DISTINCT (user_id, tenant_id);                 -- PG 16.13 ✓
ALTER TABLE app.membership ADD CONSTRAINT membership_id_tenant_id_key UNIQUE (id, tenant_id);
```

`DEFAULT false` disengaja: **himpunan kosong tidak pernah berarti "semua"**.
Baris baru yang lupa menyetel apa pun = DENY, bukan akses penuh.

### 1.4 `app.user_unit` — keselarasan tenant secara struktural

```sql
ALTER TABLE app.user_unit ADD COLUMN tenant_id uuid;
UPDATE app.user_unit uu SET tenant_id = m.tenant_id FROM app.membership m WHERE m.id = uu.membership_id;
ALTER TABLE app.user_unit ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE app.user_unit DROP CONSTRAINT user_unit_unit_id_fkey;
ALTER TABLE app.user_unit DROP CONSTRAINT user_unit_membership_id_fkey;
ALTER TABLE app.user_unit ADD  CONSTRAINT user_unit_unit_tenant_fkey
  FOREIGN KEY (unit_id, tenant_id)       REFERENCES public.unit(unit_id, tenant_id)
  ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE app.user_unit ADD  CONSTRAINT user_unit_membership_tenant_fkey
  FOREIGN KEY (membership_id, tenant_id) REFERENCES app.membership(id, tenant_id)
  ON UPDATE CASCADE ON DELETE CASCADE;
```

**Kenapa ini mustahil-secara-skema, bukan divalidasi** (bukti eksekusi di §7.2):
`tenant_id` adalah satu kolom, jadi hanya ada tiga isi yang mungkin, dan ketiganya
tertutup:

| isi `tenant_id` | ditolak oleh |
|---|---|
| tenant **unit** (jujur) | FK sisi membership — membership tak ada di tenant itu |
| tenant **membership** (dipalsukan) | FK sisi unit — unit tak ada di tenant itu |
| tenant ketiga mana pun | keduanya |

Tidak ada nilai yang lolos. Karena itu `scope-rule.ts:35` **turun status** dari
gerbang tenant tunggal menjadi redundansi murah di lapis aplikasi — dan itulah
jawaban atas pertanyaan (a): **ya, terjamin secara struktural.** Pemeriksaannya
tetap dipertahankan (biaya nol, dan ia melindungi jalur baca terhadap data yang
ditulis sebelum migrasi ini).

### 1.5 Trigger pengisi `tenant_id` (direkomendasikan — lihat §5 urutan deploy)

```sql
CREATE FUNCTION app.user_unit_fill_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM app.membership WHERE id = NEW.membership_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_unit_fill_tenant BEFORE INSERT ON app.user_unit
  FOR EACH ROW EXECUTE FUNCTION app.user_unit_fill_tenant();
```

Ini **bukan** kontrol keamanan — kedua FK tetap penegaknya. Fungsinya dua: (i)
membuat jendela "skema baru + image lama" di §5 **tanpa fungsi yang hilang sama
sekali**, dan (ii) membuat `tenant_id` tak bisa dipalsukan karena penulis mana pun
boleh mengabaikannya.

### 1.6 `app.audit_log` — kolom tenant + backfill

```sql
ALTER TABLE app.audit_log ADD COLUMN tenant_id uuid;              -- NULL = global
UPDATE app.audit_log SET tenant_id = (detail->>'tenant_id')::uuid
  WHERE detail ? 'tenant_id' AND tenant_id IS NULL;
-- baris revoke_access tak membawa tenant_id: pulihkan dari grant sebelumnya
UPDATE app.audit_log r SET tenant_id = g.tenant_id
  FROM app.audit_log g
 WHERE r.tenant_id IS NULL AND g.tenant_id IS NOT NULL
   AND r.detail->>'membership_id' = g.detail->>'membership_id';
```

11 baris historis (bukti di §7.4): 10 `grant_access` membawa `detail->>'tenant_id'`
langsung; 1 `revoke_access` (membership `b416d845…`, sudah dihapus) dipulihkan lewat
join ke baris grant-nya (`69ff5f8c…`, tenant `80885713…` = PT Sola Petra Abadi).
**Backfill 11/11.** Sifat append-only tidak dilonggarkan: `UPDATE` di atas dijalankan
oleh migrasi sebagai role **`ingest`** (pemilik tabel), sementara grant
`dashboard_app` tetap `SELECT, INSERT` saja.

Baris yang (hipotetis) tetap `NULL` → hanya terlihat `super_admin` (fail-closed).

---

## 2. Model aplikasi

```ts
// auth-context.ts
export interface Assignment {
  membershipId: string;
  tenantId: string;          // NOT NULL — super_admin tidak punya assignment
  allUnits: boolean;
  unitIds: number[];         // relevan hanya bila !allUnits
}
export interface AuthContext {
  userId: number; email: string | null; name: string | null;
  role: Role;                // GLOBAL per orang (keputusan owner #1)
  assignments: Assignment[]; // [] untuk super_admin
}
```

```ts
// scope-rule.ts — satu-satunya aturan visibilitas, tetap murni
export function unitVisible(ctx: ScopeCtx, unit: { unit_id: number; tenant_id: string | null }) {
  if (ctx.role === "super_admin") return true;
  if (unit.tenant_id === null) return false;                       // redundansi murah
  return ctx.assignments.some(
    (a) => a.tenantId === unit.tenant_id && (a.allUnits || a.unitIds.includes(unit.unit_id)),
  );
}
```

**Fail-closed bila invarian role dilanggar** (mis. FK di-drop lalu ditulis manual):
`getAuthContext` mengambil `DISTINCT role`; bila >1, **role paling restriktif yang
menang** — urutan `pengawas < direksi < admin_perusahaan < super_admin` — dan
kejadiannya di-`console.error` (log Cloud Run), **tanpa** menulis ke DB di jalur baca.
Karena Cloud Logging tidak dipantau siapa pun di proyek ini, sinyal yang bisa dilihat
manusia ditambahkan **tanpa menulis apa pun**: banner peringatan di `/admin` (query
`HAVING count(DISTINCT role) > 1`, ber-scope tenant untuk admin terdelegasi).

Pilihan "paling restriktif" mengalahkan "tolak sama sekali" karena keduanya
fail-closed, tetapi hanya yang pertama **tidak menciptakan pemadaman sendiri** dari
satu baris data yang rusak. Dalam model baru, role sudah **tidak** menentukan luas
unit (itu tugas `all_units`), jadi menurunkan role hanya mencabut kemampuan admin —
persis pembacaan least-privilege. Jalur ini **diuji** (§6, T-FC1/T-FC2).

**Properti yang wajib bertahan:** `getAuthContext()` tetap membaca DB tiap request
(tanpa `cache()`, tanpa JWT) → pencabutan berlaku pada request berikutnya, tanpa
logout. Diuji eksplisit (§6, T-REV).

---

## 3. Kompatibilitas mundur — mengapa 12 membership TIDAK bergeser

Aturan lama: `pengawas` → `user_unit`; role lain → semua unit tenant.
Aturan baru: `all_units=true` → semua unit tenant; `all_units=false` → `user_unit`.
Backfill `all_units = (role <> 'pengawas')` memetakan yang satu ke yang lain **tepat**.

| # | Email | role | tenant | unit efektif (sebelum = sesudah) | mengapa tidak bergeser |
|---|---|---|---|---|---|
| 1 | babanzana610@gmail.com | admin_perusahaan | abadi | 6478111, 6378301 | `all_units=true` → semua unit abadi = 2 unit, sama seperti sebelumnya |
| 2 | damiandionsalam@gmail.com | super_admin | (global) | ketujuhnya | cabang `super_admin` di `unitVisible` tak tersentuh perubahan |
| 3 | ddsalam@solagas.com | direksi | abadi | 6478111, 6378301 | idem #1 |
| 4 | thhendrasalam@gmail.com | direksi | abadi | 6478111, 6378301 | idem #1 |
| 5 | spbuimambonjolpontianak@gmail.com | pengawas | abadi | 6478111 | `all_units=false`, `user_unit` tak diubah (hanya ditambah `tenant_id` turunan) |
| 6 | pengawas.spbubakau@gmail.com | pengawas | abadi | 6378301 | idem #5 |
| 7 | spbu6378301sbbl@solagroup.co | pengawas | abadi | 6378301 | idem #5 |
| 8 | sola.adis.raya@solagroup.co | pengawas | adis-raya | 6478101 | idem #5 |
| 9 | merita.abadisukses@solagroup.co | pengawas | merita | 6478106 | idem #5 |
| 10 | spbu6478201bl@solagroup.co | pengawas | batu-layang | 6478201 | idem #5 |
| 11 | spbu6478311milop@solagroup.co | pengawas | milop | 6478311 | idem #5 |
| 12 | solapetraenergi@gmail.com | pengawas | energi | 63781002 | idem #5 |

`app.user_role` di-backfill dari `SELECT user_id, min(role) … GROUP BY user_id` —
di live tiap user punya tepat 1 membership, jadi `min()` = role satu-satunya.
Migrasi **menambahkan** guard `HAVING count(DISTINCT role) = 1` yang `RAISE
EXCEPTION` bila asumsi itu meleset saat migrasi dijalankan (fail-fast, bukan diam).

**Pembalikan makna himpunan kosong TIDAK terjadi**, dan itu diuji dua arah:
(i) migrasi menetapkan `all_units=false` untuk **setiap** pengawas — termasuk yang
`user_unit`-nya kosong (nol di live hari ini, tetapi aturannya yang diuji, bukan
datanya); (ii) tes T-EMPTY (§6) menuntut `all_units=false` + `unitIds=[]` → **nol**
unit terlihat; (iii) kontrol mutasi M2 (§6) membuktikan suite memerah bila
`unitIds=[]` ditafsirkan "semua".

---

## 4. Admin terdelegasi (`admin_perusahaan`)

> **Direvisi di GATE 2 (keputusan owner).** Versi GATE 1 mengizinkan admin
> terdelegasi menambah pengguna baru lewat input email-persis, dengan orakel
> keberadaan akun sebagai risiko sisa. Owner memilih opsi lain: **pemberian akses ke
> orang BARU adalah wewenang `super_admin` saja**, sehingga orakel itu hilang di
> akarnya — bukan didokumentasikan. §4.3 lama (daftar/pencarian pengguna) DIHAPUS.

### 4.1 Wewenang

| | super_admin | admin_perusahaan |
|---|---|---|
| Membuat membership (orang baru) | ✅ | ❌ |
| Hard-delete membership | ✅ | ❌ (pakai suspend) |
| Ubah cakupan unit (`all_units` ↔ daftar) | ✅ | ✅ di tenantnya |
| Suspend / aktifkan (`status`) | ✅ | ✅ di tenantnya |
| Ubah role | ✅ | ✅ di tenantnya, **tunduk A3** |
| Baca audit log | semua | tenantnya saja |
| Daftar/pencarian pengguna | ✅ | ❌ (tidak dirender sama sekali) |

Kenapa admin terdelegasi boleh suspend tapi tidak hard-delete: kalau ia bisa
**memusnahkan** baris tanpa bisa **membuatnya**, ia bisa menghancurkan akses yang tak
bisa ia pulihkan sendiri. Itu jebakan operasional, bukan kontrol keamanan.

`app.users` bukan tabel ber-unit, jadi RLS 0016 maupun `unitVisible` **tidak**
menjaganya; merender daftarnya untuk admin terdelegasi = membocorkan direktori
pengguna keenam PT lain. Karena pemberian akses ke orang baru kini milik super_admin,
daftar itu **tidak pernah dirender** untuk admin terdelegasi
([`admin/page.tsx`](../apps/dashboard/src/app/(app)/admin/page.tsx) — query `app.users`
dijalankan hanya bila `isSuper`).

### 4.2 Lima aturan keras (masing-masing punya tes negatif)

Semuanya berupa fungsi MURNI di
[`admin-rules.ts`](../apps/dashboard/src/lib/admin-rules.ts); aksi server hanya
memanggilnya, tidak menyalin logikanya.

- **A1** Tenant yang boleh disentuh = tenant penugasan si admin (`canTouchTenant`).
- **A2** Tak pernah memberi **atau** mencabut `super_admin`; `admin_perusahaan` hanya
  bisa diberikan `super_admin` (`assignableRoles`, `checkTouchMembership`).
- **A3** Boleh mengubah role target **hanya bila** `{tenant SEMUA membership target} ⊆
  {tenant si admin}` (`canChangeRole`). **Alasannya tetap berlaku setelah keputusan
  #2**: role bersifat global, jadi seseorang yang punya membership di dua PT akan ikut
  naik rolenya di PT yang bukan milik si admin. Yang berubah hanyalah cakupan A3 — ia
  kini mengatur **perubahan role orang yang sudah ada**, bukan pengangkatan orang baru.
- **A4** Tak pernah menyentuh membership/role **dirinya sendiri**.
- **A5** Setiap aksi tercatat di `audit_log` dgn `actor_*` = si admin dan `tenant_id`
  yang disentuh.

## 5. Urutan deploy — dan sebuah bahaya struktural di CD hari ini

### 5.1 Bahaya: dua workflow, tanpa urutan

`deploy-dashboard.yml:12-18` ter-trigger oleh `apps/dashboard/**`;
`deploy-backend.yml:17-26` oleh `apps/backend/**` — dan **hanya backend yang
menjalankan migrasi**. Perubahan arc ini menyentuh **keduanya**. Keduanya digerbang
Environment `pilot`, **dua tombol approve terpisah, tanpa `needs:` antar-workflow**.

- **image baru + skema lama** = `SELECT … all_units …` gagal → **setiap request 500**
  untuk 23 sesi hidup. Pemadaman total.
- **skema baru + image lama** = aman untuk **baca** (image lama tak menyebut kolom
  baru); satu-satunya yang patah adalah `INSERT INTO app.user_unit (membership_id,
  unit_id)` di `admin-actions.ts:50` — dan trigger §1.5 menutupnya sehingga **tidak
  ada fungsi yang hilang sama sekali**.

Asimetri itu menentukan urutannya. Prinsip pembedanya, agar tidak keliru lagi seperti
inversi `0016`: **migrasi dulu bila skema baru adalah superset yang diabaikan image
lama; image dulu bila migrasi MENGAKTIFKAN penegakan yang image lama tak bisa penuhi**
(`0016` kasus kedua — RLS menuntut konteks yang hanya di-set image baru). Arc ini
kasus pertama.

### 5.2 Prosedur: dua promosi terpisah

| Langkah | Isi PR | Workflow yang jalan | Keadaan antara |
|---|---|---|---|
| P1 | **migrasi saja** (`apps/backend/prisma/migrations/0019_*`, `scripts/`) | backend saja (path filter menjaga dashboard diam) | skema baru + image lama — **aman** (§5.1) |
| P2 | **kode dashboard + tes** (`apps/dashboard/**`) | dashboard saja | skema baru + image baru |

**🔴 SYARAT WAJIB P1 (kalau dilanggar, seluruh §5 batal):** PR P1 **tidak boleh
menyentuh `packages/shared/**` maupun `pnpm-lock.yaml`**. Keduanya ada di path-filter
**kedua** workflow ([`deploy-dashboard.yml:13-17`](../.github/workflows/deploy-dashboard.yml),
[`deploy-backend.yml:20-26`](../.github/workflows/deploy-backend.yml)), jadi satu baris
lockfile di PR migrasi akan menyalakan pipeline dashboard juga — dan skenario "image
baru bertemu skema lama" yang seluruh §5 dirancang untuk mencegah menjadi mungkin
lagi. Perlakukan sebagai kondisi GAGAL PR, bukan catatan.

**🔴 Di tier `staging` disiplin ini HANYA dijaga cara kerja, bukan infrastruktur.**
Push ke `staging` men-deploy **otomatis tanpa reviewer**
([`deploy-dashboard.yml:4`](../.github/workflows/deploy-dashboard.yml),
[`deploy-backend.yml:4`](../.github/workflows/deploy-backend.yml)). Di `main` ada dua
tombol approve terpisah sehingga owner bisa mengurutkan P1→P2 secara manual; di
`staging` tidak ada yang menahan. Jadi P1 dan P2 **tidak boleh mendarat di `staging`
berdekatan**: tunggu migrasi `-rlsstg` selesai dan terverifikasi sebelum P2 di-merge.

Gerbang `pilot` sendiri sudah terverifikasi nyata (dibuat 2026-07-16,
`required_reviewers: ddsalam`). Catatan yang tetap berlaku: `can_admins_bypass: true`
dan `prevent_self_review: false` — jadi ia **jeda sadar milik operator tunggal**, cukup
untuk mengurutkan P1/P2, **tidak** cukup sebagai pemisahan tugas.

Tidak ada satu titik pun di mana image baru bertemu skema lama.

### 5.3 Rollback

`apps/backend/scripts/rbac-scope-rollback.sql` (pola `rls-rollback.sql`: idempoten,
dijalankan sebagai `ingest`). Urutannya **kebalikan** deploy: **revert image dulu**
(`gcloud run services update-traffic --to-revisions=<revisi-lama>=100`), **baru** DDL
rollback — karena image baru tidak bisa hidup tanpa `all_units`.

```sql
BEGIN;
ALTER TABLE app.user_unit  DROP CONSTRAINT IF EXISTS user_unit_membership_tenant_fkey;
ALTER TABLE app.user_unit  DROP CONSTRAINT IF EXISTS user_unit_unit_tenant_fkey;
ALTER TABLE app.user_unit  ADD  CONSTRAINT user_unit_membership_id_fkey
  FOREIGN KEY (membership_id) REFERENCES app.membership(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE app.user_unit  ADD  CONSTRAINT user_unit_unit_id_fkey
  FOREIGN KEY (unit_id) REFERENCES public.unit(unit_id) ON UPDATE CASCADE ON DELETE CASCADE;
DROP TRIGGER  IF EXISTS user_unit_fill_tenant ON app.user_unit;
DROP FUNCTION IF EXISTS app.user_unit_fill_tenant();
ALTER TABLE app.user_unit  DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE app.membership DROP CONSTRAINT IF EXISTS membership_user_id_role_fkey;
ALTER TABLE app.membership DROP CONSTRAINT IF EXISTS membership_id_tenant_id_key;
ALTER TABLE app.membership DROP CONSTRAINT IF EXISTS membership_user_id_tenant_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS membership_user_id_tenant_id_key
  ON app.membership (user_id, tenant_id);                 -- bentuk lama (NULLS DISTINCT)
ALTER TABLE app.membership DROP COLUMN IF EXISTS all_units;
DROP TABLE IF EXISTS app.user_role;
ALTER TABLE public.unit DROP CONSTRAINT IF EXISTS unit_unit_id_tenant_id_key;
ALTER TABLE public.unit ALTER COLUMN tenant_id DROP NOT NULL;
-- audit_log.tenant_id SENGAJA TIDAK di-drop: append-only, kolom tambahan tak merusak image lama.
COMMIT;
```

Naskah ini **wajib dijalankan-dan-diuji di `-rlsstg`** pada GATE 2 (pasang → uji →
rollback → pasang lagi), bukan sekadar ditulis.

---

## 6. Daftar tes yang akan ditulis

**Unit (murni, jalan di tiap `pnpm check`) — `scope.test.ts`**
- T-UNION: satu orang, dua assignment di dua PT → melihat **tepat** gabungannya, nol selebihnya.
- T-ALL: `all_units=true` di PT A → semua unit A; **nol** unit B.
- T-SUBSET: `direksi` dengan `all_units=false` + `unitIds=[Bakau]` → IB **tidak** terlihat (keputusan #3).
- T-EMPTY: `all_units=false`, `unitIds=[]` → nol unit (himpunan kosong = DENY).
- T-NEWUNIT: unit ke-8 disuntikkan ke PT A → assignment `all_units` **melihatnya**; assignment berdaftar **tidak**. Inilah beda dua semantik itu, diuji, bukan dijanjikan.
- T-FC1/T-FC2: role campur → paling restriktif menang (bukan paling tinggi), dan bukan lockout.

**Integrasi DB (`SCOPE_LIVE_DB=1`, guard absen wajib `return ctx.skip()`)**
- T-DB1 `user_unit` lintas-tenant (tenant unit) → **ditolak** FK membership.
- T-DB2 `user_unit` lintas-tenant (tenant dipalsukan) → **ditolak** FK unit.
- T-DB3 membership kedua ber-role beda → **ditolak** FK `user_role`.
- T-DB4 membership kedua ber-role sama, tenant lain → **diterima**.
- T-DB5 `super_admin` duplikat → **ditolak** (`NULLS NOT DISTINCT`).
- T-DB6 `user_unit` pada membership `super_admin` (tenant NULL) → **ditolak**.
- T-REV: cabut satu assignment → `getAuthContext` request berikutnya kehilangan unit itu **tanpa logout** (membuktikan scope tidak pindah ke JWT).
- T-CFG: untuk **setiap** unit di DB, `tenant.name` == `UNIT_DISPLAY[code].pt` (temuan ⑦).

**Admin terdelegasi (negatif, semuanya wajib merah bila aturan dilonggarkan)**
- A1-neg grant ke tenant lain · A2-neg beri/cabut `super_admin`, beri `admin_perusahaan`
- A3-neg ubah role target yang punya membership di luar tenant admin
- A4-neg sentuh diri sendiri · A5 audit tercatat dgn `tenant_id` benar
- B-neg daftar pengguna admin terdelegasi **tidak** memuat pengguna PT lain.

**Pembaca audit**
- AU1 `admin_perusahaan` hanya melihat baris tenant-nya · AU2 baris `tenant_id IS NULL` hanya untuk `super_admin` · AU3 `dashboard_app` tetap ditolak `UPDATE`/`DELETE`.

**Kontrol non-vacuity (mutasi — suite HARUS memerah)**
- M1 `unitVisible`: `some(...)` → `some(a => a.allUnits || …)` tanpa cek `tenantId` ⇒ T-UNION/T-ALL merah.
- M2 `unitIds.length === 0` ditafsirkan "semua" ⇒ T-EMPTY merah.
- M3 backfill `all_units = true` untuk semua ⇒ T-SUBSET + diff GATE 3 merah.
- M4 role fail-closed diubah jadi "paling tinggi menang" ⇒ T-FC1 merah.
- M5 satu unit dipindahkan ke tenant salah di DB rehearsal ⇒ T-CFG + isolasi merah (pola 28 Oktober), lalu dipulihkan.

**Konversi 8 berkas `scope.*.integration.test.ts`** ke bentuk `assignments[]` bersifat
mekanis; asersinya **tidak** dilonggarkan, dan hasil sebelum/sesudah konversi
dibandingkan baris-per-baris di laporan GATE 2.

---

## 7. Bukti yang sudah dikumpulkan di GATE 1

Seluruhnya di **`-rlsstg`** (`system_identifier 7659054651798528016`, di-assert di
dalam transaksi), sebagai role **`ingest`** (pemilik tabel, `pg_tables.tableowner`),
**semuanya ROLLBACK**. Satu koneksi LIVE dibuka ~1 menit untuk 3 query read-only lalu
**dibongkar** (§7.4).

### 7.1 Potongan `app` berjalan penuh + enam uji perilaku

```
T1 OK  role campur ditolak → … violates foreign key …            (invarian satu-role)
T2 OK  multi-tenant role-sama DITERIMA                            (D1)
T3 OK  super_admin duplikat ditolak → duplicate key … "membership_u…"   (D5)
T4 OK  tenant palsu ditolak → … violates foreign key …            (D4, sisi membership)
T5 OK  user_unit pada super_admin ditolak → … foreign key …
T6 OK  cascade role → semua membership user 1 = admin_perusahaan: t
BACKFILL all_units:  admin_perusahaan|t|2   pengawas|f|4   super_admin|t|1
user_unit ter-backfill: 4/4 baris  tenant_cocok = t
ROLLBACK
```

### 7.2 FK komposit sisi-unit (model TEMP — lihat §7.3)

```
U1 OK  unit SE-TENANT diterima
U2 OK  ditolak → … violates foreign key …   (tenant unit → FK membership menolak)
U3 OK  ditolak → … violates foreign key …   (tenant membership → FK unit menolak)
```

### 7.3 🔴 Blokade privilege — `ingest` tak bisa membuat objek di schema `public` **di `-rlsstg`**

```
ALTER TABLE public.unit ALTER COLUMN tenant_id SET NOT NULL;      → ALTER TABLE   ✓
ALTER TABLE public.unit ADD CONSTRAINT probe_uk UNIQUE (…);       → ERROR: permission denied for schema public
```
```
-rlsstg: has_schema_privilege('ingest','public','CREATE') = f   ← BLOKIR
live   : has_schema_privilege('ingest','public','CREATE') = t   ← lolos
```

`ingest` **memiliki** semua tabel `public` di kedua instance, tetapi hanya punya
`USAGE` pada schema `public` di `-rlsstg`. `ADD CONSTRAINT … UNIQUE` membuat index →
butuh `CREATE` pada schema. Migrasi era-CD satu-satunya (`0018`) sengaja tanpa DDL,
jadi **jalur CD belum pernah benar-benar membuat objek di `public`** — drift ini tak
pernah terlihat.

**Prasyarat GATE 2 (butuh tindakan owner, satu baris, hanya di `-rlsstg`):**

```sql
-- sebagai postgres di solamax-pg-rlsstg — menyamakan dgn live
GRANT CREATE ON SCHEMA public TO ingest;
```

Tanpa ini, migrasi `0019` gagal di tier testing (yang justru **benar** — CD-nya
fail-fast sebelum menyentuh live). Tidak ada perubahan privilege di live.

### 7.4 Bacaan LIVE (proxy :5442, dibuka lalu dimatikan)

- `system_identifier = 7650126488674766864` ✓
- `unit tanpa tenant = 0` → `SET NOT NULL` aman
- `has_schema_privilege('ingest','public','CREATE') = t`
- 11 baris `audit_log`: 10 `grant_access` membawa `detail->>'tenant_id'`; 1
  `revoke_access` (membership `b416d845…`) dipulihkan dari grant-nya (`69ff5f8c…`,
  tenant `80885713…`). Backfill **11/11**.

---

## 8. Yang tidak sesuai harapan (dilaporkan, tidak ditindaklanjuti sendiri)

1. **Privilege `ingest` berbeda antara live dan `-rlsstg`** (§7.3). Butuh satu GRANT
   dari owner di `-rlsstg` sebelum GATE 2 bisa dijalankan sungguhan.
2. **CD tidak punya urutan antar-workflow** (§5.1). Bukan cacat yang saya perkenalkan,
   tetapi arc ini adalah perubahan pertama yang menyentuh dashboard **dan** migrasi
   sekaligus, jadi ia yang pertama terekspos. Ditutup dengan dua promosi terpisah.
3. **Keputusan #1 (role global) bertabrakan dengan admin terdelegasi** (§4.1).
   Ditutup aturan A3; owner perlu tahu bahwa menaikkan role seseorang berdampak di
   semua PT tempat ia punya membership.
4. **Direktori pengguna punya risiko sisa** (§4.3) — orakel keberadaan akun lewat
   email-persis. Saya nyatakan alih-alih menutupinya; menghilangkannya butuh cakupan
   tambahan.

## 9. Yang TIDAK dikerjakan arc ini

Nol grant baru. Nol pelebaran akses. Skenario `thhendrasalam@gmail.com` dan
`ddsalam@solagas.com` diperluas ke PT lain hanya dipakai sebagai **skenario uji UI**
(dua-tiga klik: pilih pengguna → tambah penugasan → pilih PT → "semua unit PT ini" /
daftar unit → simpan; audit tercatat atas nama owner). Eksekusinya milik owner,
setelah deploy.
