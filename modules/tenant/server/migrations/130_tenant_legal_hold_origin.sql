-- kind: expand; reversible: true
-- supersedes: 0c6212e421e7d44e3ff0680ac597b77d6211ea2c403451cd97b5549d7eb1af64,a13edb7eef33e2ae4cb9aaffba3a2fc3a8a6885bc3a55d3b101836fd9c2da2cc,a96920d6e16d4bcc6e5500e8a7702ad687aaff278f2648cb573a5548a86f502c,d1952883ff64892f4a6089f7f64c5672cbd49f441fe4781847dcf5bf447cbc37
-- tenant 130: "tenants"."legalHoldOrigin", who stands behind a legal hold (docs/phases/02-fleet/decisions-2026-10-18.md F19).
--
-- A hold is tighten-only: the control plane (class 2), the region's operator or the tenant's DPO may place or extend one; lifting it early needs
-- the control plane's class 3 or the same node-local authority that set it. This column records that authority: CONTROL_PLANE, REGIONAL_OPERATOR,
-- TENANT_DPO, or MIXED once a second authority extended the hold (then only class 3 lifts it). Null without a hold, and on a hold placed before
-- this column existed (class 3 lifts it).
--
-- Purely additive: a nullable column and a CHECK every existing row passes (they all have a null origin), so the previous release keeps reading and
-- writing "tenants" unchanged and a rollback leaves a column it ignores. Type, name and CHECK are the entity's. Idempotent, and a no-op while the
-- table does not exist yet.

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenants') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "legalHoldOrigin" character varying(24);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenants_legal_hold_origin' AND conrelid = '"tenants"'::regclass) THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "ck_tenants_legal_hold_origin"
      CHECK ("legalHoldOrigin" IS NULL OR ("legalHoldUntil" IS NOT NULL AND "legalHoldOrigin" IN ('CONTROL_PLANE', 'REGIONAL_OPERATOR', 'TENANT_DPO', 'MIXED')));
  END IF;
END $$;
