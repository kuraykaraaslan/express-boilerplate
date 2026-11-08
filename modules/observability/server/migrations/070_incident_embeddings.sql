-- kind: expand
-- supersedes: 88145b221a253c709b62684161f9402700b0c4afabe382957a95d0187809b9c8
-- 2026-10-18 (fleet HEALTH-3): the uuid defaults read gen_random_uuid() (built in) instead of uuid_generate_v4(): a module
-- migration runs with only the target schema on the search path, where uuid-ossp (in public) is not found. A database that
-- ran the earlier text keeps its tables and their old default, which works there; the ledger row is re-stamped.
-- 070 — incident embeddings (docs/phases/09-observability/20-mcp-and-ai.md, item 2 of work order 2).
--
-- One new tenant table, `incident_embeddings`: the embedding of an incident's text, kept ONLY for tenants that switched the AI setting
-- `similarByEmbedding` on (off by default; with it off nothing is written and nothing is embedded). The vector is a plain `real[]`, so no database
-- extension is needed. Nothing existing changes.
--
-- Down (exact reverse, drops the stored vectors only; similar-incident lookup falls back to group, monitor and text search):
--   DROP TABLE IF EXISTS "incident_embeddings";
--
-- The statements are the DDL TypeORM renders for the entity (generated through the scratch-schema tool, `db.schema-scratch`), made idempotent
-- with IF NOT EXISTS so a database `synchronize` already built is left alone; names are TypeORM's own, so `db:schema:drift` stays quiet.

CREATE TABLE IF NOT EXISTS "incident_embeddings" ("embeddingId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "incidentId" uuid NOT NULL, "provider" character varying(60) NOT NULL, "model" character varying(100) NOT NULL, "dims" integer NOT NULL, "vector" real array NOT NULL, "textHash" character varying(64) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6c6ce79a20a9d7d6d5eae4bb148" PRIMARY KEY ("embeddingId"));
CREATE INDEX IF NOT EXISTS "IDX_3cc2c8f19997291f42fbc61286" ON "incident_embeddings" ("tenantId");
CREATE INDEX IF NOT EXISTS "idx_incident_embeddings_model" ON "incident_embeddings" ("tenantId", "model", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_incident_embeddings" ON "incident_embeddings" ("tenantId", "incidentId", "model");
