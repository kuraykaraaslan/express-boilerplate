-- kind: expand
-- 090 — BROWSER checks (docs/phases/09-observability/09-monitor-depth.md, decision D-OBS-8).
--
-- One new tenant table, `monitor_check_details` (the bounded per-step timings and web-vitals of a browser run, and the one capped failure screenshot, one row per
-- sample, pruned by the same retention pass as the raw checks), and four additive columns: `monitors.browser` (the closed step grammar), `probe_runners.capabilities`
-- (what a runner says it can do: `browser`), `probe_locations.browserEnabled` (a public location is browser-capable only when the ROOT tenant switched it on; default
-- false) and nothing else. A monitor of any existing type, a runner that never reports capabilities and a location nobody enabled for browsers behave exactly as before,
-- so the migration is safe to run ahead of the code. The `monitors.type` column already holds 16 characters (`BROWSER` is 7).
--
-- down (the exact reverse, safe because nothing else reads these): DROP TABLE IF EXISTS "monitor_check_details";
--   ALTER TABLE "monitors" DROP COLUMN IF EXISTS "browser"; ALTER TABLE "probe_runners" DROP COLUMN IF EXISTS "capabilities";
--   ALTER TABLE "probe_locations" DROP COLUMN IF EXISTS "browserEnabled"; and delete the BROWSER monitors first (DELETE FROM "monitors" WHERE "type" = 'BROWSER').
--
-- The CREATE statements are the DDL TypeORM renders for the entity (generated through the scratch-schema tool, `db.schema-scratch`), made idempotent with
-- IF NOT EXISTS so a database `synchronize` already built is left alone; names are TypeORM's own, so `db:schema:drift` stays quiet.

CREATE TABLE IF NOT EXISTS "monitor_check_details" ("checkId" uuid NOT NULL, "tenantId" uuid NOT NULL, "monitorId" uuid NOT NULL, "checkedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "detail" jsonb NOT NULL, "screenshot" bytea, "screenshotBytes" integer, "screenshotSha256" character varying(64), "screenshotStep" character varying(60), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_59b6bb9d6a205426dda3d4ca093" PRIMARY KEY ("checkId"));
CREATE INDEX IF NOT EXISTS "IDX_82681a008d9d62ee36366603c7" ON "monitor_check_details" ("tenantId");
CREATE INDEX IF NOT EXISTS "IDX_e21477da849fbd6a1939bf1d39" ON "monitor_check_details" ("checkedAt");
CREATE INDEX IF NOT EXISTS "idx_monitor_check_details_monitor" ON "monitor_check_details" ("tenantId", "monitorId", "checkedAt");
ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "browser" jsonb;
ALTER TABLE "probe_runners" ADD COLUMN IF NOT EXISTS "capabilities" jsonb;
ALTER TABLE "probe_locations" ADD COLUMN IF NOT EXISTS "browserEnabled" boolean NOT NULL DEFAULT false;
