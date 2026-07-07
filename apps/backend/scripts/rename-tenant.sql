-- rename-tenant.sql — LOCKED tenant model: tenant = legal entity (PT).
-- Rename the pilot tenant "SolaGroup" → "PT Sola Petra Abadi" (the PT that owns
-- BOTH Imam Bonjol 6478111 and Bakau 6378301). Additive/reversible DATA update —
-- NOT a delete/recreate. No unit/membership FK changes (unit.tenant_id already
-- points at this tenant row).
--
-- Run out-of-band (after 0016/0017 green on the target). Idempotent.
-- Rollback: swap the SET/WHERE literals back to 'SolaGroup' / 'solagroup'.

UPDATE app.tenant
SET    name = 'PT Sola Petra Abadi',
       slug = 'pt-sola-petra-abadi'
WHERE  slug = 'solagroup';

-- Verify (expect 1 row, the renamed PT):
-- SELECT id, name, slug FROM app.tenant;
