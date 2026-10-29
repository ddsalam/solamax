-- 0049_pihak_lawan — struktur fase A: pihak lawan, tanggal buku maju, penampung.
--
-- Rencana: docs/plans/2026-10-29-1719-feat-keuangan-pihak-lawan-penebusan-impor-bank-plan.md
-- (U1; KTD1, KTD2, KTD3, KTD5, KTD8, KTD11, KTD13). Migrasi ini HANYA menambah
-- struktur — tak ada layar yang berubah perilakunya karena migrasi ini, KECUALI
-- satu hal yang memang diputuskan (KTD3, butir 4 di bawah): baris kas BARU
-- berkategori pihak lawan tanpa pihak lawan ditolak DB sejak migrasi ini.
--
--   app.pihak_lawan             — master pihak lawan BER-UNIT (bukan global)
--   app.pihak_lawan_saldo_awal  — saldo pembuka per pihak lawan, bertanda
--   app.cash_ledger             — + pihak lawan, kunci pasangan, tanggal asal,
--                                   kode alasan maju, tautan baris parkir
--   app.cash_account            — + nomor rekening (diisi dari nama)
--   app.manual_entry            — + pemilik titipan (pihak lawan)
--   app.cash_mutation_category  — + penampung (2 sisi) + "Penyerahan titipan"
--   app.reason_code             — + 5 kode adjustment untuk pembukuan maju
--
-- ⛔ KEPUTUSAN YANG MENGIKAT:
--
-- 1. **Pihak lawan BER-UNIT, bukan global (KTD1).** Nama afiliasi/kreditur satu
--    tenant tidak boleh bocor ke tenant lain, jadi tabelnya memakai RLS
--    `unit_scope` biasa (§4.1b). Pihak lawan berjenis `unit` menyimpan unit
--    lawannya. Penanda "satu PT" (R5) TIDAK disimpan — diturunkan dari peta
--    tenant saat baca, supaya tak ada salinan yang bisa menyimpang.
--
-- 2. **Saldo pihak lawan adalah TURUNAN (KTD2):** saldo pembuka + kebalikan
--    Σ amount baris kas bertautan pihak lawan. Tak ada kolom saldo di sini.
--    Tanda saldo pembuka: POSITIF = piutang (pihak lawan berhutang ke unit),
--    NEGATIF = hutang unit ke pihak lawan — searah dengan `−Σ amount` kas.
--
-- 3. **Penampung adalah KATEGORI, bukan akun kas (KTD8).** "Mutasi Belum
--    Teridentifikasi" duduk di rekening bank aslinya sehingga saldo bank tetap
--    benar; pemindahan = dua baris baru yang menunjuk baris parkirnya
--    (`parkir_sumber_id`), baris parkir tak pernah disunting.
--
-- 4. **Pihak lawan wajib untuk baris BARU lewat CHECK `NOT VALID` (KTD3).**
--    Ditegakkan pada setiap INSERT/UPDATE sejak migrasi ini, tanpa memaksa
--    baris Oktober lama. Baris lama tetap bisa di-void (cabang `"void"`) dan
--    diisi pihak lawannya sekali lewat tindakan "Tetapkan pihak lawan".
--    ⚠️ Akibat yang disengaja: `simpanMutasiKas` berkategori "Hutang Piutang"
--    tanpa pihak lawan kini ditolak DB sampai layar pemilih pihak lawan (U3)
--    hidup. Keduanya dirilis bersama.
--
-- Idempoten / aman re-run.

-- ---------------------------------------------------------------------------
-- 1. Master pihak lawan
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."pihak_lawan" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"            SMALLINT NOT NULL,
    -- Daftar TERTUTUP (R1). Teks + CHECK, bukan enum: pola `reason_code.applies_to`.
    "jenis"              TEXT NOT NULL,
    "nama"               TEXT NOT NULL,
    -- Hanya untuk jenis `unit`: unit SolaMax di seberang pasangan.
    "lawan_unit_id"      SMALLINT,
    "aktif"              BOOLEAN NOT NULL DEFAULT true,
    -- NULL = disemai migrasi ini; baris yang dibuat Keuangan wajib mengisinya
    -- (ditegakkan aksi, berikut `audit_log`).
    "created_by_user_id" INTEGER,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pihak_lawan_pkey" PRIMARY KEY ("id"),
    -- Target FK komposit (idiom 0019/0029): baris kas, saldo pembuka, dan
    -- setoran titipan hanya boleh menunjuk pihak lawan milik unit yang SAMA.
    CONSTRAINT "pihak_lawan_unit_uq" UNIQUE ("id", "unit_id"),
    CONSTRAINT "pihak_lawan_jenis" CHECK (
        "jenis" IN ('unit', 'afiliasi', 'titipan', 'kreditur', 'karyawan', 'lain')
    ),
    CONSTRAINT "pihak_lawan_unit_lawan" CHECK (
        ("jenis" = 'unit') = ("lawan_unit_id" IS NOT NULL)
    ),
    CONSTRAINT "pihak_lawan_bukan_diri_sendiri" CHECK (
        "lawan_unit_id" IS NULL OR "lawan_unit_id" <> "unit_id"
    ),
    CONSTRAINT "pihak_lawan_lawan_unit_fk" FOREIGN KEY ("lawan_unit_id")
        REFERENCES "public"."unit"("unit_id"),
    CONSTRAINT "pihak_lawan_nama_isi" CHECK (btrim("nama") <> '')
);

-- Nama unik per unit (pola `cash_account_nama_uq`): dua "BPR" di satu unit
-- membuat setiap mutasi ambigu.
CREATE UNIQUE INDEX IF NOT EXISTS "pihak_lawan_nama_uq"
    ON "app"."pihak_lawan"("unit_id", "nama");
-- Satu pihak lawan per unit lawan — kalau dua, saldo pasangan terbelah dua.
CREATE UNIQUE INDEX IF NOT EXISTS "pihak_lawan_lawan_unit_uq"
    ON "app"."pihak_lawan"("unit_id", "lawan_unit_id")
    WHERE "lawan_unit_id" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Saldo pembuka per pihak lawan (R7) — pola `tetapkanSaldoAwal`:
--    void + insert, satu baris aktif, "sementara" seperti 0044.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."pihak_lawan_saldo_awal" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"            SMALLINT NOT NULL,
    "pihak_lawan_id"     UUID NOT NULL,
    -- Tanggal cut-over pihak lawan ini: saldo pada AWAL hari tersebut.
    "tanggal"            DATE NOT NULL,
    -- BERTANDA: positif = piutang, negatif = hutang (keputusan 2 di kepala).
    "amount"             DECIMAL(17,2) NOT NULL,
    "sementara"          BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "void"               BOOLEAN NOT NULL DEFAULT false,
    "voided_by_user_id"  INTEGER,
    "voided_at"          TIMESTAMPTZ,

    CONSTRAINT "pihak_lawan_saldo_awal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pihak_lawan_saldo_awal_pihak_lawan_fk" FOREIGN KEY ("pihak_lawan_id", "unit_id")
        REFERENCES "app"."pihak_lawan"("id", "unit_id"),
    -- Rp 0 hanya sah bila DITANDAI sementara (§10.26) — nol tanpa penanda
    -- menyamar sebagai angka sungguhan.
    CONSTRAINT "pihak_lawan_saldo_awal_nol_sementara" CHECK (
        "amount" <> 0 OR "sementara"
    ),
    CONSTRAINT "pihak_lawan_saldo_awal_void_audit" CHECK (
        "void" = ("voided_at" IS NOT NULL) AND "void" = ("voided_by_user_id" IS NOT NULL)
    )
);

-- SATU saldo pembuka aktif per (unit, pihak lawan) — pola 0036. Mengganti =
-- void yang lama lalu tulis yang baru.
CREATE UNIQUE INDEX IF NOT EXISTS "pihak_lawan_saldo_awal_aktif_uq"
    ON "app"."pihak_lawan_saldo_awal"("unit_id", "pihak_lawan_id") WHERE NOT "void";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."pihak_lawan" TO dashboard_app;
    REVOKE DELETE ON "app"."pihak_lawan" FROM dashboard_app;
    GRANT SELECT, INSERT, UPDATE ON "app"."pihak_lawan_saldo_awal" TO dashboard_app;
    REVOKE DELETE ON "app"."pihak_lawan_saldo_awal" FROM dashboard_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Seed pihak lawan per unit — DITURUNKAN dari public.unit, tanpa id tangan.
--
-- 🔴 LETAKNYA DI SINI BUKAN KEBETULAN: seed baris ter-scope unit WAJIB
-- mendahului blok RLS di bawah (§4.1b c; kejadian 0029, 13 Agu 2026).
-- `public.unit` sendiri tak ber-RLS (0016/0019), jadi bisa dibaca tanpa GUC.
-- ---------------------------------------------------------------------------
INSERT INTO "app"."pihak_lawan" ("unit_id", "jenis", "nama", "lawan_unit_id", "aktif")
SELECT "u"."unit_id", 'unit', "lawan"."name", "lawan"."unit_id", "lawan"."active"
  FROM "public"."unit" "u"
  JOIN "public"."unit" "lawan" ON "lawan"."unit_id" <> "u"."unit_id"
ON CONFLICT DO NOTHING;

INSERT INTO "app"."pihak_lawan" ("unit_id", "jenis", "nama")
SELECT "u"."unit_id", 'titipan', 'Outlet Bright'
  FROM "public"."unit" "u"
ON CONFLICT DO NOTHING;

-- ON CONFLICT DO NOTHING menelan bentrok nama (mis. dua unit bernama sama)
-- tanpa suara: satu pasangan akan hilang dan baru ketahuan saat saldonya tak
-- bisa dicatat. Lebih baik migrasinya gagal.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n
    FROM "public"."unit" "u"
    JOIN "public"."unit" "lawan" ON "lawan"."unit_id" <> "u"."unit_id"
   WHERE NOT EXISTS (
     SELECT 1 FROM "app"."pihak_lawan" "p"
      WHERE "p"."unit_id" = "u"."unit_id" AND "p"."lawan_unit_id" = "lawan"."unit_id"
   );
  IF n > 0 THEN
    RAISE EXCEPTION '0049 batal: % pasangan unit tanpa pihak lawan berjenis unit '
                    '(nama unit bentrok?) — selesaikan dulu', n;
  END IF;
END
$$;

-- RLS — cabang NULL DIPUTUSKAN SADAR: **TIDAK ADA**. Kedua tabel selalu milik
-- satu unit (kolomnya NOT NULL); tak ada pihak lawan yang berlaku global —
-- itulah inti KTD1. Predikat disalin PERSIS dari 0016 (§4.1b).
DO $$
DECLARE
  t text;
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  ))$p$;
BEGIN
  FOREACH t IN ARRAY ARRAY['pihak_lawan', 'pihak_lawan_saldo_awal'] LOOP
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
-- 4. Kategori mutasi baru (daftar tertutup 0029) & kode alasan maju (0022).
--    Keduanya tanpa unit_id ⇒ tanpa RLS ⇒ letaknya bebas.
-- ---------------------------------------------------------------------------
INSERT INTO "app"."cash_mutation_category" ("side", "label") VALUES
    ('debet',  'Mutasi Belum Teridentifikasi'),
    ('kredit', 'Mutasi Belum Teridentifikasi'),
    ('kredit', 'Penyerahan titipan')
ON CONFLICT ("side", "label") DO NOTHING;

-- Satu kode per sumber pembukuan maju (KTD5, R28). Baris yang terdorong ke hari
-- terbuka berikutnya membawa salah satunya.
INSERT INTO "app"."reason_code" ("code", "label", "applies_to", "requires_target_date") VALUES
    ('ADJ-FWD-IMPORT',    'Impor rekening koran susulan (dibukukan maju)',  'adjustment', false),
    ('ADJ-FWD-INTERUNIT', 'Pasangan antar unit (dibukukan maju)',           'adjustment', false),
    ('ADJ-FWD-PURCHASE',  'Penebusan SO (dibukukan maju)',                  'adjustment', false),
    ('ADJ-FWD-SUSPENSE',  'Pemindahan dari penampung (dibukukan maju)',     'adjustment', false),
    ('ADJ-FWD-REVERSAL',  'Pembatalan (dibukukan maju)',                    'adjustment', false)
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. cash_ledger — kolom fase A. Semua NULLABLE: baris lama tak diberi nilai.
-- ---------------------------------------------------------------------------
ALTER TABLE "app"."cash_ledger"
    ADD COLUMN IF NOT EXISTS "pihak_lawan_id" UUID,
    -- Kunci pasangan antar unit (KTD4): dua kaki di dua unit berbagi nilai ini.
    ADD COLUMN IF NOT EXISTS "pasangan_uuid" UUID,
    -- Tanggal transaksi asli bila baris dibukukan maju (R28). `business_date`
    -- tetap hari buku.
    ADD COLUMN IF NOT EXISTS "tanggal_asal" DATE,
    ADD COLUMN IF NOT EXISTS "alasan_maju" TEXT,
    -- Bayangan `reason_code.applies_to` (idiom 0027/0030): hanya kode grup
    -- `adjustment` yang bisa dipakai.
    ADD COLUMN IF NOT EXISTS "alasan_maju_applies_to" TEXT,
    -- Baris penampung yang dipindahkan oleh baris ini (KTD8).
    ADD COLUMN IF NOT EXISTS "parkir_sumber_id" UUID;

-- Target FK komposit untuk tautan baris parkir (baris unit yang SAMA).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_ledger_unit_uq') THEN
    ALTER TABLE "app"."cash_ledger" ADD CONSTRAINT "cash_ledger_unit_uq" UNIQUE ("id", "unit_id");
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_ledger_pihak_lawan_fk') THEN
    ALTER TABLE "app"."cash_ledger"
      ADD CONSTRAINT "cash_ledger_pihak_lawan_fk"
      FOREIGN KEY ("pihak_lawan_id", "unit_id") REFERENCES "app"."pihak_lawan"("id", "unit_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_ledger_parkir_sumber_fk') THEN
    ALTER TABLE "app"."cash_ledger"
      ADD CONSTRAINT "cash_ledger_parkir_sumber_fk"
      FOREIGN KEY ("parkir_sumber_id", "unit_id") REFERENCES "app"."cash_ledger"("id", "unit_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_ledger_parkir_bukan_diri') THEN
    ALTER TABLE "app"."cash_ledger"
      ADD CONSTRAINT "cash_ledger_parkir_bukan_diri" CHECK (
        "parkir_sumber_id" IS NULL OR "parkir_sumber_id" <> "id"
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_ledger_alasan_maju_fk') THEN
    ALTER TABLE "app"."cash_ledger"
      ADD CONSTRAINT "cash_ledger_alasan_maju_fk"
      FOREIGN KEY ("alasan_maju", "alasan_maju_applies_to")
      REFERENCES "app"."reason_code"("code", "applies_to");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_ledger_alasan_maju_adjustment') THEN
    ALTER TABLE "app"."cash_ledger"
      ADD CONSTRAINT "cash_ledger_alasan_maju_adjustment" CHECK (
        "alasan_maju_applies_to" IS NULL OR "alasan_maju_applies_to" = 'adjustment'
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_ledger_alasan_maju_pair') THEN
    ALTER TABLE "app"."cash_ledger"
      ADD CONSTRAINT "cash_ledger_alasan_maju_pair" CHECK (
        ("alasan_maju" IS NULL) = ("alasan_maju_applies_to" IS NULL)
      );
  END IF;
  -- R28: baris hanya bisa terdorong MAJU, tak pernah mundur ke hari tertutup.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_ledger_tanggal_asal_tidak_sesudah') THEN
    ALTER TABLE "app"."cash_ledger"
      ADD CONSTRAINT "cash_ledger_tanggal_asal_tidak_sesudah" CHECK (
        "tanggal_asal" IS NULL OR "tanggal_asal" <= "business_date"
      );
  END IF;
  -- R28: baris yang terdorong maju WAJIB membawa kode alasan.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_ledger_maju_beralasan') THEN
    ALTER TABLE "app"."cash_ledger"
      ADD CONSTRAINT "cash_ledger_maju_beralasan" CHECK (
        "tanggal_asal" IS NULL OR "tanggal_asal" = "business_date" OR "alasan_maju" IS NOT NULL
      );
  END IF;
END
$$;

-- 🔴 KTD3 — kategori pihak lawan ⇒ pihak lawan terisi. `NOT VALID`: baris
-- Oktober lama tak diperiksa saat dipasang, tetapi SETIAP insert/update sejak
-- kini diperiksa. Cabang `"void"` yang membuat baris lama tetap bisa
-- dibatalkan. ⛔ Jangan `VALIDATE CONSTRAINT` sebelum seluruh baris lama
-- "Hutang Piutang" diberi pihak lawan oleh Finance.
-- "Penyerahan titipan Bright" (0045) SENGAJA tidak masuk daftar: baris lamanya
-- tetap dihitung untuk Bright lewat pengenal `titipan-bright.ts` (KTD11).
ALTER TABLE "app"."cash_ledger" DROP CONSTRAINT IF EXISTS "cash_ledger_pihak_lawan_wajib";
ALTER TABLE "app"."cash_ledger" ADD CONSTRAINT "cash_ledger_pihak_lawan_wajib" CHECK (
    "void"
    OR "category_label" IS NULL
    OR "category_label" NOT IN ('Hutang Piutang', 'Penyerahan titipan')
    OR "pihak_lawan_id" IS NOT NULL
) NOT VALID;

-- Hak `dashboard_app` atas cash_ledger sudah dari 0029 (SELECT/INSERT/UPDATE,
-- DELETE di-REVOKE); kolom baru ikut hak tabelnya.

-- ---------------------------------------------------------------------------
-- 6. manual_entry — pemilik titipan (KTD11). Kolom milik pengawas (§2.1);
--    NULL untuk semua baris lama, pengenal `titipan-bright.ts` tetap berlaku.
-- ---------------------------------------------------------------------------
ALTER TABLE "app"."manual_entry"
    ADD COLUMN IF NOT EXISTS "pihak_lawan_id" UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manual_entry_pihak_lawan_fk') THEN
    ALTER TABLE "app"."manual_entry"
      ADD CONSTRAINT "manual_entry_pihak_lawan_fk"
      FOREIGN KEY ("pihak_lawan_id", "unit_id") REFERENCES "app"."pihak_lawan"("id", "unit_id");
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 7. cash_account.nomor_rekening (KTD13) — diisi dari pola `nama` yang sudah
--    ditegakkan form (`keuangan-akun-model.ts`: `^Bank\s+.+\s-\s*\d+$`).
--    Hanya yang masih NULL: menjalankan ulang tak menimpa suntingan Keuangan.
--
-- 🔴 RLS: cash_account ber-FORCE dan peran migrasi tidak ber-BYPASSRLS, jadi
-- TANPA app.unit_ids UPDATE di bawah menyentuh NOL BARIS TANPA GALAT — hijau
-- palsu. Scope dipasang dari public.unit (pola 0040/0039), DIBUKTIKAN dengan
-- hasilnya, lalu dipulihkan. Ini UPDATE atas tabel yang sudah ada, bukan seed
-- tabel baru, sehingga larangan §4.1b (c) tidak berlaku di sini.
-- ---------------------------------------------------------------------------
ALTER TABLE "app"."cash_account"
    ADD COLUMN IF NOT EXISTS "nomor_rekening" TEXT;

DO $$
DECLARE
  scope_lama text := current_setting('app.unit_ids', true);
  sisa bigint;
BEGIN
  PERFORM set_config('app.unit_ids',
    COALESCE((SELECT string_agg("unit_id"::text, ',' ORDER BY "unit_id") FROM "public"."unit"), ''),
    true
  );

  UPDATE "app"."cash_account"
     SET "nomor_rekening" = substring("nama" from '\s-\s*(\d+)$')
   WHERE "kind" = 'bank'
     AND "nomor_rekening" IS NULL
     AND "nama" ~ '^Bank\s+.+\s-\s*\d+$';

  -- Bukti: tak ada rekening bank berpola yang masih kosong. Bila scope gagal
  -- terpasang, `sisa` tetap 0 — maka scope sendiri juga dibuktikan.
  IF COALESCE(current_setting('app.unit_ids', true), '') = ''
     AND EXISTS (SELECT 1 FROM "public"."unit")
  THEN
    RAISE EXCEPTION '0049 batal: app.unit_ids kosong padahal public.unit berisi — '
                    'backfill nomor_rekening akan menyentuh nol baris tanpa galat';
  END IF;
  SELECT count(*) INTO sisa
    FROM "app"."cash_account"
   WHERE "kind" = 'bank' AND "nomor_rekening" IS NULL
     AND "nama" ~ '^Bank\s+.+\s-\s*\d+$';
  IF sisa > 0 THEN
    RAISE EXCEPTION '0049 batal: % rekening bank berpola nomor tanpa nomor_rekening', sisa;
  END IF;

  PERFORM set_config('app.unit_ids', COALESCE(scope_lama, ''), true);
END
$$;
