# ⚠️ Kata "backstop" di `migration.sql` MELEBIHKAN apa yang lapis ini lakukan

`migration.sql` baris 1 menyebut lapis ini **"Row-Level Security backstop"**, dan
kata itu dipakai orang untuk menalar soal keamanan. Ia melebihkan.

Berkas migrasinya **sengaja TIDAK disunting** — menyuntingnya mengubah checksum
dan menghentikan `prisma migrate deploy` (pelajaran terkunci; preseden
[`0013_recap_saldo_tables/CORRECTION.md`](../0013_recap_saldo_tables/CORRECTION.md)).
Koreksinya di sini.

## Rumusan yang benar

```
RLS di sini melindungi dari query yang LUPA men-scope
  (tanpa konteks `app.unit_ids` → fail-closed, NOL baris).

RLS di sini TIDAK melindungi dari pemanggil yang menyerahkan
  scope yang SALAH.
```

## Kenapa — dan ini struktural, bukan bug

`qScoped()` ([`apps/dashboard/src/lib/db.ts`](../../../../dashboard/src/lib/db.ts))
menurunkan GUC `app.unit_ids` dari **argumen pertamanya**, dan hampir setiap
query di `queries.ts` menyerahkan **nilai yang sama** ke GUC dan ke parameter
SQL-nya. Scope yang dilebarkan karena itu **melebarkan RLS juga** — RLS tak punya
sumber kebenaran independen tentang siapa pemanggilnya.

Yang menjaga terhadap scope-salah adalah brand **`ScopedUnitId`**
([`scope-rule.ts`](../../../../dashboard/src/lib/scope-rule.ts)), yang **hanya**
bisa dicetak `getDataScope()` — **seluruhnya di lapis TIPE, bukan lapis DB**.

## Bukti empiris

`rls-surfaces.integration.test.ts`:

- **`unitIds DILEBARKAN`** — `getAdminDays([UA, UB])` mengembalikan data KEDUA
  unit. Tes versi pertama menuntut data UB nol dan **GAGAL**; premisnya yang
  salah, bukan kodenya.
- **`BACKSTOP RLS: GUC lebih SEMPIT dari parameter`** — di sinilah RLS benar-benar
  menggigit: GUC `[UA]` + parameter `[UA, UB]` → baris UB **ditolak**. Ini satu-
  satunya bentuk perlindungan yang lapis DB berikan, dan ia menuntut probe SQL
  langsung untuk diuji karena fungsi produksi sengaja tak mengizinkan GUC dan
  parameter berbeda.

## Yang tetap benar dari klaim lama

Fail-closed terverifikasi (tanpa konteks → 0 baris), `WITH CHECK` menolak tulis
lintas-unit, tak ada role ber-`BYPASSRLS`. Semua itu berlaku. Yang dikoreksi
hanya **NAMA penjaganya** — dan nama yang salah membuat orang menalar keamanan
dari properti yang tak dimiliki lapis ini.

Dikoreksi 2026-08-07.
