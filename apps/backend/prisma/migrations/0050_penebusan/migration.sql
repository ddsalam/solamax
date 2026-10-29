-- 0050_penebusan — penebusan BBM per nomor SO dengan komponen pajak terpisah.
--
-- Rencana: docs/plans/2026-10-29-1719-feat-keuangan-pihak-lawan-penebusan-impor-bank-plan.md
-- (U7; R10–R16, R29; KTD9).
--
--   app.penebusan — satu pembayaran penebusan per (unit, SO), MEMILIKI satu
--                   baris kas "Pembelian BBM" sebesar Gross.
--
-- ⛔ KEPUTUSAN YANG MENGIKAT:
--
-- 1. **Net + PPN + PPh + PBBKB + Nota = Gross, tepat Rp 0, DITEGAKKAN DB**
--    (R10, KTD9). Numerik `DECIMAL(17,2)`, tanpa toleransi, tanpa float. Aksi
--    memeriksa lebih dulu supaya pesannya menyebut selisihnya; CHECK ini yang
--    menjamin tak ada jalan lain.
-- 2. **Penebusan MEMILIKI baris kasnya, bukan menambah baris arus kedua**
--    (KTD9, R16, R29). Arus kas "Penebusan SO" tetap Σ baris kas kategori
--    Pembelian BBM; penebusan hanya menautnya (`cash_ledger_id`, unik di antara
--    yang tidak void). Baris kas itu dibuat penebusan (`kas_dibuat = true`)
--    atau sudah diketik manual lebih dulu dan diikat (`kas_dibuat = false`) —
--    pembatalan hanya mem-void baris kas yang memang dibuatnya.
-- 3. **HPP / harga beli / laba TIDAK disentuh** (Key Decision "Komponen pajak
--    disimpan terpisah; HPP tetap Gross ÷ liter", R14). Tak ada kolom, trigger,
--    atau tautan ke `purchase_price` di sini.
-- 4. **SO disimpan ternormalisasi `lower(btrim())`** — konvensi `so_macet`
--    (0028) dan join `lower(trim(cnoso))` di kueri EasyMax. Ditegakkan CHECK.
-- 5. **Tanpa unggah bukti** (Key Decision "Komponen pajak diketik, tanpa
--    unggah bukti"): tak ada kolom berkas.
--
-- Idempoten / aman re-run.

CREATE TABLE IF NOT EXISTS "app"."penebusan" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"            SMALLINT NOT NULL,
    -- Ternormalisasi lower(btrim()) — keputusan 4.
    "no_so"              TEXT NOT NULL,
    -- Tanggal debit bank (tanggal transaksi). Hari bukunya ada di baris kas.
    "tanggal_bayar"      DATE NOT NULL,
    "account_id"         UUID NOT NULL,
    "net"                DECIMAL(17,2) NOT NULL,
    "ppn"                DECIMAL(17,2) NOT NULL,
    "pph"                DECIMAL(17,2) NOT NULL,
    "pbbkb"              DECIMAL(17,2) NOT NULL,
    -- BERTANDA: nota debet menambah (+), nota kredit mengurangi (−).
    "nota"               DECIMAL(17,2) NOT NULL DEFAULT 0,
    "gross"              DECIMAL(17,2) NOT NULL,
    "cash_ledger_id"     UUID NOT NULL,
    -- true = baris kas lahir dari penebusan ini; false = baris manual yang diikat.
    "kas_dibuat"         BOOLEAN NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "void"               BOOLEAN NOT NULL DEFAULT false,
    "voided_by_user_id"  INTEGER,
    "voided_at"          TIMESTAMPTZ,

    CONSTRAINT "penebusan_pkey" PRIMARY KEY ("id"),
    -- FK komposit (idiom 0019/0029): rekening & baris kas milik unit yang SAMA.
    -- FK Postgres mengabaikan RLS, jadi tanpa unit_id di kuncinya penebusan
    -- unit A bisa menunjuk baris kas unit B.
    CONSTRAINT "penebusan_account_fk" FOREIGN KEY ("account_id", "unit_id")
        REFERENCES "app"."cash_account"("id", "unit_id"),
    CONSTRAINT "penebusan_cash_ledger_fk" FOREIGN KEY ("cash_ledger_id", "unit_id")
        REFERENCES "app"."cash_ledger"("id", "unit_id"),
    CONSTRAINT "penebusan_no_so_normal" CHECK (
        "no_so" = lower(btrim("no_so")) AND "no_so" <> ''
    ),
    -- Baris kasnya kredit (cash_ledger_tanda: amount < 0) sebesar −Gross.
    CONSTRAINT "penebusan_gross_positif" CHECK ("gross" > 0),
    -- 🔴 R10 / KTD9 — keputusan 1.
    CONSTRAINT "penebusan_jumlah_komponen" CHECK (
        "net" + "ppn" + "pph" + "pbbkb" + "nota" = "gross"
    ),
    CONSTRAINT "penebusan_void_audit" CHECK (
        "void" = ("voided_at" IS NOT NULL) AND "void" = ("voided_by_user_id" IS NOT NULL)
    )
);

-- Satu penebusan aktif per (unit, SO). SO dibayar dua debit = SATU penebusan
-- (KTD9; kelompok cocok 2:1 di U10), bukan dua.
CREATE UNIQUE INDEX IF NOT EXISTS "penebusan_so_aktif_uq"
    ON "app"."penebusan"("unit_id", "no_so") WHERE NOT "void";
-- Satu baris kas dimiliki paling banyak SATU penebusan aktif — tanpa ini dua
-- SO bisa mengikat debit yang sama dan arus kasnya tampak lunas dua kali.
CREATE UNIQUE INDEX IF NOT EXISTS "penebusan_cash_ledger_aktif_uq"
    ON "app"."penebusan"("cash_ledger_id") WHERE NOT "void";
-- Rekap pajak bulanan (R13).
CREATE INDEX IF NOT EXISTS "penebusan_rekap_idx"
    ON "app"."penebusan"("unit_id", "tanggal_bayar") WHERE NOT "void";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."penebusan" TO dashboard_app;
    REVOKE DELETE ON "app"."penebusan" FROM dashboard_app;
  END IF;
END
$$;

-- Tanpa seed: tabel ini lahir kosong (§4.1b c tetap dipatuhi — tak ada INSERT
-- ter-scope unit di bawah blok RLS).

-- RLS — cabang NULL DIPUTUSKAN SADAR: **TIDAK ADA**. Setiap penebusan milik
-- satu unit (`unit_id` NOT NULL); tak ada penebusan berlaku-global. Predikat
-- disalin PERSIS dari 0016 (§4.1b).
DO $$
DECLARE
  t text;
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  ))$p$;
BEGIN
  FOREACH t IN ARRAY ARRAY['penebusan'] LOOP
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
