-- 0029_cash_ledger — buku kas & buku bank: tiga tabel yang menghidupkan
-- Cash Flow, Cash on Hand, dan karenanya Balance Sheet utuh.
--
-- Rujukan keputusan: KEUANGAN-HARIAN.md §1.3 (tujuh akun kas) dan §1.4 (yang
-- tidak punya sumber otomatis — modul kas EasyMax `tr_hkasbank` DORMAN sejak
-- 2019, jadi seluruh isi buku ini adalah INPUT).
--
--   app.cash_account           — 7 akun kas, DATA bukan enum
--   app.cash_mutation_category — kategori debet/kredit, daftar TERTUTUP
--   app.cash_ledger            — mutasi; SALDO TIDAK DISIMPAN
--
-- ⛔ TIGA KEPUTUSAN YANG MENGIKAT:
--
-- 1. **Akun adalah DATA, bukan enum.** Rekening bisa bertambah dan bisa ditutup —
--    empat dari lima rekening bank Bakau sudah dorman 2–5 tahun (§7.7). Enum
--    memaksa migrasi setiap kali rekening berubah, dan migrasi yang dipaksa
--    biasanya berakhir sebagai nilai yang dipakai ulang untuk hal lain.
--    Penutupan diwakili `active=false` + `closed_at`, **tidak dengan DELETE**:
--    mutasi lama harus tetap menunjuk akun yang benar.
--
-- 2. **SALDO ADALAH TURUNAN, BUKAN KOLOM.** Workbook menyimpan `Saldo Akhir` di
--    setiap baris, dan itulah sebabnya satu sisipan di tengah mendiamkan seluruh
--    kolom di bawahnya — angka lama tetap terlihat benar sampai ada yang
--    menjumlah ulang. Di sini saldo dihitung dari mutasi, dan tabel ini SENGAJA
--    tidak punya kolom saldo. Ada tes yang memerah bila kolom itu muncul.
--
-- 3. **Nominal BERTANDA**, mengikuti workbook: debet positif, kredit negatif.
--    Dengan begitu saldo = `SUM(amount)` — satu operasi, tanpa cabang, tanpa
--    kesempatan salah tanda di tempat lain. Ditegakkan CHECK terhadap `jenis`.
--
-- Idempoten / aman re-run.

-- ---------------------------------------------------------------------------
-- 1. Akun kas
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'cash_account_kind' AND n.nspname = 'app'
  ) THEN
    CREATE TYPE "app"."cash_account_kind" AS ENUM ('kas', 'bank', 'edc_penampungan');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'cash_mutation_side' AND n.nspname = 'app'
  ) THEN
    CREATE TYPE "app"."cash_mutation_side" AS ENUM ('debet', 'kredit');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'cash_mutation_jenis' AND n.nspname = 'app'
  ) THEN
    CREATE TYPE "app"."cash_mutation_jenis" AS ENUM ('debet', 'kredit', 'adjustment');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "app"."cash_account" (
    "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"   SMALLINT NOT NULL,
    "nama"      TEXT NOT NULL,
    "kind"      "app"."cash_account_kind" NOT NULL,
    "active"    BOOLEAN NOT NULL DEFAULT true,
    "opened_at" DATE,
    "closed_at" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_account_pkey" PRIMARY KEY ("id"),
    -- Akun tertutup wajib menyebut kapan; akun aktif tak boleh punya tanggal
    -- tutup. Tanpa ini "sudah ditutup" jadi kabar burung, bukan tanggal.
    CONSTRAINT "cash_account_closed_pair" CHECK ("active" = ("closed_at" IS NULL)),
    CONSTRAINT "cash_account_urutan_tanggal" CHECK (
        "opened_at" IS NULL OR "closed_at" IS NULL OR "closed_at" >= "opened_at"
    )
);

-- Nama akun unik per unit — dua "Bank BRI" di satu unit membuat setiap mutasi
-- ambigu, dan ambiguitas itu baru terasa saat saldonya tak cocok.
CREATE UNIQUE INDEX IF NOT EXISTS "cash_account_nama_uq"
    ON "app"."cash_account"("unit_id", "nama");
-- Target FK dari cash_ledger: mengunci mutasi ke akun milik unit yang SAMA.
-- Idiom komposit 0019 — tanpa ini, mutasi unit A bisa menunjuk akun unit B dan
-- RLS pada ledger tidak akan menangkapnya (unit_id barisnya sendiri benar).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_account_unit_uq') THEN
    ALTER TABLE "app"."cash_account" ADD CONSTRAINT "cash_account_unit_uq" UNIQUE ("id", "unit_id");
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Kategori mutasi — daftar TERTUTUP, disiplin sama dengan reason_code (0022)
--
-- Sumber: workbook `List!Q` (Kategori Mutasi Debet, 7) dan `List!S` (Kategori
-- Jenis mutasi Kredit di Bank, 8). Tiga label muncul di KEDUA sisi (Pindah Buku,
-- Hutang Piutang, Temporary Investment) — karena itu kunci alaminya (side, label),
-- bukan label saja. TIDAK ada kode buatan: mengarang kode berarti memutuskan
-- penamaan yang belum diputuskan siapa pun.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."cash_mutation_category" (
    "side"   "app"."cash_mutation_side" NOT NULL,
    "label"  TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cash_mutation_category_pkey" PRIMARY KEY ("side", "label")
);

INSERT INTO "app"."cash_mutation_category" ("side", "label") VALUES
    ('debet',  'Setoran Hasil Penjualan'),
    ('debet',  'Pendapatan Lain-Lain'),
    ('debet',  'Tambahan Modal'),
    ('debet',  'Transfer Pembayaran Piutang Pelanggan'),
    ('debet',  'Pindah Buku'),
    ('debet',  'Hutang Piutang'),
    ('debet',  'Temporary Investment'),
    ('kredit', 'Biaya Operasional'),
    ('kredit', 'Pembelian BBM'),
    ('kredit', 'Pindah Buku'),
    ('kredit', 'Hutang Piutang'),
    ('kredit', 'Kontribusi ke Pusat'),
    ('kredit', 'Temporary Investment'),
    ('kredit', 'Management Fee'),
    ('kredit', 'Setoran ke Bank')
ON CONFLICT ("side", "label") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Ledger mutasi
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."cash_ledger" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"       SMALLINT NOT NULL,
    "account_id"    UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "keterangan"    TEXT NOT NULL,

    "jenis"         "app"."cash_mutation_jenis" NOT NULL,
    -- Sisi kategori; NULL untuk `adjustment` (mis. baris "Saldo Awal").
    "category_side"  "app"."cash_mutation_side",
    "category_label" TEXT,

    -- BERTANDA: debet > 0, kredit < 0 (lihat keputusan 3 di kepala berkas).
    "amount"        DECIMAL(17,2) NOT NULL,

    "void"          BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_by_user_id" INTEGER,
    "voided_at"     TIMESTAMPTZ,

    CONSTRAINT "cash_ledger_pkey" PRIMARY KEY ("id"),

    -- Mutasi HARUS menunjuk akun milik unit yang sama (FK komposit, idiom 0019).
    CONSTRAINT "cash_ledger_account_fk" FOREIGN KEY ("account_id", "unit_id")
        REFERENCES "app"."cash_account"("id", "unit_id"),

    -- Kategori dari daftar tertutup; sisinya WAJIB cocok dengan jenis mutasinya.
    CONSTRAINT "cash_ledger_category_fk" FOREIGN KEY ("category_side", "category_label")
        REFERENCES "app"."cash_mutation_category"("side", "label"),
    CONSTRAINT "cash_ledger_category_pair" CHECK (
        ("category_side" IS NULL) = ("category_label" IS NULL)
    ),
    -- ⛔ Debet tak boleh berkategori kredit dan sebaliknya. Tanpa ini, "Pembelian
    -- BBM" (kredit) bisa dipasang pada mutasi debet dan laporan kategori jadi
    -- bohong tanpa satu pun angka terlihat salah.
    CONSTRAINT "cash_ledger_jenis_vs_category" CHECK (
        ("jenis" = 'adjustment' AND "category_side" IS NULL)
        OR ("jenis" = 'debet'  AND "category_side" = 'debet')
        OR ("jenis" = 'kredit' AND "category_side" = 'kredit')
    ),

    -- Tanda nominal mengikuti jenis. `adjustment` bebas tanda (saldo awal bisa
    -- negatif), tetapi tidak boleh nol — mutasi nol bukan mutasi.
    CONSTRAINT "cash_ledger_tanda" CHECK (
        ("jenis" = 'debet'  AND "amount" > 0)
        OR ("jenis" = 'kredit' AND "amount" < 0)
        OR ("jenis" = 'adjustment' AND "amount" <> 0)
    ),

    CONSTRAINT "cash_ledger_keterangan_isi" CHECK (btrim("keterangan") <> ''),
    CONSTRAINT "cash_ledger_void_audit" CHECK (
        "void" = ("voided_at" IS NOT NULL) AND "void" = ("voided_by_user_id" IS NOT NULL)
    )
);

-- ⛔ TIDAK ADA KOLOM SALDO. Saldo = SUM(amount) atas mutasi non-void sampai
-- tanggal tertentu. Indeks ini yang membuat penjumlahan itu murah, sehingga
-- tak pernah ada alasan "menyimpan saldo biar cepat".
CREATE INDEX IF NOT EXISTS "cash_ledger_saldo_idx"
    ON "app"."cash_ledger"("unit_id", "account_id", "business_date")
    WHERE NOT "void";
CREATE INDEX IF NOT EXISTS "cash_ledger_kategori_idx"
    ON "app"."cash_ledger"("unit_id", "category_side", "category_label", "business_date")
    WHERE NOT "void";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."cash_account" TO dashboard_app;
    GRANT SELECT, INSERT, UPDATE ON "app"."cash_ledger"  TO dashboard_app;
    -- Kategori = master tertutup: dibaca, tidak ditulis aplikasi (pola 0022).
    GRANT SELECT ON "app"."cash_mutation_category" TO dashboard_app;
    REVOKE INSERT, UPDATE, DELETE ON "app"."cash_mutation_category" FROM dashboard_app;
    REVOKE DELETE ON "app"."cash_account" FROM dashboard_app;
    REVOKE DELETE ON "app"."cash_ledger"  FROM dashboard_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- RLS — cabang NULL DIPUTUSKAN SADAR: **TIDAK ADA** pada `cash_account` dan
-- `cash_ledger`; keduanya selalu milik satu unit (kolomnya NOT NULL), tidak ada
-- akun maupun mutasi yang berlaku global. Predikat disalin PERSIS dari 0016
-- (§4.1b).
--
-- `cash_mutation_category` TIDAK ber-`unit_id` ⇒ TIDAK ber-RLS, juga disengaja:
-- ia master rujukan yang sama untuk semua unit, seperti `reason_code`.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  ))$p$;
BEGIN
  FOREACH t IN ARRAY ARRAY['cash_account', 'cash_ledger'] LOOP
    EXECUTE format('ALTER TABLE "app".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "app".%I FORCE ROW LEVEL SECURITY',  t);
    EXECUTE format('DROP POLICY IF EXISTS unit_scope ON "app".%I',   t);
    EXECUTE format(
      'CREATE POLICY unit_scope ON "app".%I USING (%s) WITH CHECK (%s)',
      t, predicate, predicate
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Seed 7 akun kas BAKAU (unit_id 2) — persis §1.3.
--
-- Ini FAKTA dari workbook `Finance SPBU 6378301 BK`, bukan keputusan baru.
-- ⚠️ `active = true` untuk ketujuhnya, TERMASUK empat rekening bank yang bukti
-- T1 tunjukkan dorman 2–5 tahun (BCA-5125978301 sejak 2022-08, BRI 2021-11,
-- BNI 2021-09, Mandiri 2024-01). Menandainya `false` sekarang berarti MENJAWAB
-- §7.7 ("masih ada, sudah ditutup, atau perlu dihapusbukukan?") — pertanyaan
-- yang masih terbuka. Dorman ≠ ditutup, dan hanya tim keuangan yang boleh
-- memutuskan mana yang mana.
--
-- Unit lain: akun kasnya bagian dari onboarding per unit, bukan migrasi ini.
-- ---------------------------------------------------------------------------
INSERT INTO "app"."cash_account" ("unit_id", "nama", "kind") VALUES
    (2, 'Kas Besar',                'kas'),
    (2, 'EDC Penampungan',          'edc_penampungan'),
    (2, 'Bank BCA - 5125036811',    'bank'),
    (2, 'Bank BCA - 5125978301',    'bank'),
    (2, 'Bank BRI',                 'bank'),
    (2, 'Bank Mandiri',             'bank'),
    (2, 'Bank BNI',                 'bank')
ON CONFLICT ("unit_id", "nama") DO NOTHING;
