-- kind: expand
-- supersedes: 7c9e23279fbd18eac2c42dba44a2672aedc78ecac7ca0103ca24929b9e223fc8
-- 2026-10-18 (fleet HEALTH-3): the uuid defaults read gen_random_uuid() (built in) instead of uuid_generate_v4(): a module
-- migration runs with only the target schema on the search path, where uuid-ossp (in public) is not found. A database that
-- ran the earlier text keeps its tables and their old default, which works there; the ledger row is re-stamped.
-- 003 — SLOs (docs/phases/09-observability/13-slo-and-burn-rate.md).
--
-- One new tenant table, `slos`: the objective, its window, what its events are (monitor samples, or two metric queries on the platform
-- plane), and the budget state last seen (so the budget-low / budget-exhausted events fire on the transition). Nothing existing changes.
--
-- The statements are the DDL TypeORM renders for the entity (generated through the scratch-schema tool, `db.schema-scratch`), made
-- idempotent with IF NOT EXISTS so a database `synchronize` already built is left alone; names are TypeORM's own, so `db:schema:drift` stays quiet.

CREATE TABLE IF NOT EXISTS "slos" ("sloId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "name" character varying(200) NOT NULL, "description" character varying(500), "kind" character varying(24) NOT NULL DEFAULT 'MONITOR_AVAILABILITY', "objectivePercent" numeric(6,3) NOT NULL DEFAULT '99.9', "windowDays" integer NOT NULL DEFAULT '30', "monitorIds" jsonb NOT NULL DEFAULT '[]', "componentId" uuid, "latencyThresholdMs" integer, "metricSpec" jsonb, "lowBudgetPercent" integer NOT NULL DEFAULT '25', "burnAlerts" boolean NOT NULL DEFAULT true, "isActive" boolean NOT NULL DEFAULT true, "ownerUserId" uuid, "lastState" character varying(10), "lastEvaluatedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0e0034fcfb53641b4379bf9c160" PRIMARY KEY ("sloId"));
CREATE INDEX IF NOT EXISTS "IDX_919b0a4209d5cff08570a85e17" ON "slos" ("tenantId");
CREATE INDEX IF NOT EXISTS "idx_slos_tenant_active" ON "slos" ("tenantId", "isActive");
