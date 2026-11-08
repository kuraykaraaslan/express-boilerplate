-- 013 — board key filters (phase 36.7, docs/phases/07-dashboard/36; ThingsBoard's dashboard filters).
--
-- `dashboard_boards.filters`: the board's named key filters, `[{ key, name, keyFilters }]` (`BoardFiltersSchema`,
-- `server/board-filters.ts`); NULL = none. A binding names one next to an alias (`{ "$alias": "devices", "filter": "hot" }`);
-- the dashboard evaluates it over the values the entity type reads (`readKeys`), each key type behind its own permission.
--
-- In `synchronize` mode db:deploy's schema-sync phase adds the column from the entity before this file runs; in
-- `migrate` mode this file is what adds it. Idempotent, guard scoped to `current_schema()` like 012.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'dashboard_boards'
  ) THEN
    ALTER TABLE "dashboard_boards" ADD COLUMN IF NOT EXISTS "filters" jsonb;
  END IF;
END $$;
