-- kind: expand
-- supersedes: 795fec810e15cd144db878e384a3e9a39f7ed3d3adb1673d728b8214b0df6a61
-- 2026-10-18 (fleet HEALTH-3): the uuid defaults read gen_random_uuid() (built in) instead of uuid_generate_v4(): a module
-- migration runs with only the target schema on the search path, where uuid-ossp (in public) is not found. A database that
-- ran the earlier text keeps its tables and their old default, which works there; the ledger row is re-stamped.
-- 060 — latency aggregates and the location dimension of the daily rollups
--      (docs/phases/09-observability/10-multi-region-and-private-probes.md item a, 15-status-page-v2.md item i; decision D-OBS-12).
--
-- ADDITIVE ONLY. The monitor-level rollup `monitor_check_daily` keeps its key (tenantId, monitorId, day) and no row of it is rewritten:
--   * three columns are added to it (`latencyCount`, `latencySumMs`, `latencyBuckets`), each with a default, so every existing row reads as "no latency measured that day";
--   * one NEW table, `monitor_check_daily_location`, carries the same counters with a location key (`local` for the in-process probe). There is NO backfill:
--     history written before this migration stays monitor-level only, and the read path says from which day per-location data starts.
-- The code writes both tables in one transaction from one call (`StatusUptimeService.bumpDaily`). Nothing existing changes meaning, so the migration is
-- safe to run ahead of the code (old code never touches the new columns or the new table).
--
-- The CREATE and ADD statements are the DDL TypeORM renders for the entities (generated through a scratch database), made idempotent with IF NOT EXISTS so
-- a database `synchronize` already built is left alone; names are TypeORM's own, so `db:schema:drift` stays quiet. The bucket edges behind `latencyBuckets` are
-- fixed in `uptime.latency-buckets.ts` (22 counters: 21 edges plus the overflow bucket); changing an edge would change what stored history means.
--
-- DOWN (exact reverse, loses only data this migration made possible):
--   DROP TABLE IF EXISTS "monitor_check_daily_location";
--   ALTER TABLE "monitor_check_daily" DROP COLUMN IF EXISTS "latencyBuckets", DROP COLUMN IF EXISTS "latencySumMs", DROP COLUMN IF EXISTS "latencyCount";
-- RLS: the tenant policy pair for the new table is generated from the entities (`npm run gen:rls-policies`) like every tenant table.

CREATE TABLE IF NOT EXISTS "monitor_check_daily_location" ("dailyLocationId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "monitorId" uuid NOT NULL, "locationKey" character varying(64) NOT NULL, "day" date NOT NULL, "up" integer NOT NULL DEFAULT '0', "degraded" integer NOT NULL DEFAULT '0', "down" integer NOT NULL DEFAULT '0', "latencyCount" integer NOT NULL DEFAULT '0', "latencySumMs" bigint NOT NULL DEFAULT '0', "latencyBuckets" integer array NOT NULL DEFAULT '{0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0}', CONSTRAINT "PK_2b04a4b85312d293be649117e6a" PRIMARY KEY ("dailyLocationId"));
CREATE INDEX IF NOT EXISTS "IDX_facbadc150b58e517886806f31" ON "monitor_check_daily_location" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_monitor_check_daily_location" ON "monitor_check_daily_location" ("tenantId", "monitorId", "locationKey", "day");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'monitor_check_daily'
  ) THEN
    ALTER TABLE "monitor_check_daily" ADD COLUMN IF NOT EXISTS "latencyCount" integer NOT NULL DEFAULT '0';
    ALTER TABLE "monitor_check_daily" ADD COLUMN IF NOT EXISTS "latencySumMs" bigint NOT NULL DEFAULT '0';
    ALTER TABLE "monitor_check_daily" ADD COLUMN IF NOT EXISTS "latencyBuckets" integer array NOT NULL DEFAULT '{0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0}';
  END IF;
END $$;
