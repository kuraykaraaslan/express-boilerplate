-- kind: expand
-- supersedes: 59acaa66122d6c88a2e0cc6dca9981abfc9d9eb2e8ff3ea092b1b235d06cca55
-- 2026-10-18 (fleet HEALTH-3): the uuid defaults read gen_random_uuid() (built in) instead of uuid_generate_v4(): a module
-- migration runs with only the target schema on the search path, where uuid-ossp (in public) is not found. A database that
-- ran the earlier text keeps its tables and their old default, which works there; the ledger row is re-stamped.
-- 030 — AI runs (docs/phases/09-observability/20-mcp-and-ai.md).
--
-- One new tenant table, `incident_ai_notes`: the record of one run of an AI feature (an investigator analysis, a status-update or post-mortem
-- draft, a natural-language query) with its cited result, the evidence it cites, the token use and the thumbs feedback. It is also what the
-- daily AI cap counts. Nothing existing changes: AI is off for every tenant until an admin turns it on, and the incident timeline only gains
-- rows of the AI_NOTE type that already existed in the vocabulary.
--
-- The statements are the DDL TypeORM renders for the entity (generated through the scratch-schema tool, `db.schema-scratch`), made idempotent
-- with IF NOT EXISTS so a database `synchronize` already built is left alone; names are TypeORM's own, so `db:schema:drift` stays quiet.

CREATE TABLE IF NOT EXISTS "incident_ai_notes" ("noteId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "incidentId" uuid, "kind" character varying(20) NOT NULL, "status" character varying(8) NOT NULL, "trigger" character varying(8) NOT NULL DEFAULT 'MANUAL', "requestedBy" uuid, "provider" character varying(60), "model" character varying(100), "promptVersion" character varying(40), "inputTokens" integer NOT NULL DEFAULT '0', "outputTokens" integer NOT NULL DEFAULT '0', "result" jsonb, "evidence" jsonb, "failure" character varying(200), "feedback" smallint, "feedbackBy" uuid, "feedbackAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_deba2c1ade54264c2f7d09df96a" PRIMARY KEY ("noteId"));
CREATE INDEX IF NOT EXISTS "IDX_e5e180609c3e01ab9384591e9a" ON "incident_ai_notes" ("tenantId");
CREATE INDEX IF NOT EXISTS "idx_incident_ai_notes_day" ON "incident_ai_notes" ("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_incident_ai_notes_incident" ON "incident_ai_notes" ("tenantId", "incidentId", "createdAt");
