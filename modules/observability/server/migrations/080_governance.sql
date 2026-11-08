-- kind: expand
-- supersedes: e7fe0631514b8d9528df0e04cefa7b5a3050f7ae17393336b5cd8fb95daf7bdf
-- 2026-10-18 (fleet HEALTH-3): the uuid defaults read gen_random_uuid() (built in) instead of uuid_generate_v4(): a module
-- migration runs with only the target schema on the search path, where uuid-ossp (in public) is not found. A database that
-- ran the earlier text keeps its tables and their old default, which works there; the ledger row is re-stamped.
-- 080 - tenancy governance leftovers (phase 16: retention tiers with legal hold, daily metering reconciliation).
--
-- One new tenant table (observability_reconciliations: the daily comparison of what the meters say with what the raw tables hold) and four columns on
-- `incidents` for a legal hold (legalHold false by default, so every incident that exists keeps behaving exactly as it does), plus the index the retention
-- sweep scans by. Nothing existing changes meaning.
--
-- The CREATE statements are the DDL TypeORM renders for the entity (generated through the scratch-schema tool), made idempotent with IF NOT EXISTS so a
-- database `synchronize` already built is left alone; names are TypeORM's own, so `db:schema:drift` stays quiet.

CREATE TABLE IF NOT EXISTS "observability_reconciliations" ("reconcileId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "day" date NOT NULL, "kind" character varying(24) NOT NULL, "metered" integer, "actual" integer NOT NULL, "status" character varying(10) NOT NULL, "difference" integer NOT NULL DEFAULT '0', "detail" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d5c9edb62adc6e96f1a43d99c06" PRIMARY KEY ("reconcileId"));
CREATE INDEX IF NOT EXISTS "IDX_1c242d1d941109b76d60c5fdf6" ON "observability_reconciliations" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_observability_reconciliation" ON "observability_reconciliations" ("tenantId", "day", "kind");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'incidents'
  ) THEN
    ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "legalHold" boolean NOT NULL DEFAULT false;
    ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "legalHoldReason" character varying(500);
    ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "legalHoldAt" TIMESTAMP WITH TIME ZONE;
    ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "legalHoldBy" uuid;
    CREATE INDEX IF NOT EXISTS "idx_incidents_retention" ON "incidents" ("tenantId", "status", "resolvedAt");
  END IF;
END $$;
