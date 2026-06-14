-- 0003_membership_constraints
-- Pagar integritas RBAC: cegah baris membership invalid (mis. dari /admin atau
-- penulisan manual). role & status dibatasi ke nilai sah saja. Aman & additif —
-- baris lama (super_admin/pengawas, status active) sudah memenuhi.

ALTER TABLE "app"."membership"
  ADD CONSTRAINT "membership_role_check"
  CHECK ("role" IN ('super_admin', 'admin_perusahaan', 'direksi', 'pengawas'));

ALTER TABLE "app"."membership"
  ADD CONSTRAINT "membership_status_check"
  CHECK ("status" IN ('active', 'invited', 'disabled'));
