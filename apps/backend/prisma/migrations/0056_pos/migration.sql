-- 0056_pos — daftar pos resmi (COA empat digit), sub-pos per unit, peta kode
-- lama → pos, dan peta kategori operasional → pos berkode baru.
--
-- Rencana: docs/plans/2026-11-02-1804-feat-keuangan-buku-besar-posting-otomatis-plan.html
-- (U1; R1–R5, KTD1, KTD2).
--
--   app.pos                  — Tabel Pos rencana, GLOBAL (berlaku tujuh unit,
--                              keputusan B1 bagan seragam). Tanpa unit_id ⇒
--                              tanpa RLS (pola cash_mutation_category, 0029).
--   app.pos_unit             — sub-pos MILIK SATU UNIT: sub-pos bank 1111–1119
--                              per rekening (R5) dan sub-pos tambahan HoF (R4).
--                              RLS unit_scope, predikat 0016 PERSIS.
--   app.pos_kode_lama        — kode lama (6-, 7-, 8-, 3-9100, 1-1800) → pos
--                              baru (R2, KTD2). Global, baca-saja.
--   app.category_account_map — + 14 baris berkode empat digit (Tabel Peta
--                              Kategori); baris 0023 tetap untuk riwayat.
--
-- ⛔ KEPUTUSAN YANG MENGIKAT:
--
-- 1. **Nama pos/jurnal/buku_besar, bukan gl (KTD1).** "GL" sudah berarti
--    gain/loss di repo ini (0048).
-- 2. **Kode lama TIDAK ditulis ulang di baris tersimpan (KTD2).** Trigger 0026
--    melarang UPDATE manual_entry di hari tertutup, dan baris yang sudah ada
--    adalah sejarah. `pos_kode_lama` menerjemahkan saat jurnal dibentuk (U8).
--    Migrasi ini tidak menyentuh manual_entry, noncash_expense, maupun
--    reclassification.
-- 3. **Dua tabel, bukan satu tabel ber-unit_id NULL.** Pos global tidak punya
--    unit; sub-pos selalu punya. Satu tabel campuran memaksa cabang
--    `unit_id IS NULL OR …` seperti 0023 — dan 0023 sendiri mencatat bahayanya:
--    menjalankan ulang 0016 mengganti policy-nya dengan versi ketat dan seluruh
--    baris global lenyap tanpa galat. Dengan dua tabel, predikat 0016 dipakai
--    apa adanya, dan pos global tak pernah bisa hilang dari pandangan.
-- 4. **Sub-pos bank lahir dari rekening, bukan diketik (R5).** CHECK menegakkan
--    "di bawah 1110 ⇔ bertaut ke cash_account". Rekening bank yang sudah ada
--    mendapat sub-posnya di migrasi ini; rekening baru mendapatkannya dari
--    trigger AFTER INSERT pada cash_account, di transaksi yang sama dengan
--    INSERT rekeningnya (tanpa SECURITY DEFINER: trigger berjalan sebagai
--    `dashboard_app` di bawah scope unit yang sudah dipasang aksi Kelola akun
--    kas, sehingga WITH CHECK RLS terpenuhi apa adanya). Nomor = nomor bebas
--    terkecil 1111–1119 di unit itu, urut waktu dibuat. Rekening bank ke-10
--    di satu unit DITOLAK dengan pesan jelas — lebih baik daripada rekening
--    tanpa pos yang baru ketahuan saat neraca tidak cocok.
-- 5. **Seed ter-scope unit mendahului blok RLS (§4.1b c).** cash_account
--    ber-FORCE RLS dan peran migrasi tak ber-BYPASSRLS, jadi scope dipasang
--    dari public.unit (pola 0049 §7), hasilnya DIBUKTIKAN, lalu dipulihkan.
-- 6. **Peta kategori kini diubah HoF di aplikasi (R4), append-only.** 0023
--    mencabut INSERT karena "mengubah pemetaan = migrasi"; R4 membalik itu.
--    `dashboard_app` mendapat INSERT, plus UPDATE hanya pada kolom akun &
--    pencatat — dipakai `ON CONFLICT` saat HoF mengubah kategori yang sama dua
--    kali pada HARI yang sama (kunci unik 0023 memuat effective_from). DELETE
--    tetap dicabut: baris lama adalah riwayat.
-- 7. **effective_from baris baru = tanggal migrasi ini dijalankan (WIB)** =
--    tanggal rilis (rencana U1). Bukan tanggal tetap: staging dan pilot
--    dirilis pada hari berbeda, dan tanggal di masa depan akan membuat baris
--    hari ini tetap memakai kode lama, sedangkan tanggal lampau mengubah kode
--    baris yang diketik mundur sebelum rilis. Penulis peta (biaya-actions,
--    klasifikasi-tulis) memilih `effective_from <= business_date` terbaru, jadi
--    baris bertanggal sejak rilis langsung menyimpan kode empat digit.
--    Idempotensi tidak bergantung pada tanggal: baris baru hanya disisipkan
--    bila kategori itu belum punya baris global berkode empat digit.
--
-- Idempoten / aman re-run.

-- ---------------------------------------------------------------------------
-- 1. Daftar pos resmi (global)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."pos" (
    "kode"       TEXT NOT NULL,
    "nama"       TEXT NOT NULL,
    -- Daftar TERTUTUP. Teks + CHECK, bukan enum: pola reason_code.applies_to.
    "jenis"      TEXT NOT NULL,
    -- Pos induk hanya menjumlahkan sub-posnya; jurnal tidak boleh memakainya.
    "induk"      BOOLEAN NOT NULL DEFAULT false,
    "kode_induk" TEXT,
    -- Pos pengurang (kontra): 1590 Akumulasi Penyusutan, 4110 Tera.
    "pengurang"  BOOLEAN NOT NULL DEFAULT false,
    -- Pos kliring: wajib Rp 0 saat tutup bulan (R33), kecuali butir dalam perjalanan.
    "kliring"    BOOLEAN NOT NULL DEFAULT false,
    -- Pos yang hanya diisi sistem (tanda `sistem` di Tabel Pos).
    "sistem"     BOOLEAN NOT NULL DEFAULT false,
    "keterangan" TEXT,

    CONSTRAINT "pos_pkey" PRIMARY KEY ("kode"),
    CONSTRAINT "pos_kode_empat_digit" CHECK ("kode" ~ '^[1-5][0-9]{3}$'),
    CONSTRAINT "pos_nama_isi" CHECK (btrim("nama") <> ''),
    CONSTRAINT "pos_jenis_sah" CHECK (
        "jenis" IN ('aset', 'kewajiban', 'modal', 'pendapatan', 'beban')
    ),
    -- Digit pertama = kelas pos. Pos 5xxx berjenis "aset" adalah salah ketik
    -- yang memindahkan uang dari laba-rugi ke neraca tanpa suara.
    CONSTRAINT "pos_jenis_kelas" CHECK (
        ("jenis" = 'aset'       AND left("kode", 1) = '1') OR
        ("jenis" = 'kewajiban'  AND left("kode", 1) = '2') OR
        ("jenis" = 'modal'      AND left("kode", 1) = '3') OR
        ("jenis" = 'pendapatan' AND left("kode", 1) = '4') OR
        ("jenis" = 'beban'      AND left("kode", 1) = '5')
    ),
    -- Satu tingkat saja: induk tidak punya induk.
    CONSTRAINT "pos_induk_satu_tingkat" CHECK (NOT ("induk" AND "kode_induk" IS NOT NULL)),
    CONSTRAINT "pos_induk_fk" FOREIGN KEY ("kode_induk") REFERENCES "app"."pos"("kode")
);

-- Tabel Pos rencana apa adanya. Kolom: kode, nama, jenis, induk, kode_induk,
-- pengurang, kliring, sistem, keterangan.
INSERT INTO "app"."pos"
    ("kode", "nama", "jenis", "induk", "kode_induk", "pengurang", "kliring", "sistem", "keterangan")
VALUES
    ('1100', 'Kas', 'aset', true, NULL, false, false, false, 'Dipecah agar Kas Besar dan EDC Penampungan bisa dicocokkan terpisah.'),
    ('1101', 'Kas Besar', 'aset', false, '1100', false, false, false, 'Dari akun kas Kas Besar.'),
    ('1102', 'EDC Penampungan', 'aset', false, '1100', false, false, false, 'Dari akun kas EDC Penampungan.'),
    ('1103', 'Penjualan Belum Disetor', 'aset', false, '1100', false, true, true, 'Menampung penjualan tunai dan EDC per shift sampai pengawas menyetor. Sisanya adalah selisih kas.'),
    ('1110', 'Bank', 'aset', true, NULL, false, false, false, 'Satu sub-pos per rekening bank unit (R5).'),
    ('1120', 'Piutang Usaha', 'aset', true, NULL, false, false, false, 'Dipecah agar piutang antar cabang bisa dieliminasi kelak.'),
    ('1121', 'Piutang Pelanggan EasyMax', 'aset', false, '1120', false, false, false, 'Dari buku piutang EasyMax.'),
    ('1122', 'Piutang Antar Cabang', 'aset', false, '1120', false, false, false, 'Dari pinjaman antar unit.'),
    ('1129', 'Piutang Lain-lain', 'aset', false, '1120', false, false, false, 'Dari pihak lawan non-EasyMax bersaldo piutang.'),
    ('1130', 'Persediaan BBM', 'aset', true, NULL, false, false, false, 'Dipecah menjadi BBM di tangki dan SO yang sudah dibayar.'),
    ('1131', 'Persediaan BBM di Tangki', 'aset', false, '1130', false, false, false, 'Stok akhir x harga beli terakhir.'),
    ('1132', 'SO Sudah Dibayar (Sisa SO)', 'aset', false, '1130', false, false, false, 'Penebusan yang BBM-nya belum diterima.'),
    ('1140', 'Pajak Dibayar di Muka', 'aset', false, NULL, false, false, false, 'Komponen pajak penebusan yang bisa dikreditkan.'),
    ('1150', 'Investasi Sementara', 'aset', false, NULL, false, false, false, 'Temporary Investment di laporan rumus.'),
    ('1190', 'Dana dalam Perjalanan', 'aset', false, NULL, false, true, false, 'Pindah buku antar rekening sendiri. Pengganti 1-1800.'),
    ('1198', 'Transaksi Belum Dipetakan', 'aset', false, NULL, false, true, true, 'Baris Okt-Nov yang belum tertaut (R27).'),
    ('1199', 'Mutasi Belum Teridentifikasi', 'aset', false, NULL, false, true, false, 'Baris yang diparkir.'),
    ('1500', 'Aset Tetap - Tanah', 'aset', false, NULL, false, false, false, 'Saldo awal dari akuntan.'),
    ('1510', 'Aset Tetap - Bangunan & Pompa', 'aset', false, NULL, false, false, false, 'Saldo awal dari akuntan.'),
    ('1520', 'Aset Tetap - Kendaraan', 'aset', false, NULL, false, false, false, 'Saldo awal dari akuntan.'),
    ('1590', 'Akumulasi Penyusutan', 'aset', false, NULL, true, false, false, 'Bertambah lewat jurnal memorial penyusutan.'),
    ('2100', 'Hutang Usaha', 'kewajiban', true, NULL, false, false, false, 'Dipecah per jenis pihak.'),
    ('2101', 'Deposit Pelanggan EasyMax', 'kewajiban', false, '2100', false, false, false, 'Hutang pelanggan EasyMax pada usulan awal.'),
    ('2102', 'Hutang Antar Cabang', 'kewajiban', false, '2100', false, false, false, 'Kaki lawan dari 1122 di unit lain.'),
    ('2103', 'Titipan Bright', 'kewajiban', false, '2100', false, false, false, 'Setoran outlet Bright adalah titipan (keputusan 26 Sep 2026).'),
    ('2109', 'Hutang Lain-lain', 'kewajiban', false, '2100', false, false, false, 'Dari pihak lawan non-EasyMax bersaldo hutang.'),
    ('2110', 'Hutang Bank', 'kewajiban', false, NULL, false, false, false, 'Saldo awal dari akuntan.'),
    ('2200', 'Hutang Pajak', 'kewajiban', false, NULL, false, false, false, 'Lewat jurnal memorial.'),
    ('2300', 'Hutang Gaji', 'kewajiban', false, NULL, false, false, false, 'Lewat jurnal memorial.'),
    ('3100', 'Modal Pemilik', 'modal', false, NULL, false, false, false, 'Termasuk mutasi Tambahan Modal.'),
    ('3200', 'Laba Ditahan', 'modal', false, NULL, false, false, false, 'Saldo awal dari akuntan. Bertambah dengan laba bulan yang sudah ditutup.'),
    ('3300', 'Prive', 'modal', false, NULL, false, false, false, 'Pengganti 3-9100. Termasuk Kontribusi ke Pusat.'),
    ('3900', 'Laba Tahun Berjalan', 'modal', false, NULL, false, false, true, 'Dihitung dari kelas 4 dan 5. Tidak bisa dijurnal.'),
    ('4100', 'Penjualan BBM', 'pendapatan', false, NULL, false, false, false, 'Volume x harga jual dari EasyMax.'),
    ('4110', 'Tera', 'pendapatan', false, NULL, true, false, false, 'Tera x harga jual. Tetap terpisah, tidak dinetokan ke volume.'),
    ('4200', 'Pendapatan Lain-lain', 'pendapatan', false, NULL, false, false, false, 'Pengganti 8-1000.'),
    ('5100', 'HPP - Harga Pokok BBM', 'beban', false, NULL, false, false, false, 'Liter terjual x harga beli terakhir. Bukan penebusan.'),
    ('5110', 'Susut / Losses-Gain BBM', 'beban', false, NULL, false, false, false, 'Losses-gain liter x harga beli terakhir.'),
    ('5120', 'Selisih Harga Pembelian & Persediaan', 'beban', false, NULL, false, false, true, 'Penyesuaian harian 1131 dan 1132 ke liter x harga beli terakhir (P23).'),
    ('5130', 'Selisih Kas', 'beban', false, NULL, false, false, true, 'Selisih kas yang disetujui di tutup hari, dipindahkan dari 1103 (P24). Bisa negatif.'),
    ('5200', 'Beban Gaji & THR', 'beban', false, NULL, false, false, false, NULL),
    ('5300', 'Beban Listrik, Air, Internet', 'beban', false, NULL, false, false, false, NULL),
    ('5400', 'Beban Sewa', 'beban', false, NULL, false, false, false, NULL),
    ('5500', 'Beban Bank & Biaya MDR QRIS', 'beban', false, NULL, false, false, false, 'Pengganti 7-1100 dan 7-1200.'),
    ('5600', 'Beban Penyusutan', 'beban', false, NULL, false, false, false, 'Lewat jurnal memorial.'),
    ('5700', 'Beban Operasional Lain (ATK, kebersihan)', 'beban', false, NULL, false, false, false, 'Penampung kategori operasional lain.'),
    ('5800', 'Beban Pajak', 'beban', false, NULL, false, false, false, NULL),
    ('5900', 'Beban Bunga Bank', 'beban', false, NULL, false, false, false, NULL)
ON CONFLICT ("kode") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Kode lama → pos baru (R2, KTD2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."pos_kode_lama" (
    "kode_lama" TEXT NOT NULL,
    "pos_kode"  TEXT NOT NULL,

    CONSTRAINT "pos_kode_lama_pkey" PRIMARY KEY ("kode_lama"),
    CONSTRAINT "pos_kode_lama_bentuk" CHECK ("kode_lama" ~ '^[0-9]-[0-9]{4}$'),
    CONSTRAINT "pos_kode_lama_pos_fk" FOREIGN KEY ("pos_kode") REFERENCES "app"."pos"("kode")
);

-- Seluruh kode di seed 0023 + daftar reklasifikasi (keuangan-reklas.ts).
-- ⚠️ Terjemahan KODE saja. Baris berseksi pendapatan_lain yang tersimpan
-- dengan kode beban 6-xxxx (cacat R26) tetap pendapatan: seksinya yang
-- memutuskan (U2), bukan tabel ini.
INSERT INTO "app"."pos_kode_lama" ("kode_lama", "pos_kode") VALUES
    ('6-1100', '5200'),
    ('6-2400', '5300'),
    ('6-3300', '5300'),
    ('7-1200', '5500'),
    ('7-1100', '5500'),
    ('6-3100', '5700'),
    ('6-2300', '5700'),
    ('6-2200', '5700'),
    ('6-2100', '5700'),
    ('6-4100', '5700'),
    ('6-3500', '5700'),
    ('6-1300', '5700'),
    ('6-9100', '5700'),
    ('6-9900', '5700'),
    ('8-1000', '4200'),
    ('3-9100', '3300'),
    ('1-1800', '1190')
ON CONFLICT ("kode_lama") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Sub-pos per unit (R4, R5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."pos_unit" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"            SMALLINT NOT NULL,
    "kode"               TEXT NOT NULL,
    "nama"               TEXT NOT NULL,
    "kode_induk"         TEXT NOT NULL,
    -- Hanya sub-pos bank: rekening yang diwakilinya (R5).
    "cash_account_id"    UUID,
    -- NULL = disemai migrasi/trigger rekening; sub-pos HoF wajib mengisinya
    -- (ditegakkan aksi, berikut audit_log).
    "created_by_user_id" INTEGER,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_unit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pos_unit_kode_uq" UNIQUE ("unit_id", "kode"),
    CONSTRAINT "pos_unit_kode_empat_digit" CHECK ("kode" ~ '^[1-5][0-9]{3}$'),
    CONSTRAINT "pos_unit_nama_isi" CHECK (btrim("nama") <> ''),
    -- Sub-pos duduk di rentang induknya: 1100 → 1101–1109, 2100 → 2101–2109.
    -- CASE dulu: urutan evaluasi CHECK tak dijamin, dan `'11a4'::int` akan
    -- jatuh sebagai galat sintaks, bukan pelanggaran CHECK yang terbaca.
    CONSTRAINT "pos_unit_rentang_induk" CHECK (
        CASE WHEN "kode" ~ '^[0-9]{4}$' AND "kode_induk" ~ '^[0-9]{4}$'
             THEN "kode"::int BETWEEN "kode_induk"::int + 1 AND "kode_induk"::int + 9
             ELSE false
        END
    ),
    -- Keputusan 4: di bawah 1110 ⇔ bertaut ke rekening.
    CONSTRAINT "pos_unit_bank_rekening" CHECK (
        ("kode_induk" = '1110') = ("cash_account_id" IS NOT NULL)
    ),
    CONSTRAINT "pos_unit_induk_fk" FOREIGN KEY ("kode_induk") REFERENCES "app"."pos"("kode"),
    -- FK komposit (idiom 0019/0029/0053): rekening milik unit yang SAMA.
    CONSTRAINT "pos_unit_rekening_fk" FOREIGN KEY ("cash_account_id", "unit_id")
        REFERENCES "app"."cash_account"("id", "unit_id")
);

-- Satu rekening = satu sub-pos.
CREATE UNIQUE INDEX IF NOT EXISTS "pos_unit_rekening_uq"
    ON "app"."pos_unit"("cash_account_id") WHERE "cash_account_id" IS NOT NULL;

-- Induk harus pos INDUK resmi, dan kode sub-pos tidak boleh menyamai kode
-- global — kalau sama, kode tersimpan "1101" tak lagi menunjuk satu pos.
-- app.pos tak ber-RLS, jadi terbaca dari sesi mana pun.
CREATE OR REPLACE FUNCTION "app"."pos_unit_jaga"()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "app"."pos" p WHERE p."kode" = NEW."kode_induk" AND p."induk") THEN
    RAISE EXCEPTION 'pos % bukan pos induk — sub-pos hanya bisa dibuat di bawah pos induk', NEW."kode_induk"
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "app"."pos" p WHERE p."kode" = NEW."kode") THEN
    RAISE EXCEPTION 'kode % sudah dipakai daftar pos resmi', NEW."kode"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS "pos_unit_jaga" ON "app"."pos_unit";
CREATE TRIGGER "pos_unit_jaga"
    BEFORE INSERT OR UPDATE ON "app"."pos_unit"
    FOR EACH ROW
    EXECUTE FUNCTION "app"."pos_unit_jaga"();

-- Sub-pos bank untuk satu rekening: nomor bebas terkecil 1111–1119 di unit
-- itu. Sudah punya ⇒ tak berbuat apa-apa (aman dipanggil ulang).
CREATE OR REPLACE FUNCTION "app"."pos_tambah_sub_bank"(p_unit SMALLINT, p_akun UUID, p_nama TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $fn$
DECLARE
  k int;
BEGIN
  IF EXISTS (SELECT 1 FROM "app"."pos_unit" WHERE "cash_account_id" = p_akun) THEN
    RETURN;
  END IF;
  SELECT min(c) INTO k
    FROM generate_series(1111, 1119) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM "app"."pos_unit" p WHERE p."unit_id" = p_unit AND p."kode" = c::text
   );
  IF k IS NULL THEN
    RAISE EXCEPTION 'Sub-pos bank unit ini sudah penuh (1111-1119): rekening "%" tidak bisa didaftarkan. Hubungi Head of Finance.', p_nama
      USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO "app"."pos_unit" ("unit_id", "kode", "nama", "kode_induk", "cash_account_id")
  VALUES (p_unit, k::text, p_nama, '1110', p_akun);
END
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Hak dashboard_app
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    -- Daftar resmi & peta kode lama: lewat migrasi saja.
    GRANT SELECT ON "app"."pos" TO dashboard_app;
    REVOKE INSERT, UPDATE, DELETE ON "app"."pos" FROM dashboard_app;
    GRANT SELECT ON "app"."pos_kode_lama" TO dashboard_app;
    REVOKE INSERT, UPDATE, DELETE ON "app"."pos_kode_lama" FROM dashboard_app;
    -- Sub-pos: tambah (HoF + trigger rekening) dan hapus bila tak dirujuk (R4).
    -- Tanpa UPDATE: kode yang sudah dirujuk tak boleh berpindah arti.
    GRANT SELECT, INSERT, DELETE ON "app"."pos_unit" TO dashboard_app;
    REVOKE UPDATE ON "app"."pos_unit" FROM dashboard_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Seed sub-pos bank untuk rekening yang SUDAH ada (R5)
--
-- 🔴 LETAKNYA DI SINI BUKAN KEBETULAN: seed baris ter-scope unit WAJIB
-- mendahului blok RLS pos_unit di bawah (§4.1b c). cash_account sendiri
-- ber-FORCE RLS, jadi scope dipasang dari public.unit (pola 0049 §7),
-- DIBUKTIKAN dengan hasilnya, lalu dipulihkan. Rekening tidak aktif ikut:
-- mutasi lamanya tetap butuh pos saat jurnal dibentuk.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  scope_lama text := current_setting('app.unit_ids', true);
  r record;
  sisa bigint;
BEGIN
  PERFORM set_config('app.unit_ids',
    COALESCE((SELECT string_agg("unit_id"::text, ',' ORDER BY "unit_id") FROM "public"."unit"), ''),
    true
  );
  IF COALESCE(current_setting('app.unit_ids', true), '') = ''
     AND EXISTS (SELECT 1 FROM "public"."unit")
  THEN
    RAISE EXCEPTION '0056 batal: app.unit_ids kosong padahal public.unit berisi — '
                    'seed sub-pos bank akan menyentuh nol baris tanpa galat';
  END IF;

  FOR r IN
    SELECT a."id", a."unit_id", a."nama"
      FROM "app"."cash_account" a
     WHERE a."kind" = 'bank'
       AND NOT EXISTS (SELECT 1 FROM "app"."pos_unit" p WHERE p."cash_account_id" = a."id")
     ORDER BY a."unit_id", a."created_at", a."id"
  LOOP
    PERFORM "app"."pos_tambah_sub_bank"(r."unit_id", r."id", r."nama");
  END LOOP;

  -- Bukti: tak ada rekening bank tanpa sub-pos.
  SELECT count(*) INTO sisa
    FROM "app"."cash_account" a
   WHERE a."kind" = 'bank'
     AND NOT EXISTS (SELECT 1 FROM "app"."pos_unit" p WHERE p."cash_account_id" = a."id");
  IF sisa > 0 THEN
    RAISE EXCEPTION '0056 batal: % rekening bank tanpa sub-pos', sisa;
  END IF;

  PERFORM set_config('app.unit_ids', COALESCE(scope_lama, ''), true);
END
$$;

-- Rekening bank BARU → sub-pos baru, di transaksi INSERT rekeningnya (R5).
CREATE OR REPLACE FUNCTION "app"."cash_account_pos_bank"()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW."kind" = 'bank' THEN
    PERFORM "app"."pos_tambah_sub_bank"(NEW."unit_id", NEW."id", NEW."nama");
  END IF;
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS "cash_account_pos_bank" ON "app"."cash_account";
CREATE TRIGGER "cash_account_pos_bank"
    AFTER INSERT ON "app"."cash_account"
    FOR EACH ROW
    EXECUTE FUNCTION "app"."cash_account_pos_bank"();

-- RLS — cabang NULL DIPUTUSKAN SADAR: **TIDAK ADA**. Sub-pos selalu milik SATU
-- unit (`unit_id` NOT NULL); pos global hidup di tabelnya sendiri (Keputusan
-- 3). Predikat disalin PERSIS dari 0016 (§4.1b).
DO $$
DECLARE
  t text;
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  ))$p$;
BEGIN
  FOREACH t IN ARRAY ARRAY['pos_unit'] LOOP
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
-- 6. Peta kategori operasional → pos berkode baru (R3; Keputusan 6 & 7)
--
-- category_account_map ber-RLS dengan cabang NULL (0023), jadi baris global
-- terbaca dan lolos WITH CHECK tanpa scope.
-- ---------------------------------------------------------------------------
INSERT INTO "app"."category_account_map"
    ("unit_id", "operational_category", "accounting_account", "effective_from")
SELECT NULL, v."kategori", v."pos", (now() AT TIME ZONE 'Asia/Jakarta')::date
  FROM (VALUES
    ('Gaji Karyawan', '5200'),
    ('Sarana & Prasarana (Listrik, Air, Lampu, Tlpn, Genset, Jalan)', '5300'),
    ('Komputer dan Internet', '5300'),
    ('MDR', '5500'),
    ('Biaya Admin', '5500'),
    ('Peralatan Kantor (ATK)', '5700'),
    ('Maintance Operasional SPBU (Tera, Cleaning Tank, Sabun)', '5700'),
    ('Transportasi / Kendaraan Milik Perusahaan', '5700'),
    ('Supir Tangki', '5700'),
    ('Iklan, Promosi, Spanduk', '5700'),
    ('Sumbangan / Donasi', '5700'),
    ('Konsumsi Makanan, Lembur, & Hiburan', '5700'),
    ('Biaya Taktis', '5700'),
    ('Lain-Lain', '5700')
  ) AS v("kategori", "pos")
 WHERE NOT EXISTS (
   SELECT 1 FROM "app"."category_account_map" m
    WHERE m."unit_id" IS NULL
      AND m."operational_category" = v."kategori"
      AND m."accounting_account" ~ '^[0-9]{4}$'
 )
ON CONFLICT DO NOTHING;

-- Bukti: keempat belas kategori 0023 kini punya baris global berkode baru.
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(DISTINCT m."operational_category") INTO n
    FROM "app"."category_account_map" m
   WHERE m."unit_id" IS NULL AND m."accounting_account" ~ '^[0-9]{4}$';
  IF n < 14 THEN
    RAISE EXCEPTION '0056 batal: hanya % dari 14 kategori operasional berpeta pos baru', n;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    -- Keputusan 6 — membalik REVOKE INSERT 0023 (R4).
    GRANT SELECT, INSERT ON "app"."category_account_map" TO dashboard_app;
    GRANT UPDATE ("accounting_account", "created_by_user_id", "created_at")
       ON "app"."category_account_map" TO dashboard_app;
    REVOKE DELETE ON "app"."category_account_map" FROM dashboard_app;
  END IF;
END
$$;
