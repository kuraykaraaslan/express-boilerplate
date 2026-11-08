-- kind: expand
-- supersedes: c87d626f6831e54f1a111e01d5fed0c33e0d86861960e3eb5ff1767905314bdd
-- 2026-10-18 (fleet HEALTH-3): the uuid defaults read gen_random_uuid() (built in) instead of uuid_generate_v4(): a module
-- migration runs with only the target schema on the search path, where uuid-ossp (in public) is not found. A database that
-- ran the earlier text keeps its tables and their old default, which works there; the ledger row is re-stamped.
-- 004 — incident management v2 (docs/phases/09-observability/14-incident-management-v2.md).
--
-- Four new tenant tables (incident_events, incident_participants, incident_postmortems, incident_update_templates) and four nullable columns
-- on `incidents` (acknowledgedAt, acknowledgedBy, mitigatedAt, declaredBy). Every incident that exists today keeps working: the new columns are
-- NULL for it, and its timeline simply starts empty.
--
-- The statements are the DDL TypeORM renders for the entities (generated through the scratch-schema tool), made idempotent with IF NOT EXISTS
-- so a database `synchronize` already built is left alone; names are TypeORM's own, so `db:schema:drift` stays quiet.

CREATE TABLE IF NOT EXISTS "incident_events" ("eventId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "incidentId" uuid NOT NULL, "type" character varying(24) NOT NULL, "actorId" uuid, "data" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_85399a866496927e76e70a1053d" PRIMARY KEY ("eventId"));
CREATE INDEX IF NOT EXISTS "IDX_7bcb960a9b081fc1c586f537dd" ON "incident_events" ("tenantId");
CREATE INDEX IF NOT EXISTS "idx_incident_events_incident" ON "incident_events" ("tenantId", "incidentId", "createdAt");
CREATE TABLE IF NOT EXISTS "incident_participants" ("participantId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "incidentId" uuid NOT NULL, "userId" uuid NOT NULL, "role" character varying(12) NOT NULL, "assignedBy" uuid, "assignedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1a0952e7e360e9d285c8a0a9503" PRIMARY KEY ("participantId"));
CREATE INDEX IF NOT EXISTS "IDX_0d5a33eac5b5efa7e697afc1e4" ON "incident_participants" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_incident_one_commander" ON "incident_participants" ("tenantId", "incidentId") WHERE "role" = 'COMMANDER';
CREATE UNIQUE INDEX IF NOT EXISTS "uq_incident_participant" ON "incident_participants" ("tenantId", "incidentId", "userId");
CREATE TABLE IF NOT EXISTS "incident_postmortems" ("postmortemId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "incidentId" uuid NOT NULL, "status" character varying(12) NOT NULL DEFAULT 'DRAFT', "summary" character varying(2000), "impact" text, "rootCause" text, "contributingFactors" text, "wentWell" text, "wentPoorly" text, "timelineText" text, "authorUserId" uuid, "reviewerUserId" uuid, "publishedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0522c981c1a9b325d0c180cd9f3" PRIMARY KEY ("postmortemId"));
CREATE INDEX IF NOT EXISTS "IDX_9ef2c9305be3c147bc9149332e" ON "incident_postmortems" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_incident_postmortem" ON "incident_postmortems" ("tenantId", "incidentId");
CREATE TABLE IF NOT EXISTS "incident_update_templates" ("templateId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "status" character varying(14) NOT NULL, "locale" character varying(12) NOT NULL, "body" character varying(2000) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2aa1f09c400bb7f1430ec27066a" PRIMARY KEY ("templateId"));
CREATE INDEX IF NOT EXISTS "IDX_4fa1a27fc297f932cb3bc3581f" ON "incident_update_templates" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_incident_update_template" ON "incident_update_templates" ("tenantId", "status", "locale");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'incidents'
  ) THEN
    ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "acknowledgedAt" timestamptz;
    ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "acknowledgedBy" uuid;
    ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "mitigatedAt" timestamptz;
    ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "declaredBy" uuid;
  END IF;
END $$;
