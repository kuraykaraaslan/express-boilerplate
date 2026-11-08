-- kind: expand
-- supersedes: 4e629debfd77b7f48815096531566a43f0f82b71606f60a0a24178f7f6e7930a
-- 2026-10-18 (fleet HEALTH-3): the uuid defaults read gen_random_uuid() (built in) instead of uuid_generate_v4(): a module
-- migration runs with only the target schema on the search path, where uuid-ossp (in public) is not found. A database that
-- ran the earlier text keeps its tables and their old default, which works there; the ledger row is re-stamped.
-- 005 — probe locations (docs/phases/09-observability/10-probe-locations.md).
--
-- Four new tenant tables (`probe_locations`, `probe_runners`, `probe_enrolments`, `probe_leases`) and four additive columns: `monitors.locations`,
-- `monitors.quorum`, `monitors.locationState` and `monitor_checks.locationKey`. A monitor with no locations behaves exactly as before (the implicit `local`
-- probe), so nothing existing changes and the migration is safe to run ahead of the code.
--
-- The CREATE statements are the DDL TypeORM renders for the entities (generated through the scratch-schema tool, `db.schema-scratch`), made idempotent with
-- IF NOT EXISTS so a database `synchronize` already built is left alone; names are TypeORM's own, so `db:schema:drift` stays quiet.

CREATE TABLE IF NOT EXISTS "probe_locations" ("locationId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "key" character varying(64) NOT NULL, "kind" character varying(8) NOT NULL, "label" character varying(120) NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "targetPolicy" jsonb, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "version" character varying(40), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e7e381e4c190c873c82d58f7167" PRIMARY KEY ("locationId"));
CREATE INDEX IF NOT EXISTS "IDX_0735e6f317bcff7537cc6e32eb" ON "probe_locations" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_probe_location_key" ON "probe_locations" ("tenantId", "key");
CREATE TABLE IF NOT EXISTS "probe_runners" ("runnerId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "locationId" uuid NOT NULL, "locationKey" character varying(64) NOT NULL, "name" character varying(120) NOT NULL, "publicKeyPem" text NOT NULL, "fingerprint" character varying(64) NOT NULL, "status" character varying(8) NOT NULL DEFAULT 'ACTIVE', "version" character varying(40), "lastSeenAt" TIMESTAMP WITH TIME ZONE, "revokedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f8de1634cdb0ed2950b5cbb124e" PRIMARY KEY ("runnerId"));
CREATE INDEX IF NOT EXISTS "IDX_6e314168344ae0624e7fcb81b2" ON "probe_runners" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_probe_runner_fingerprint" ON "probe_runners" ("fingerprint");
CREATE TABLE IF NOT EXISTS "probe_enrolments" ("enrolmentId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "locationId" uuid NOT NULL, "locationKey" character varying(64) NOT NULL, "tokenHash" character varying(64) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "createdBy" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_77833e08ed4178deaeab6ea7ec7" PRIMARY KEY ("enrolmentId"));
CREATE INDEX IF NOT EXISTS "IDX_aed83881bd6aa0ac3bc725e2b2" ON "probe_enrolments" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_probe_enrolment_token" ON "probe_enrolments" ("tokenHash");
CREATE TABLE IF NOT EXISTS "probe_leases" ("leaseId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "monitorId" uuid NOT NULL, "locationKey" character varying(64) NOT NULL, "runnerId" uuid NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "completedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6ab21f2b122d27e3c78e4b59edc" PRIMARY KEY ("leaseId"));
CREATE INDEX IF NOT EXISTS "IDX_d5b855b49e084f915082bc261d" ON "probe_leases" ("tenantId");
CREATE INDEX IF NOT EXISTS "IDX_ddc461790401324417e9b598d2" ON "probe_leases" ("runnerId");
CREATE INDEX IF NOT EXISTS "idx_probe_lease_monitor" ON "probe_leases" ("tenantId", "monitorId", "locationKey");
ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "locations" jsonb;
ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "quorum" integer;
ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "locationState" jsonb;
ALTER TABLE "monitor_checks" ADD COLUMN IF NOT EXISTS "locationKey" character varying(64);
