-- kind: expand
-- supersedes: 1cffa53166b8d1639b02bee94020315ad476f3d5ab74c833c6b0e69a0db23f3e
-- 2026-10-18 (fleet HEALTH-3): the uuid defaults read gen_random_uuid() (built in) instead of uuid_generate_v4(): a module
-- migration runs with only the target schema on the search path, where uuid-ossp (in public) is not found. A database that
-- ran the earlier text keeps its tables and their old default, which works there; the ledger row is re-stamped.
-- 021 — silence templates (docs/phases/09-observability/21-monitoring-as-code-and-api.md).
--
-- One new tenant table: a named, reusable silence (matchers, a length, a reason) kept in a repository. It is not a silence: nothing is muted
-- until somebody starts it, which creates a normal `alert_silences` row.
--
-- The statements are the DDL TypeORM renders for the entity (generated through the scratch-schema tool), made idempotent with IF NOT EXISTS so
-- a database `synchronize` already built is left alone; names are TypeORM's own, so `db:schema:drift` stays quiet.

CREATE TABLE IF NOT EXISTS "alert_silence_templates" ("templateId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "name" character varying(120) NOT NULL, "matchers" jsonb NOT NULL DEFAULT '[]', "durationMinutes" integer NOT NULL, "reason" character varying(500) NOT NULL, "managedBy" character varying(8), "sourceKey" character varying(200), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cd81cfed4bfd60e116639730215" PRIMARY KEY ("templateId"));
CREATE INDEX IF NOT EXISTS "IDX_77a5b606feb8b52be9338aa6f2" ON "alert_silence_templates" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_4d1d5d1923d0719db5ec8b39e4" ON "alert_silence_templates" ("tenantId", "sourceKey") WHERE "sourceKey" IS NOT NULL;
