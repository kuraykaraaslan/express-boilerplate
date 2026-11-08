-- kind: expand
-- 062 — private incidents flagged for a restricted status page
--      (docs/phases/09-observability/15-status-page-v2.md item ii).
--
-- One nullable jsonb column, `incidents.audiencePageIds`: the ids of status pages of a RESTRICTED audience (password, members, address list) on which a
-- PRIVATE incident is shown after the page's own gate passed. NULL for every existing row (flagged for no page), so nothing existing changes: a public page,
-- the snapshot, the feeds, the calendar and the legacy endpoint never read it.
--
-- DDL as TypeORM renders it for the entity, made idempotent and guarded.
--
-- DOWN (exact reverse):
--   ALTER TABLE "incidents" DROP COLUMN IF EXISTS "audiencePageIds";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'incidents'
  ) THEN
    ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "audiencePageIds" jsonb;
  END IF;
END $$;
