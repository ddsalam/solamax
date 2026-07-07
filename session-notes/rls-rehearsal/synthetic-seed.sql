-- synthetic-seed.sql — SYNTHETIC multi-tenant fixture (NEVER live data).
-- Run as SUPERUSER (bypasses RLS) so rows insert freely across units.
-- Shape: 1 PT tenant "SolaGroup" (renamed to PT Sola Petra Abadi in the rename
-- rehearsal) owning IB-equiv (unit 1) + Bakau-equiv (unit 2); a FOREIGN tenant
-- owning unit 99. Row counts per unit are distinct (u1=2, u2=3, u99=1 sales_detail)
-- so RLS filtering is unambiguous in evidence.

BEGIN;

-- Tenants
INSERT INTO app.tenant (id, name, slug) VALUES
  ('11111111-1111-1111-1111-111111111111', 'SolaGroup',      'solagroup'),
  ('22222222-2222-2222-2222-222222222222', 'PT Synthetic B', 'synthetic-b')
ON CONFLICT (id) DO NOTHING;

-- Units (api_key_hash is NOT NULL UNIQUE — synthetic distinct values)
INSERT INTO public.unit (unit_id, code, name, api_key_hash, tenant_id) VALUES
  (1,  '6478111', 'IB-equiv (synthetic)',      'synthetic-hash-ib',      '11111111-1111-1111-1111-111111111111'),
  (2,  '6378301', 'Bakau-equiv (synthetic)',   'synthetic-hash-bakau',   '11111111-1111-1111-1111-111111111111'),
  (99, '9999999', 'Foreign-equiv (synthetic)', 'synthetic-hash-foreign', '22222222-2222-2222-2222-222222222222')
ON CONFLICT (unit_id) DO NOTHING;

-- Users
INSERT INTO app.users (id, name, email) VALUES
  (1, 'Direksi PT',       'direksi@syn.test'),
  (2, 'Pengawas IB',      'peng-ib@syn.test'),
  (3, 'Pengawas Bakau',   'peng-bakau@syn.test'),
  (4, 'Pengawas Foreign', 'peng-foreign@syn.test')
ON CONFLICT (id) DO NOTHING;
SELECT setval('app.users_id_seq', 10);

-- Memberships (fixed uuids so user_unit FK is deterministic)
INSERT INTO app.membership (id, user_id, tenant_id, role) VALUES
  ('a0000000-0000-0000-0000-000000000001', 1, '11111111-1111-1111-1111-111111111111', 'direksi'),
  ('a0000000-0000-0000-0000-000000000002', 2, '11111111-1111-1111-1111-111111111111', 'pengawas'),
  ('a0000000-0000-0000-0000-000000000003', 3, '11111111-1111-1111-1111-111111111111', 'pengawas'),
  ('a0000000-0000-0000-0000-000000000004', 4, '22222222-2222-2222-2222-222222222222', 'pengawas')
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- user_unit: pengawas scoped to one unit each (direksi has none → role sees all).
INSERT INTO app.user_unit (membership_id, unit_id) VALUES
  ('a0000000-0000-0000-0000-000000000002', 1),
  ('a0000000-0000-0000-0000-000000000003', 2),
  ('a0000000-0000-0000-0000-000000000004', 99)
ON CONFLICT DO NOTHING;

-- Product master (per-unit; note same conceptual product, unit-specific code)
INSERT INTO public.product (unit_id, ckdbbm, vcnmbbm) VALUES
  (1,  'BB-02', 'PERTAMAX'),
  (2,  'BB-07', 'PERTALITE'),
  (99, 'BB-03', 'SOLAR')
ON CONFLICT (unit_id, ckdbbm) DO NOTHING;

-- Sales headers
INSERT INTO public.sales_header (unit_id, ckdjualbbm, dtgljual, nshift) VALUES
  (1,  'JB-U1', '2026-07-01', 1),
  (2,  'JB-U2', '2026-07-01', 1),
  (99, 'JB-U9', '2026-07-01', 1)
ON CONFLICT (unit_id, ckdjualbbm) DO NOTHING;

-- Sales details: u1=2 rows, u2=3 rows, u99=1 row (distinct counts)
INSERT INTO public.sales_detail (unit_id, ckdjualbbm, ckdnozzle, nurut, nvolume, nsubtotal, ckdbbm, dtgljam) VALUES
  (1,  'JB-U1', 'N01', 1, 100, 1000000, 'BB-02', '2026-07-01 08:00+07'),
  (1,  'JB-U1', 'N01', 2,  50,  500000, 'BB-02', '2026-07-01 09:00+07'),
  (2,  'JB-U2', 'N01', 1, 200, 2000000, 'BB-07', '2026-07-01 08:00+07'),
  (2,  'JB-U2', 'N01', 2, 200, 2000000, 'BB-07', '2026-07-01 09:00+07'),
  (2,  'JB-U2', 'N02', 1, 100, 1000000, 'BB-07', '2026-07-01 10:00+07'),
  (99, 'JB-U9', 'N01', 1, 300, 3000000, 'BB-03', '2026-07-01 08:00+07')
ON CONFLICT DO NOTHING;

-- sync_state per unit
INSERT INTO public.sync_state (unit_id, domain, last_watermark, last_run_at, last_row_count) VALUES
  (1,  'sales', now(), now(), 2),
  (2,  'sales', now(), now(), 3),
  (99, 'sales', now(), now(), 1)
ON CONFLICT (unit_id, domain) DO NOTHING;

COMMIT;

-- Snapshot (superuser sees all): expect u1=2, u2=3, u99=1
SELECT unit_id, count(*) AS sales_detail_rows FROM public.sales_detail GROUP BY unit_id ORDER BY unit_id;

-- ── ENRICHMENT: rows across surface tables (u1=2, u2=1) so the full-app-under-RLS
--    count-equality proof exercises NON-zero scoping (board/monitoring/rincian/usulan).
BEGIN;
INSERT INTO public.opname (unit_id,ckdopnbbm,ckdtangki,dtgljam) VALUES
  (1,'OP-1','T-01','2026-07-01 06:00+07'),(1,'OP-2','T-02','2026-07-01 06:00+07'),(2,'OP-3','T-01','2026-07-01 06:00+07') ON CONFLICT DO NOTHING;
INSERT INTO public.delivery (unit_id,ckdtrm,dtgljam) VALUES
  (1,'TR-1','2026-07-01 05:00+07'),(1,'TR-2','2026-07-01 05:00+07'),(2,'TR-3','2026-07-01 05:00+07') ON CONFLICT DO NOTHING;
INSERT INTO public.real_tank (unit_id,ckdtangki,dtanggaljam) VALUES
  (1,'T-01','2026-07-01 06:00+07'),(1,'T-02','2026-07-01 06:00+07'),(2,'T-01','2026-07-01 06:00+07') ON CONFLICT DO NOTHING;
INSERT INTO public.nozzle (unit_id,ckdnozzle) VALUES (1,'N01'),(1,'N02'),(2,'N01') ON CONFLICT DO NOTHING;
INSERT INTO public.deposit (unit_id,ckddepo,dtgl) VALUES
  (1,'DP-1','2026-07-01'),(1,'DP-2','2026-07-01'),(2,'DP-3','2026-07-01') ON CONFLICT DO NOTHING;
INSERT INTO public.edc (unit_id,business_date,tanggaljam) VALUES
  (1,'2026-07-01','2026-07-01 08:00+07'),(1,'2026-07-01','2026-07-01 09:00+07'),(2,'2026-07-01','2026-07-01 08:00+07') ON CONFLICT DO NOTHING;
INSERT INTO public.pelanggan_sale (unit_id,business_date) VALUES
  (1,'2026-07-01'),(1,'2026-07-01'),(2,'2026-07-01') ON CONFLICT DO NOTHING;
-- u1 has TWO business dates (getUsulanSoList aggregates per date → 2 items); u2 has one.
INSERT INTO app.usulan_so (unit_id,business_date,product_key,penerimaan_hari,permintaan_besok,usulan_penebusan,status,created_by_user_id) VALUES
  (1,'2026-07-01','pertamax',10,20,10,'draft',1),(1,'2026-07-01','solar',10,20,10,'draft',1),
  (1,'2026-06-30','pertamax',10,20,10,'draft',1),
  (2,'2026-07-01','pertamax',10,20,10,'draft',3) ON CONFLICT DO NOTHING;
INSERT INTO app.manual_entry (unit_id,business_date,section,keterangan,amount,created_by_user_id) VALUES
  (1,'2026-07-01','pengeluaran','syn a',1000,2),(1,'2026-07-01','pengeluaran','syn b',2000,2),(2,'2026-07-01','pengeluaran','syn c',3000,3) ON CONFLICT DO NOTHING;
COMMIT;
SELECT 'enrichment' AS note, unit_id, count(*) FROM public.opname GROUP BY unit_id ORDER BY unit_id;
