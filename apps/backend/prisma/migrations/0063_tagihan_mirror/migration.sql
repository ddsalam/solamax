-- 0063_tagihan_mirror — cermin modul tagihan pelanggan kredit EasyMax (domain
-- sync `tagihan`). Rencana 2026-11-13 U1 (KTD1–KTD3, KTD11).
--
-- ADDITIVE: empat tabel baru + satu index pada `bppiut`. Tak ada ALTER pada tabel
-- yang sudah ada, tak ada backfill. Sumber (SELECT-only, snapshot penuh tiap siklus):
--   tr_htagihan (header faktur) · tr_dtagihan (faktur → dokumen penjualan) ·
--   tr_byrtagih (pembayaran faktur).
--
-- Dicerminkan APA ADANYA (KTD3): flag status EasyMax, sisa versi POS, jatuh tempo
-- mentah dan baris batal ikut. Tanggal nol EasyMax menjadi NULL — karena itu
-- kolom tanggal NULLABLE (beda dari bppiut): satu baris bertanggal rusak tak
-- boleh menggagalkan seluruh potongan. Status faktur TIDAK disimpan (KTD4).
--
-- Tipe kunci: CHAR(n) (bpchar) seperti kunci mirror lain — perbandingan
-- mengabaikan spasi pengisi, jadi pemangkasan `= ANY($n::bpchar[])` di jalur
-- ingest kebal terhadap beda padding antara sumber dan payload.

-- CreateTable tagihan_header — UPSERT by (unit_id, ckdtagih).
-- ⚠️ Recon awal mencatat 13 kolom di tr_htagihan; 12 yang dikenal ada di sini.
-- Kolom ke-13 dikonfirmasi lewat DESCRIBE di unit pertama sebelum kueri agent
-- difinalkan; bila perlu dicerminkan, ia datang lewat migrasi BARU (ADD COLUMN).
CREATE TABLE "public"."tagihan_header" (
    "unit_id" SMALLINT NOT NULL,
    "ckdtagih" CHAR(15) NOT NULL,
    "dtgl" DATE,
    "dtgljt" DATE,
    "ckdplg" VARCHAR(12),
    "vcket" TEXT,
    "ntotal" DECIMAL,
    "nadm" DECIMAL,
    "ngatot" DECIMAL,
    "nstatus" SMALLINT,
    "sbatal" SMALLINT,
    "vcalasan" TEXT,
    "nlastsaldo" DECIMAL,
    "sjenistag" SMALLINT,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tagihan_header_pkey" PRIMARY KEY ("unit_id","ckdtagih")
);

-- CreateTable tagihan_detail — tautan faktur → dokumen penjualan. Sumber tanpa PK;
-- kunci mirror (unit_id, ckdtagih, ckdjualplg). `ckdjualplg` CHAR(20): selebar
-- `bppiut.vcref` (pasangan join-nya), bukan 15 — dokumen yang lebih panjang
-- daripada dugaan tak boleh menggagalkan INSERT seluruh potongan.
-- `ingested_at` = kapan tautan PERTAMA terlihat (INSERT … ON CONFLICT DO NOTHING).
CREATE TABLE "public"."tagihan_detail" (
    "unit_id" SMALLINT NOT NULL,
    "ckdtagih" CHAR(15) NOT NULL,
    "ckdjualplg" CHAR(20) NOT NULL,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tagihan_detail_pkey" PRIMARY KEY ("unit_id","ckdtagih","ckdjualplg")
);

-- CreateTable tagihan_bayar — UPSERT by (unit_id, ckdbyr).
CREATE TABLE "public"."tagihan_bayar" (
    "unit_id" SMALLINT NOT NULL,
    "ckdbyr" CHAR(15) NOT NULL,
    "dtgl" DATE,
    "ckdtagih" CHAR(15),
    "vcbukti" TEXT,
    "vcket" TEXT,
    "ctmpkas" TEXT,
    "ntotal" DECIMAL,
    "sbatal" SMALLINT,
    "vcalasan" TEXT,
    "capprovecode" TEXT,
    "cnamereq" TEXT,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tagihan_bayar_pkey" PRIMARY KEY ("unit_id","ckdbyr")
);

-- CreateTable tagihan_cycle — siklus LENGKAP terakhir per unit (KTD11). Ditulis
-- HANYA oleh transaksi manifest (pangkas + stempel, satu commit). Inilah sumber
-- kesiapan & kesegaran layar tagihan — BUKAN sync_state, yang ikut maju pada
-- payload parsial mana pun. Tanpa baris = unit belum pernah menyelesaikan siklus.
-- `header_count`/`bayar_count` = jumlah kunci di manifest (pembanding gold-check).
CREATE TABLE "public"."tagihan_cycle" (
    "unit_id" SMALLINT NOT NULL,
    "cycle_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ NOT NULL,
    "header_count" INTEGER NOT NULL,
    "bayar_count" INTEGER NOT NULL,

    CONSTRAINT "tagihan_cycle_pkey" PRIMARY KEY ("unit_id"),
    CONSTRAINT "tagihan_cycle_count_nonnegative"
        CHECK ("header_count" >= 0 AND "bayar_count" >= 0)
);

-- CreateIndex — faktur per pelanggan / per tanggal; tautan per dokumen (anti-join
-- "belum ditagihkan"); pembayaran per faktur / per tanggal. Tautan per faktur
-- sudah dilayani PK-nya.
CREATE INDEX "tagihan_header_unit_id_ckdplg_idx" ON "public"."tagihan_header"("unit_id", "ckdplg");
CREATE INDEX "tagihan_header_unit_id_dtgl_idx" ON "public"."tagihan_header"("unit_id", "dtgl");
CREATE INDEX "tagihan_detail_unit_id_ckdjualplg_idx" ON "public"."tagihan_detail"("unit_id", "ckdjualplg");
CREATE INDEX "tagihan_bayar_unit_id_ckdtagih_idx" ON "public"."tagihan_bayar"("unit_id", "ckdtagih");
CREATE INDEX "tagihan_bayar_unit_id_dtgl_idx" ON "public"."tagihan_bayar"("unit_id", "dtgl");

-- ---------------------------------------------------------------------------
-- Hak akses — eksplisit, tak bergantung pada ALTER DEFAULT PRIVILEGES di luar git.
--   ingest        : DML penuh (UPSERT + pangkas).
--   dashboard_app : SELECT saja — mirror EasyMax tak pernah ditulis dashboard.
--   dashboard_ro  : SELECT.
-- Tiap role dijaga IF EXISTS: di dev lokal / basis data CI role bisa belum ada,
-- dan migrasi tak boleh gagal karenanya (pola 0013 & 0060).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingest') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."tagihan_header" TO ingest;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."tagihan_detail" TO ingest;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."tagihan_bayar" TO ingest;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."tagihan_cycle" TO ingest;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT ON "public"."tagihan_header" TO dashboard_app;
    GRANT SELECT ON "public"."tagihan_detail" TO dashboard_app;
    GRANT SELECT ON "public"."tagihan_bayar" TO dashboard_app;
    GRANT SELECT ON "public"."tagihan_cycle" TO dashboard_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_ro') THEN
    GRANT SELECT ON "public"."tagihan_header" TO dashboard_ro;
    GRANT SELECT ON "public"."tagihan_detail" TO dashboard_ro;
    GRANT SELECT ON "public"."tagihan_bayar" TO dashboard_ro;
    GRANT SELECT ON "public"."tagihan_cycle" TO dashboard_ro;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- RLS unit-scoped — 0016 hanya menyapu tabel yang ada saat ia jalan; tabel yang
-- lahir sesudahnya WAJIB memasang RLS-nya sendiri. Predikat disalin PERSIS dari
-- 0016 (lewat 0049); jangan dirapikan. Tanpa cabang NULL: keempat tabel selalu
-- milik satu unit (kolomnya NOT NULL).
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
  FOREACH t IN ARRAY ARRAY['tagihan_header', 'tagihan_detail', 'tagihan_bayar', 'tagihan_cycle'] LOOP
    EXECUTE format('ALTER TABLE "public".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "public".%I FORCE ROW LEVEL SECURITY',  t);
    EXECUTE format('DROP POLICY IF EXISTS unit_scope ON "public".%I',   t);
    EXECUTE format(
      'CREATE POLICY unit_scope ON "public".%I USING (%s) WITH CHECK (%s)',
      t, predicate, predicate
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Index pada cermin buku piutang untuk join dokumen: tautan faktur ↔ posting
-- piutang (rincian faktur & kelompok "belum ditagihkan", KTD8).
--
-- KEPUTUSAN: index EKSPRESI atas btrim(vcref), bukan atas vcref polos.
-- Seluruh kueri yang sudah ada membandingkan referensi ini sebagai `trim(vcref)`
-- (queries.ts: `trim(bt.vcref) = trim(p.ckdjualplg)`, `trim(vcref) AS ref`), dan
-- Postgres mengurai `trim(x)` menjadi `btrim(x)` — jadi predikat
-- `trim(b.vcref) = …` memakai index ini apa adanya. Index atas `vcref` polos
-- TIDAK akan pernah dipakai oleh bentuk ber-trim itu, dan mewajibkan kueri baru
-- meninggalkan konvensi yang sama persis dengan cara data ini dibaca di tempat
-- lain. Ongkosnya disebut: predikat `vcref = …` TANPA trim tak terlayani index
-- ini — tulis `trim(b.vcref) = <nilai tanpa spasi pengisi>`.
--
-- Bukan index parsial: bentuk kueri KTD8 belum final, dan predikat parsial yang
-- tak terbukti tersirat oleh kueri membuat index-nya diam-diam tak terpakai.
--
-- ⚠️ CREATE INDEX biasa (bukan CONCURRENTLY — migrasi Prisma berjalan dalam
-- transaksi) memegang kunci SHARE pada bppiut selama build: BACA tetap jalan,
-- TULIS (ingest domain piutang) menunggu. Ingest yang kena timeout diulang
-- sendiri oleh agent. Tanpa Prisma `@@index` (index ekspresi tak dimodelkan).
-- ---------------------------------------------------------------------------
CREATE INDEX "bppiut_unit_id_vcref_trim_idx" ON "public"."bppiut" ("unit_id", btrim("vcref"));
