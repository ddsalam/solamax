-- F1 · Probe kesegaran snapshot piutang — MATERIALITAS, bukan watermark polos.
--
-- Pertanyaan yang dijawab: "sejak cut T′ yang membangun snapshot tanggal D,
-- adakah perubahan di mirror yang DAPAT mengubah angka tanggal D — dan berapa
-- rupiahnya?"  Bukan "adakah perubahan apa pun" (itu menyala sepanjang hari
-- untuk transaksi masa depan) dan bukan "apakah pointer pending_replacement"
-- (itu hanya menyala saat ada cut `complete` — sekali sehari 02:05 WIB).
--
-- ── KENAPA HIMPUNAN KANDIDATNya LENGKAP ─────────────────────────────────────
-- 1. `bppiut`/`bphut` di-`skipUnchanged` (table-config.ts:257-273), jadi
--    `ingested_at` berarti "kapan baris ini terakhir BERUBAH", bukan "kapan
--    terakhir disentuh sinkronisasi". Cadence full-sync yang tidak mengubah apa
--    pun TIDAK menggeser `ingested_at` satu baris pun — ini tertulis eksplisit
--    di table-config.ts:57-60.
-- 2. Tidak ada jalur DELETE untuk kedua tabel ini (`sql.ts` hanya menghapus
--    business_date/terra_resmi/delivery/tebus). Baris tidak pernah hilang, jadi
--    "keluar dari bucket" hanya bisa lewat `sbatal` atau perpindahan `dtgl` —
--    keduanya UPDATE, keduanya menggeser `ingested_at`.
-- ⇒ `ingested_at > T′` menangkap SELURUH perubahan sesudah cut. Bukan heuristik.
--
-- ── EMPAT BENTUK PERUBAHAN, SATU RUMUS ──────────────────────────────────────
-- Kontribusi satu baris terhadap tanggal D:
--     contrib = (sbatal = 0 AND dtgl <= D) ? njumlah · tanda(sjnsbp) : 0
-- Δ baris = contrib(keadaan SEKARANG) − contrib(keadaan DI CUT)
--   · insert          → baris tak ada di cut, contrib_cut = 0
--   · update nilai    → selisih njumlah/sjnsbp
--   · pembatalan      → contrib_sekarang = 0, Δ negatif
--   · pindah tanggal  → melintas D dari sisi mana pun; KEDUA arah menghasilkan
--                       Δ ≠ 0 karena salah satu contrib jatuh ke 0
-- Perubahan yang TIDAK material (mis. transaksi ber-dtgl di masa depan, yang
-- tidak pernah menyentuh D) memberi Δ = 0 di kedua sisi ⇒ banner TIDAK menyala.
--
-- ── BATAS YANG DIAKUI (wajib ikut ke layar) ─────────────────────────────────
-- `pelanggan_master` TIDAK punya `ingested_at` (table-config.ts:276-281), jadi
-- probe ini TIDAK mendeteksi perubahan KLASIFIKASI master — pelanggan yang
-- `sjenis`-nya berubah (mis. 1 → 4) berpindah bucket tanpa satu pun baris
-- bppiut/bphut ikut berubah, dan probe ini akan diam. Klasifikasi di sini
-- memakai potret master DI CUT, sama seperti yang dipakai snapshot.
--
-- Parameter psql: :unit  :as_of  :cut_id  :cut_at
\set ON_ERROR_STOP on

WITH cut_master AS (
  SELECT btrim(ckdplg) AS code, sjenis
  FROM app.saldo_pelanggan_source_pelanggan
  WHERE unit_id = :unit AND source_cycle_id = :'cut_id'
),
changed_piut AS (
  SELECT btrim(ckdbppiut) AS k, btrim(ckdplg) AS code, dtgl, sjnsbp, njumlah,
         COALESCE(sbatal, 0) AS sbatal, ingested_at
  FROM public.bppiut
  WHERE unit_id = :unit AND ingested_at > :'cut_at'::timestamptz
),
cut_piut AS (
  SELECT btrim(ckdbppiut) AS k, btrim(ckdplg) AS code, dtgl, sjnsbp, njumlah,
         COALESCE(sbatal, 0) AS sbatal
  FROM app.saldo_pelanggan_source_bppiut
  WHERE unit_id = :unit AND source_cycle_id = :'cut_id'
    AND btrim(ckdbppiut) IN (SELECT k FROM changed_piut)
),
changed_hut AS (
  SELECT btrim(ckdbphut) AS k, dtgl, sjnsbp, njumlah,
         COALESCE(sbatal, 0) AS sbatal, ingested_at
  FROM public.bphut
  WHERE unit_id = :unit AND ingested_at > :'cut_at'::timestamptz
),
cut_hut AS (
  SELECT btrim(ckdbphut) AS k, dtgl, sjnsbp, njumlah, COALESCE(sbatal, 0) AS sbatal
  FROM app.saldo_pelanggan_source_bphut
  WHERE unit_id = :unit AND source_cycle_id = :'cut_id'
    AND btrim(ckdbphut) IN (SELECT k FROM changed_hut)
),
-- Bucket ditentukan format kode (bertitik = Online) dan, untuk yang tak
-- bertitik, `sjenis IN (1,5)` di master — dua sumbu, sama seperti getSaldoPelanggan.
piut_delta AS (
  SELECT
    CASE WHEN position('.' in COALESCE(n.code, o.code)) > 0 THEN 'piutang_online'
         WHEN EXISTS (SELECT 1 FROM cut_master m
                      WHERE m.code = COALESCE(n.code, o.code) AND m.sjenis IN (1, 5))
           THEN 'piutang_lokal'
         ELSE 'di_luar_bucket' END AS bucket,
    COALESCE(n.k, o.k) AS k,
    COALESCE(CASE WHEN n.sbatal = 0 AND n.dtgl <= :'as_of'::date
                  THEN n.njumlah * CASE n.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END END, 0)
    - COALESCE(CASE WHEN o.sbatal = 0 AND o.dtgl <= :'as_of'::date
                    THEN o.njumlah * CASE o.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END END, 0)
      AS delta,
    n.ingested_at
  FROM changed_piut n FULL JOIN cut_piut o USING (k)
),
hut_delta AS (
  SELECT 'hutang_lokal' AS bucket, COALESCE(n.k, o.k) AS k,
    -- Hutang dinegasikan, konsisten dengan getSaldoPelanggan.
    -( COALESCE(CASE WHEN n.sbatal = 0 AND n.dtgl <= :'as_of'::date
                     THEN n.njumlah * CASE n.sjnsbp WHEN 2 THEN 1 WHEN 1 THEN -1 ELSE 0 END END, 0)
     - COALESCE(CASE WHEN o.sbatal = 0 AND o.dtgl <= :'as_of'::date
                     THEN o.njumlah * CASE o.sjnsbp WHEN 2 THEN 1 WHEN 1 THEN -1 ELSE 0 END END, 0) )
      AS delta,
    n.ingested_at
  FROM changed_hut n FULL JOIN cut_hut o USING (k)
),
semua AS (SELECT * FROM piut_delta UNION ALL SELECT * FROM hut_delta)
SELECT
  bucket,
  count(*) FILTER (WHERE delta <> 0)              AS baris_material,
  COALESCE(sum(delta) FILTER (WHERE delta <> 0), 0) AS delta_rupiah,
  max(ingested_at) FILTER (WHERE delta <> 0)      AS perubahan_terakhir,
  count(*)                                        AS baris_tersentuh
FROM semua
WHERE bucket <> 'di_luar_bucket'
GROUP BY bucket
ORDER BY bucket;
