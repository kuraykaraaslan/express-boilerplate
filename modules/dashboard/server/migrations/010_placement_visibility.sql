-- 010 — a card shown only while a condition on the board's parameters holds (phase 35, docs/phases/07-dashboard/35).
--
-- `dashboard_widget_instances.visibility`: `{ when: EntryCondition }` (`PlacementVisibilitySchema`, `server/dashboard.dto.ts`),
-- the `param` source only; NULL = the card is always shown. The view judges it per frame with the frame's effective
-- values, customise mode shows the card with a badge, and a display screen's server drops the card against the board's
-- defaults. It sits beside `actions` (not inside it) so the reference check of E9 and the board package carry it like an
-- entry's condition.
--
-- In `synchronize` mode db:deploy's schema-sync phase adds the column from the entity before this file runs; in
-- `migrate` mode this file is what adds it. Idempotent (`ADD COLUMN IF NOT EXISTS`), guard scoped to `current_schema()`
-- like 007 and 009.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'dashboard_widget_instances'
  ) THEN
    ALTER TABLE "dashboard_widget_instances" ADD COLUMN IF NOT EXISTS "visibility" jsonb;
  END IF;
END $$;
