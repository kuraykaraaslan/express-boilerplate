-- kind: expand
-- 061 — the region breakdown and the response-time chart of the status page
--      (docs/phases/09-observability/10-multi-region-and-private-probes.md item b, 15-status-page-v2.md item i).
--
-- Three additive columns, all nullable or defaulted, so every existing row keeps meaning what it meant:
--   * `probe_locations.publicVisible` (boolean, NULL = the default of the location's kind: a PUBLIC catalogue location is visible, a PRIVATE one is not)
--     and `probe_locations.publicLabel` (the name a status page shows; a PRIVATE location with no public label is never shown);
--   * `status_components.showResponseTime` (boolean, default false: a component draws no chart until somebody turns it on).
-- A tenant that never touches any of them serves exactly the page it served before.
--
-- DDL as TypeORM renders it for the entities, made idempotent; guarded so a database that does not have the table yet (a fresh install builds it from the
-- entities with the columns already in place) is left alone.
--
-- DOWN (exact reverse):
--   ALTER TABLE "status_components" DROP COLUMN IF EXISTS "showResponseTime";
--   ALTER TABLE "probe_locations" DROP COLUMN IF EXISTS "publicLabel", DROP COLUMN IF EXISTS "publicVisible";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'probe_locations'
  ) THEN
    ALTER TABLE "probe_locations" ADD COLUMN IF NOT EXISTS "publicVisible" boolean;
    ALTER TABLE "probe_locations" ADD COLUMN IF NOT EXISTS "publicLabel" character varying(120);
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'status_components'
  ) THEN
    ALTER TABLE "status_components" ADD COLUMN IF NOT EXISTS "showResponseTime" boolean NOT NULL DEFAULT false;
  END IF;
END $$;
