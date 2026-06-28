-- EDC idempotensi: jaring anti-kembar utk path REPLACE-per-(unit_id, business_date).
--
-- TEMUAN. `edc` (sumber vw_edc3, tanpa SBATAL) memakai surrogate id + REPLACE
-- (DELETE business_date lalu INSERT). REPLACE idempoten utk kirim-ulang BERURUTAN,
-- tetapi TIDAK aman saat dua /ingest BERSAMAAN (retry agent menimpa request yang
-- masih commit): pada business_date yang belum berisi, masing-masing DELETE tak
-- melihat baris uncommitted lawan → keduanya INSERT → baris kembar. Insiden:
-- unit 1, business_date 2026-06-22, dua batch 382 baris (ingested_at selisih ~18ms)
-- → EDC harian ganda di Rincian Penjualan & Summary D.
--
-- KUNCI NATURAL (tervalidasi data-live 2022–2026, 273k baris, 1403 batch bersih):
--   (unit_id, business_date, cshift, tanggaljam, nonozle, cnotrace, ckdkartu, total)
-- 0 tabrakan HANYA dengan NULLS NOT DISTINCT — ckdkartu (~19k) & cnotrace (~24k)
-- sering NULL (blank-card); index NULLS DISTINCT akan MELEWATKAN kembar blank-card
-- & ON CONFLICT tak menyala utk baris NULL. cshift WAJIB: baris blank-card muncul
-- lintas-shift dgn tanggaljam/nozzle/total identik (beda hanya shift). total WAJIB:
-- memisah dua pour sama-detik/nozzle beda nominal. (jrnkey = business_date*10+cshift,
-- BUKAN id baris → tak menambah keunikan; tak dipakai sbg kunci.)
--
-- Index dipakai sbg (a) jaring DB anti-kembar + (b) arbiter ON CONFLICT di
-- backend buildReplace (sql.ts). ADDITIVE (dedup + CREATE INDEX; tanpa ALTER TYPE).

-- 1) Dedup baris kembar eksisting: pertahankan id TERKECIL per kunci natural.
--    COALESCE menyamakan NULL (selaras NULLS NOT DISTINCT); cnotrace/ckdkartu tak
--    pernah '' di data (hanya NULL) → COALESCE(...,'') aman tanpa tabrak nilai asli.
DELETE FROM "public"."edc"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "unit_id", "business_date", "cshift", "tanggaljam", "nonozle",
                   COALESCE("cnotrace", ''), COALESCE("ckdkartu", ''), "total"
      ORDER BY "id"
    ) AS rn
    FROM "public"."edc"
  ) t WHERE t.rn > 1
);

-- 2) Index unik NULLS NOT DISTINCT (PG15+). Nama sama dgn @@unique schema.prisma.
CREATE UNIQUE INDEX "edc_natural_key"
  ON "public"."edc" (
    "unit_id", "business_date", "cshift", "tanggaljam", "nonozle",
    "cnotrace", "ckdkartu", "total"
  ) NULLS NOT DISTINCT;
