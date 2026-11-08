-- kind: expand
-- supersedes: fec4f3777ee203c676955c3cdf733de6c6d113c383d1e7d1e0da4d097d6cf8e2
-- 2026-10-18 (fleet HEALTH-3): the uuid defaults read gen_random_uuid() (built in) instead of uuid_generate_v4(): a module
-- migration runs with only the target schema on the search path, where uuid-ossp (in public) is not found. A database that
-- ran the earlier text keeps its tables and their old default, which works there; the ledger row is re-stamped.
-- 002 — the alert pipeline (docs/phases/09-observability/11-alert-pipeline.md).
--
-- Five new tenant tables (alerts, alert_integrations, alert_routes, alert_silences, alert_dependencies) and one nullable column on
-- `incidents` (`alertGroupKey`, the group an auto-opened incident belongs to). Nothing existing changes meaning: every incident that
-- exists today has a NULL group key and keeps behaving as it does.
--
-- The statements are the DDL TypeORM renders for the entities (generated through the scratch-schema tool, `db.schema-scratch`), made
-- idempotent with IF NOT EXISTS so a database `synchronize` already built is left alone. The constraint and index names are TypeORM's own,
-- so `db:schema:drift` stays quiet.

CREATE TABLE IF NOT EXISTS "alerts" ("alertId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "fingerprint" character varying(32) NOT NULL, "source" character varying(12) NOT NULL, "sourceRef" character varying(100), "title" character varying(300) NOT NULL, "severity" character varying(10) NOT NULL DEFAULT 'WARNING', "status" character varying(12) NOT NULL DEFAULT 'FIRING', "suppressedBy" character varying(200), "labels" jsonb NOT NULL DEFAULT '{}', "annotations" jsonb NOT NULL DEFAULT '{}', "groupKey" character varying(200), "routeId" uuid, "startsAt" TIMESTAMP WITH TIME ZONE NOT NULL, "endsAt" TIMESTAMP WITH TIME ZONE, "lastFiredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "count" integer NOT NULL DEFAULT '1', "dispatchAfter" TIMESTAMP WITH TIME ZONE, "notifiedAt" TIMESTAMP WITH TIME ZONE, "acknowledgedAt" TIMESTAMP WITH TIME ZONE, "acknowledgedBy" uuid, "incidentId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0c6d99761f623e4659169491f20" PRIMARY KEY ("alertId"));
CREATE INDEX IF NOT EXISTS "IDX_e33f0dc58a1805e124739bc8be" ON "alerts" ("tenantId");
CREATE INDEX IF NOT EXISTS "IDX_1fa6d12786e37df36ef0f0a748" ON "alerts" ("incidentId");
CREATE INDEX IF NOT EXISTS "idx_alerts_dispatch" ON "alerts" ("tenantId", "status", "dispatchAfter");
CREATE INDEX IF NOT EXISTS "idx_alerts_tenant_status" ON "alerts" ("tenantId", "status", "lastFiredAt");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_alert_open_fingerprint" ON "alerts" ("tenantId", "fingerprint") WHERE "status" <> 'RESOLVED';
CREATE TABLE IF NOT EXISTS "alert_integrations" ("integrationId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "name" character varying(120) NOT NULL, "kind" character varying(14) NOT NULL DEFAULT 'GENERIC', "keyHash" character varying(64) NOT NULL, "keyPrefix" character varying(12) NOT NULL, "severityCeiling" character varying(10) NOT NULL DEFAULT 'MAJOR', "defaultLabels" jsonb, "enabled" boolean NOT NULL DEFAULT true, "lastUsedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_52ed5209db282213dd04a08fc43" PRIMARY KEY ("integrationId"));
CREATE INDEX IF NOT EXISTS "IDX_7e09cf807a5fa0f58de0ee7211" ON "alert_integrations" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_alert_integration_key" ON "alert_integrations" ("keyHash");
CREATE TABLE IF NOT EXISTS "alert_routes" ("routeId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "name" character varying(120) NOT NULL, "position" integer NOT NULL DEFAULT '0', "matchers" jsonb NOT NULL DEFAULT '[]', "groupBy" jsonb NOT NULL DEFAULT '[]', "groupWaitSeconds" integer NOT NULL DEFAULT '0', "groupIntervalSeconds" integer NOT NULL DEFAULT '300', "targets" jsonb NOT NULL DEFAULT '[]', "incident" character varying(8), "continueMatching" boolean NOT NULL DEFAULT false, "enabled" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_374eb712d78bdbab6742c922d80" PRIMARY KEY ("routeId"));
CREATE INDEX IF NOT EXISTS "IDX_8297139556efeddf93a99b2ee5" ON "alert_routes" ("tenantId");
CREATE INDEX IF NOT EXISTS "idx_alert_routes_order" ON "alert_routes" ("tenantId", "position");
CREATE TABLE IF NOT EXISTS "alert_silences" ("silenceId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "matchers" jsonb NOT NULL, "startsAt" TIMESTAMP WITH TIME ZONE NOT NULL, "endsAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdBy" uuid, "reason" character varying(500) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2f9cc3a85e18b9e93728230f4fa" PRIMARY KEY ("silenceId"));
CREATE INDEX IF NOT EXISTS "IDX_b599ad51ebd22d7f03ca205bf5" ON "alert_silences" ("tenantId");
CREATE INDEX IF NOT EXISTS "idx_alert_silences_active" ON "alert_silences" ("tenantId", "endsAt");
CREATE TABLE IF NOT EXISTS "alert_dependencies" ("dependencyId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "child" character varying(140) NOT NULL, "parent" character varying(140) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_bbb0ed1e7fcdc703fb3ffa9a84b" PRIMARY KEY ("dependencyId"));
CREATE INDEX IF NOT EXISTS "IDX_2e49067115c739ae285918f16a" ON "alert_dependencies" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_alert_dependency" ON "alert_dependencies" ("tenantId", "child", "parent");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'incidents'
  ) THEN
    ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "alertGroupKey" varchar(200);
    CREATE INDEX IF NOT EXISTS "idx_incidents_alert_group" ON "incidents" ("tenantId", "alertGroupKey");
  END IF;
END $$;
