-- kind: expand; reversible: true
-- supersedes: 049226a0a839e76d276993396fb518e87b6dc21bf6863440ef93de7c646ac73e,d595fe4b35dfcb5a1fc6082147875f23e24e6135a6e4466ddae6968be94a4a45,e644d212f2ac38168b2171dadab99711ac1cf69afb929fff45cc490249dbd9dc,fa41f68e96c882d2c89f9c479e9533936b41ba3f133f1d69c6c3d02139a82cec
-- tenant 128: the fleet federation columns of "tenants" and the "tenant_slug_tombstones" table (docs/phases/02-fleet/02 sections 3.5 and 3.6,
-- 05 sections 5 and 7).
--
-- Purely additive: every new column is nullable or has a default, so the previous release (which does not know them) keeps reading and writing
-- "tenants" unchanged, and a rollback leaves columns it ignores. A single deployment never sets them. The home columns stay nullable in this
-- expand step: tenants created before a node joined a fleet have no directory assignment yet (assignmentVersion 0). The rename of "region" to
-- "localeRegionHint" is a contract step for a later release, not this one (the previous release still reads "region").
--
-- "tenant_slug_tombstones" outlives the tenant whose slug it blocks, so it is a system table and RLS-exempt (scripts/gen-rls-policies.mts lists
-- the reason): its "tenantId" records whose slug it was, it does not scope the row.
--
-- TypeORM synchronize builds the same columns, CHECKs (same names, declared on the entities) and table on single-role databases; this file does it
-- for databases that run in migrate mode. Idempotent, and a no-op for "tenants" while the table does not exist yet.

CREATE TABLE IF NOT EXISTS "tenant_slug_tombstones" (
  "slug" character varying(63) NOT NULL,
  "tenantId" uuid NOT NULL,
  "purgedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  CONSTRAINT "PK_e4eaec67b2ab84b5790c3d79cbd" PRIMARY KEY ("slug")
);

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenants') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "homeRegionId" character varying(64);
  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "homeNodeId" character varying(64);
  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "residencyRequirement" character varying(32);
  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "legalHoldUntil" TIMESTAMP WITH TIME ZONE;
  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "legalHoldReason" text;
  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "relocatedToNodeId" character varying(64);
  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "relocatedToBaseUrl" character varying(255);
  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "relocatedAt" TIMESTAMP WITH TIME ZONE;
  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "tombstoneUntil" TIMESTAMP WITH TIME ZONE;
  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "assignmentVersion" integer NOT NULL DEFAULT 0;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenants_relocated' AND conrelid = '"tenants"'::regclass) THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "ck_tenants_relocated"
      CHECK ("tenantStatus" <> 'RELOCATED' OR ("relocatedToNodeId" IS NOT NULL AND "relocatedToBaseUrl" IS NOT NULL AND "relocatedAt" IS NOT NULL AND "tombstoneUntil" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenants_legal_hold' AND conrelid = '"tenants"'::regclass) THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "ck_tenants_legal_hold"
      CHECK ("legalHoldUntil" IS NULL OR "legalHoldReason" IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenants_assignment_version' AND conrelid = '"tenants"'::regclass) THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "ck_tenants_assignment_version"
      CHECK ("assignmentVersion" >= 0);
  END IF;
END $$;
