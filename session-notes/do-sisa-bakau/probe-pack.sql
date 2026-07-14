-- Per-SO decomposition of getDoHarian sisa for Bakau (unit 2) as of 2026-07-12.
-- Mirrors queries.ts:492-520 exactly, but keeps cnoso and only rows with out_d>0.
WITH red AS (
  SELECT trim(th.cnoso) AS cnoso, trim(td.ckdbbm) AS bbm,
         sum(td.nvolume) FILTER (WHERE th.dtgltbs <= '2026-07-12'::date) AS v_d,
         max(th.dtgltbs) AS last_tebus
  FROM tebus_header th
  JOIN tebus_detail td ON td.unit_id = th.unit_id AND td.ckdtbs = th.ckdtbs
  WHERE th.unit_id = 2 AND COALESCE(th.sbatal,0) = 0
    AND abs(COALESCE(td.nvolume,0)) <= 100000
    AND th.cnoso IS NOT NULL AND th.dtgltbs <= '2026-07-12'::date
  GROUP BY 1, 2
),
rec AS (
  SELECT trim(t.cnoso) AS cnoso, trim(t.ckdbbm) AS bbm,
         sum(t.nvoldo) FILTER (WHERE COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE 'Asia/Jakarta')::date) <= '2026-07-12'::date) AS v_d,
         max(COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE 'Asia/Jakarta')::date)) AS last_terima
  FROM delivery t
  WHERE t.unit_id = 2 AND COALESCE(t.sbatal,0) = 0
    AND abs(COALESCE(t.nvoldo,0)) <= 100000
    AND t.cnoso IS NOT NULL
    AND COALESCE(t.dtgltrm,(t.dtgljam AT TIME ZONE 'Asia/Jakarta')::date) <= '2026-07-12'::date
  GROUP BY 1, 2
)
SELECT COALESCE(red.cnoso, rec.cnoso) AS cnoso,
       COALESCE(red.bbm, rec.bbm) AS bbm,
       COALESCE(p.vcnmbbm, COALESCE(red.bbm, rec.bbm)) AS nama,
       COALESCE(red.v_d,0)::bigint AS tebus,
       COALESCE(rec.v_d,0)::bigint AS terima,
       GREATEST(0, COALESCE(red.v_d,0) - COALESCE(rec.v_d,0))::bigint AS out_d,
       red.last_tebus, rec.last_terima
FROM red FULL JOIN rec ON red.cnoso = rec.cnoso AND red.bbm = rec.bbm
LEFT JOIN product p ON p.unit_id = 2 AND trim(p.ckdbbm) = COALESCE(red.bbm, rec.bbm)
WHERE GREATEST(0, COALESCE(red.v_d,0) - COALESCE(rec.v_d,0)) > 0
ORDER BY nama, out_d DESC, cnoso;
-- ===== Q-A: delivery coverage by year, Bakau (unit 2): H1 (missing receipts) + H2 (CNOSO fill)
SELECT extract(year FROM COALESCE(dtgltrm,(dtgljam AT TIME ZONE 'Asia/Jakarta')::date))::int AS yr,
       count(*) AS rows,
       sum(nvoldo)::bigint AS sum_nvoldo,
       count(*) FILTER (WHERE cnoso IS NULL) AS cnoso_null,
       count(*) FILTER (WHERE cnoso IS NOT NULL AND trim(cnoso)='') AS cnoso_empty,
       count(DISTINCT trim(ckdbbm)) AS produk
FROM delivery WHERE unit_id = 2
GROUP BY 1 ORDER BY 1;

-- ===== Q-B: tebus coverage by year, Bakau
SELECT extract(year FROM th.dtgltbs)::int AS yr,
       count(DISTINCT th.ckdtbs) AS headers,
       sum(td.nvolume)::bigint AS sum_nvolume,
       count(*) FILTER (WHERE th.cnoso IS NULL) AS cnoso_null,
       count(*) FILTER (WHERE th.cnoso IS NOT NULL AND trim(th.cnoso)='') AS cnoso_empty
FROM tebus_header th LEFT JOIN tebus_detail td ON td.unit_id=th.unit_id AND td.ckdtbs=th.ckdtbs
WHERE th.unit_id = 2
GROUP BY 1 ORDER BY 1;

-- ===== Q-C: earliest rows each domain, Bakau
SELECT 'delivery' AS t, min(COALESCE(dtgltrm,(dtgljam AT TIME ZONE 'Asia/Jakarta')::date))::text AS min_d,
       max(COALESCE(dtgltrm,(dtgljam AT TIME ZONE 'Asia/Jakarta')::date))::text AS max_d, count(*) AS n
FROM delivery WHERE unit_id=2
UNION ALL
SELECT 'tebus_header', min(dtgltbs)::text, max(dtgltbs)::text, count(*) FROM tebus_header WHERE unit_id=2;

-- ===== Q-D: ground-truth & twin SOs raw state (tebus side)
SELECT th.ckdtbs, th.dtgltbs, trim(th.cnoso) AS cnoso, th.sbatal, trim(td.ckdbbm) AS bbm, td.nvolume::bigint
FROM tebus_header th LEFT JOIN tebus_detail td ON td.unit_id=th.unit_id AND td.ckdtbs=th.ckdtbs
WHERE th.unit_id=2 AND trim(th.cnoso) IN
  ('4062051864','4062051479','4062323167','4062261261','4062292738','4062261524','4062181552',
   '406353785','4061353785','4036517873','4061071775','4060398878')
ORDER BY th.dtgltbs, cnoso, bbm;

-- ===== Q-E: same SOs, delivery side
SELECT ckdtrm, COALESCE(dtgltrm,(dtgljam AT TIME ZONE 'Asia/Jakarta')::date) AS d, trim(cnoso) AS cnoso,
       trim(cnodo) AS cnodo, trim(ckdbbm) AS bbm, nvoldo::bigint, sbatal
FROM delivery
WHERE unit_id=2 AND trim(cnoso) IN
  ('4062051864','4062051479','4062323167','4062261261','4062292738','4062261524','4062181552',
   '406353785','4061353785','4036517873','4061071775','4060398878')
ORDER BY d, cnoso, bbm;
-- ===== Q-F (H5): unit_id purity under GUC=2 — must return only unit 2
SELECT 'delivery' t, array_agg(DISTINCT unit_id) FROM delivery
UNION ALL SELECT 'tebus_header', array_agg(DISTINCT unit_id) FROM tebus_header
UNION ALL SELECT 'tebus_detail', array_agg(DISTINCT unit_id) FROM tebus_detail;

-- ===== Q-G (H3): duplicate natural keys in mirror?
SELECT 'tebus_header dup ckdtbs' AS chk, count(*) FROM
  (SELECT ckdtbs FROM tebus_header WHERE unit_id=2 GROUP BY ckdtbs HAVING count(*)>1) x
UNION ALL
SELECT 'tebus_detail dup (ckdtbs,ckdbbm)', count(*) FROM
  (SELECT ckdtbs, ckdbbm FROM tebus_detail WHERE unit_id=2 GROUP BY 1,2 HAVING count(*)>1) x
UNION ALL
SELECT 'delivery dup ckdtrm', count(*) FROM
  (SELECT ckdtrm FROM delivery WHERE unit_id=2 GROUP BY ckdtrm HAVING count(*)>1) x
UNION ALL
-- same-day same-cnoso multiple tebus headers (double-entry signature)
SELECT 'tebus same cnoso multi-header', count(*) FROM
  (SELECT trim(cnoso) FROM tebus_header WHERE unit_id=2 AND COALESCE(sbatal,0)=0
   GROUP BY 1 HAVING count(*)>1) x;

-- ===== Q-H: phantom liters classified by age bucket (as of 2026-07-12), Bakau
WITH red AS (
  SELECT trim(th.cnoso) cnoso, trim(td.ckdbbm) bbm, sum(td.nvolume) v, max(th.dtgltbs) lastd
  FROM tebus_header th JOIN tebus_detail td ON td.unit_id=th.unit_id AND td.ckdtbs=th.ckdtbs
  WHERE th.unit_id=2 AND COALESCE(th.sbatal,0)=0 AND abs(COALESCE(td.nvolume,0))<=100000
    AND th.cnoso IS NOT NULL AND th.dtgltbs<='2026-07-12' GROUP BY 1,2),
rec AS (
  SELECT trim(cnoso) cnoso, trim(ckdbbm) bbm, sum(nvoldo) v
  FROM delivery WHERE unit_id=2 AND COALESCE(sbatal,0)=0 AND abs(COALESCE(nvoldo,0))<=100000
    AND cnoso IS NOT NULL AND COALESCE(dtgltrm,(dtgljam AT TIME ZONE 'Asia/Jakarta')::date)<='2026-07-12'
  GROUP BY 1,2),
oso AS (
  SELECT red.cnoso, red.bbm, GREATEST(0, red.v - COALESCE(rec.v,0)) out_d, red.lastd
  FROM red LEFT JOIN rec ON rec.cnoso=red.cnoso AND rec.bbm=red.bbm
  WHERE GREATEST(0, red.v - COALESCE(rec.v,0)) > 0)
SELECT CASE WHEN lastd < '2026-01-01' THEN '1_pre-2026'
            WHEN lastd < '2026-06-12' THEN '2_2026-old(>30d)'
            ELSE '3_recent(<=30d)' END AS bucket,
       count(*) AS so_rows, sum(out_d)::bigint AS liters
FROM oso GROUP BY 1 ORDER BY 1;

-- ===== Q-I: IB (unit 1) — any stale open SO? (validated clean 2026-06-26; regression baseline)
WITH red AS (
  SELECT trim(th.cnoso) cnoso, trim(td.ckdbbm) bbm, sum(td.nvolume) v, max(th.dtgltbs) lastd
  FROM tebus_header th JOIN tebus_detail td ON td.unit_id=th.unit_id AND td.ckdtbs=th.ckdtbs
  WHERE th.unit_id=1 AND COALESCE(th.sbatal,0)=0 AND abs(COALESCE(td.nvolume,0))<=100000
    AND th.cnoso IS NOT NULL AND th.dtgltbs<='2026-07-12' GROUP BY 1,2),
rec AS (
  SELECT trim(cnoso) cnoso, trim(ckdbbm) bbm, sum(nvoldo) v
  FROM delivery WHERE unit_id=1 AND COALESCE(sbatal,0)=0 AND abs(COALESCE(nvoldo,0))<=100000
    AND cnoso IS NOT NULL AND COALESCE(dtgltrm,(dtgljam AT TIME ZONE 'Asia/Jakarta')::date)<='2026-07-12'
  GROUP BY 1,2)
SELECT red.cnoso, red.bbm, (red.v-COALESCE(rec.v,0))::bigint AS out_d, red.lastd
FROM red LEFT JOIN rec ON rec.cnoso=red.cnoso AND rec.bbm=red.bbm
WHERE red.v - COALESCE(rec.v,0) > 0
ORDER BY red.lastd;

-- ===== Q-J: IB earliest coverage (was IB's clean state due to shorter history?)
SELECT 'IB delivery' t, min(COALESCE(dtgltrm,(dtgljam AT TIME ZONE 'Asia/Jakarta')::date))::text,
       max(COALESCE(dtgltrm,(dtgljam AT TIME ZONE 'Asia/Jakarta')::date))::text, count(*) FROM delivery WHERE unit_id=1
UNION ALL
SELECT 'IB tebus', min(dtgltbs)::text, max(dtgltbs)::text, count(*) FROM tebus_header WHERE unit_id=1;
-- Candidate receipt-matching for Bakau stale opens (active products only).
-- For each open (SO,product): orphan/over-received receipt SOs, same product,
-- receipts within [last_tebus-7d, last_tebus+45d], with volumes and CNODO span.
WITH red AS (
  SELECT trim(th.cnoso) cnoso, trim(td.ckdbbm) bbm, sum(td.nvolume) v, max(th.dtgltbs) lastd
  FROM tebus_header th JOIN tebus_detail td ON td.unit_id=th.unit_id AND td.ckdtbs=th.ckdtbs
  WHERE th.unit_id=2 AND COALESCE(th.sbatal,0)=0 AND abs(COALESCE(td.nvolume,0))<=100000
    AND th.cnoso IS NOT NULL GROUP BY 1,2),
rec AS (
  SELECT trim(cnoso) cnoso, trim(ckdbbm) bbm, sum(nvoldo) v,
         min(COALESCE(dtgltrm,(dtgljam AT TIME ZONE 'Asia/Jakarta')::date)) d0,
         max(COALESCE(dtgltrm,(dtgljam AT TIME ZONE 'Asia/Jakarta')::date)) d1,
         string_agg(DISTINCT trim(cnodo), ',') cnodos
  FROM delivery WHERE unit_id=2 AND COALESCE(sbatal,0)=0 AND abs(COALESCE(nvoldo,0))<=100000
    AND cnoso IS NOT NULL GROUP BY 1,2),
stale AS (
  SELECT red.cnoso, red.bbm, red.v tebus, COALESCE(rec.v,0) terima,
         red.v-COALESCE(rec.v,0) open_l, red.lastd
  FROM red LEFT JOIN rec ON rec.cnoso=red.cnoso AND rec.bbm=red.bbm
  WHERE red.v-COALESCE(rec.v,0) > 0 AND red.bbm <> 'BB-01'),
cand AS (
  SELECT rec.cnoso, rec.bbm, rec.v - COALESCE(red.v,0) AS excess, rec.d0, rec.d1, rec.cnodos
  FROM rec LEFT JOIN red ON red.cnoso=rec.cnoso AND red.bbm=rec.bbm
  WHERE rec.v - COALESCE(red.v,0) > 0)
SELECT s.cnoso AS so_open, s.bbm, s.tebus::bigint, s.terima::bigint, s.open_l::bigint,
       s.lastd, c.cnoso AS kandidat_so, c.excess::bigint AS kandidat_l,
       c.d0 AS terima_awal, c.d1 AS terima_akhir
FROM stale s LEFT JOIN cand c
  ON c.bbm = s.bbm AND c.d1 >= s.lastd - 7 AND c.d0 <= s.lastd + 45
ORDER BY s.bbm, s.open_l DESC, s.cnoso, c.d0;
-- 1) Sweep landing evidence: sync_state + row counts + freshest ingested_at, Bakau
SELECT domain, last_run_at, last_row_count FROM sync_state
WHERE unit_id = 2 AND domain IN ('tebus','delivery') ORDER BY domain;

SELECT 'tebus_header' t, count(*) n, max(ingested_at) AS max_ingested FROM tebus_header WHERE unit_id=2
UNION ALL SELECT 'tebus_detail', count(*), max(ingested_at) FROM tebus_detail WHERE unit_id=2
UNION ALL SELECT 'delivery', count(*), max(ingested_at) FROM delivery WHERE unit_id=2;

-- 2) Named sub-checks: TB202600136 / 4062051479 / 4062051864
SELECT th.ckdtbs, th.dtgltbs, trim(th.cnoso) cnoso, th.sbatal, trim(td.ckdbbm) bbm, td.nvolume::bigint
FROM tebus_header th LEFT JOIN tebus_detail td ON td.unit_id=th.unit_id AND td.ckdtbs=th.ckdtbs
WHERE th.unit_id=2 AND (th.ckdtbs='TB202600136' OR trim(th.cnoso) IN ('4062051479','4062051864'))
ORDER BY th.ckdtbs, bbm;

-- 3) PREMIUM (BB-01) residual open in mirror after rescan
WITH red AS (
  SELECT trim(th.cnoso) cnoso, trim(td.ckdbbm) bbm, sum(td.nvolume) v
  FROM tebus_header th JOIN tebus_detail td ON td.unit_id=th.unit_id AND td.ckdtbs=th.ckdtbs
  WHERE th.unit_id=2 AND COALESCE(th.sbatal,0)=0 AND abs(COALESCE(td.nvolume,0))<=100000
    AND th.cnoso IS NOT NULL GROUP BY 1,2),
rec AS (
  SELECT trim(cnoso) cnoso, trim(ckdbbm) bbm, sum(nvoldo) v
  FROM delivery WHERE unit_id=2 AND COALESCE(sbatal,0)=0 AND abs(COALESCE(nvoldo,0))<=100000
    AND cnoso IS NOT NULL GROUP BY 1,2)
SELECT count(*) premium_so_rows, COALESCE(sum(GREATEST(0, red.v - COALESCE(rec.v,0))),0)::bigint AS premium_liters
FROM red LEFT JOIN rec ON rec.cnoso=red.cnoso AND rec.bbm=red.bbm
WHERE red.bbm = 'BB-01' AND red.v - COALESCE(rec.v,0) > 0;
