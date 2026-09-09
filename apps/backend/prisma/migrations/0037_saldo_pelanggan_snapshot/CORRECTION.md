# ⚠️ Constraint `row_count` untuk manifest lengkap dikoreksi oleh `0038`

`migration.sql` pada direktori ini sengaja **tidak disunting**. Migrasi `0037`
sudah diterapkan di `solamax-pg-rlsstg`, dan `prisma migrate deploy` menjaga
checksum berkas yang sudah tercatat. Satu perubahan byte pada berkas tersebut
akan menghentikan jalur deploy.

## Lubang pada constraint asli

Cabang `status = 'complete'` di `sps_manifest_lifecycle_valid` memuat:

```sql
"customer_key_count" IS NOT NULL AND
"row_count" = "customer_key_count" AND
```

Ia tidak memuat `"row_count" IS NOT NULL`. Di PostgreSQL, perbandingan
`NULL = nilai` menghasilkan `UNKNOWN`, sedangkan `CHECK` hanya menolak hasil
`FALSE`. Akibatnya manifest `complete` dengan `row_count = NULL` dapat lolos,
meskipun semua bukti lengkap lain terisi. Itu melemahkan invariant bahwa
snapshot kosong harus dibedakan dari snapshot yang belum siap.

## Sumber kebenaran

Migrasi `0038_snapshot_manifest_row_count` menambahkan constraint aditif:

```sql
CHECK ("status" <> 'complete' OR "row_count" IS NOT NULL)
```

Constraint asli tetap berguna untuk menyamakan `row_count` dengan
`customer_key_count`; constraint `0038` memastikan perbandingan itu tidak bisa
lolos melalui semantik NULL.

## Sapuan kelas yang sama

Seluruh constraint `0037` diperiksa terhadap nullability deklarasi kolom dan
setiap operand pada perbandingan `=`, `<>`, `<`, `>`, `<=`, dan `>=`.
Operand nullable lainnya sudah tertutup oleh salah satu dari tiga bentuk:

- guard eksplisit `IS NULL OR ...` atau `IS NOT NULL` pada cabang yang sama;
- deklarasi kolom `NOT NULL`;
- constraint pasangan yang berlaku bersamaan, misalnya
  `sps_change_invalidation_valid` mewajibkan `invalid_from_date IS NOT NULL`
  untuk perubahan ledger sebelum `sps_change_ledger_date_valid`
  membandingkannya dengan tanggal sumber.

Hasil sapuan: **`row_count` adalah satu-satunya operand nullable yang dapat
membuat cabang lifecycle diterima lewat hasil `UNKNOWN`.**
