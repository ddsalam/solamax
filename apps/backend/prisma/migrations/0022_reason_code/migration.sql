-- 0022_reason_code — master sebab-selisih, DAFTAR TERTUTUP.
-- Keputusan owner B2, 12 Agu 2026 (KEUANGAN-HARIAN.md §10.2). 19 kode:
-- 10 `closing` · 6 `adjustment` · 3 `reclass`.
--
-- Kenapa tertutup: teks bebas membuat pola berulang tak terlihat — sepuluh orang
-- menulis sepuluh kalimat berbeda untuk sebab yang sama, dan tak ada yang bisa
-- menghitungnya. Frekuensi per kode per unit per bulan adalah TEMUAN PROSES
-- (§10.2), dan itu hanya mungkin kalau kodenya terbatas.
--
-- ⛔ Ketertutupan ditegakkan di LAPIS HAK AKSES, bukan sekadar niat:
-- dashboard_app hanya diberi SELECT. Menambah kode = migrasi = keputusan owner.
-- Aplikasi TIDAK bisa menambah baris di sini betapapun inginnya.
--
-- Seed ikut di migrasi ini, BUKAN skrip terpisah: master kosong membuat setiap
-- gerbang yang bergantung padanya selalu lolos, dan skrip terpisah adalah skrip
-- yang bisa lupa dijalankan.
--
-- TANPA kolom unit_id ⇒ TANPA RLS, disengaja. Daftar sebab berlaku sama untuk
-- semua unit (B1 seragam); ia master rujukan, bukan data per-unit.
--
-- Idempoten / aman re-run.

CREATE TABLE IF NOT EXISTS "app"."reason_code" (
    "code"        TEXT NOT NULL,
    "label"       TEXT NOT NULL,
    "applies_to"  TEXT NOT NULL,
    -- Dipakai gerbang penutupan hari: kode yang menyalakan ini WAJIB disertai
    -- tanggal target. Lihat catatan penegakan di bawah.
    "requires_target_date" BOOLEAN NOT NULL DEFAULT false,
    "active"      BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "reason_code_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "reason_code_applies_to" CHECK (
        "applies_to" IN ('closing', 'adjustment', 'reclass')
    )
);

-- ---------------------------------------------------------------------------
-- ⚠️ PENEGAKAN "tanggal target wajib" untuk CLS-INVESTIGATING — BELUM LENGKAP,
--    dan itu disebut di sini supaya tidak terlewat.
--
-- Owner meminta CHECK di DB. CHECK itu harus hidup di tabel yang MENYIMPAN
-- tanggal targetnya, yaitu `app.day_close` — dan `day_close` sengaja DI LUAR
-- lingkup Tugas 2. Tidak ada tabel di lingkup ini yang memuat kolom tersebut,
-- jadi CHECK-nya belum bisa ditulis tanpa membangun day_close lebih dulu.
--
-- Yang BISA dilakukan sekarang, dan dilakukan: menyatakan kewajibannya sebagai
-- DATA (`requires_target_date`), sehingga day_close nanti tinggal menegakkan
--     CHECK (NOT <kode butuh target> OR target_date IS NOT NULL)
-- tanpa menghardcode 'CLS-INVESTIGATING' di sana.
--
-- KEWAJIBAN YANG DIBAWA: migrasi day_close WAJIB memuat CHECK itu. Tanpa ia,
-- `CLS-INVESTIGATING` berubah dari katup jujur menjadi tempat sampah — persis
-- yang §10.2 cegah, sebab eskalasi ke Direksi bersandar pada lewatnya tanggal
-- target, bukan pada ada yang melapor.
-- ---------------------------------------------------------------------------

INSERT INTO "app"."reason_code" ("code", "label", "applies_to", "requires_target_date") VALUES
    ('CLS-ROUND',         'Pembulatan setoran',                     'closing',    false),
    ('CLS-CASH',          'Selisih kas fisik',                      'closing',    false),
    ('CLS-EDC-TIMING',    'EDC belum settle',                       'closing',    false),
    ('CLS-EDC-MDR',       'Potongan MDR belum dibukukan',           'closing',    false),
    ('CLS-BANK-TIMING',   'Mutasi bank beda hari',                  'closing',    false),
    ('CLS-PURCH-PENDING', 'Pembelian BBM belum diposting',          'closing',    false),
    ('CLS-PRICE-PENDING', 'Harga beli belum diperbarui',            'closing',    false),
    ('CLS-AR-PENDING',    'Pembayaran pelanggan belum diposting',   'closing',    false),
    ('CLS-DO-PENDING',    'Penerimaan/penebusan belum diinput',     'closing',    false),
    ('CLS-INVESTIGATING', 'Sedang ditelusuri',                      'closing',    true),
    ('ADJ-AMOUNT',        'Nominal salah',                          'adjustment', false),
    ('ADJ-DATE',          'Tanggal salah',                          'adjustment', false),
    ('ADJ-DUP',           'Entri ganda (dibalik)',                  'adjustment', false),
    ('ADJ-MISSING',       'Transaksi terlewat',                     'adjustment', false),
    ('ADJ-PARTY',         'Salah pelanggan/akun lawan',             'adjustment', false),
    ('ADJ-LEGACY',        'Jurnal rekonsiliasi legacy (Direksi)',   'adjustment', false),
    ('RCL-NATURE',        'Sifat pengeluaran berbeda',              'reclass',    false),
    ('RCL-SPLIT',         'Mestinya terbagi dua akun',              'reclass',    false),
    ('RCL-MAPDEF',        'Pemetaan default keliru',                'reclass',    false)
ON CONFLICT ("code") DO NOTHING;

-- HANYA SELECT. Tanpa INSERT/UPDATE/DELETE — inilah yang membuat daftarnya
-- benar-benar tertutup, bukan sekadar disebut tertutup.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT ON "app"."reason_code" TO dashboard_app;
    REVOKE INSERT, UPDATE, DELETE ON "app"."reason_code" FROM dashboard_app;
  END IF;
END
$$;
