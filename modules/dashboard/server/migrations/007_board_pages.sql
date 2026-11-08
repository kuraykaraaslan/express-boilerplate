-- 007 — in-board pages (D-1 option (a), owner decision 2026-10-16; docs/phases/07-dashboard/17).
--
-- `dashboard_boards.pages`: the board's ordered extra pages (`[{ key, title, icon? }]`, `server/board-pages.ts`);
-- NULL = only the main page. `dashboard_widget_instances.pageKey`: the page a placement sits on; NULL = the main
-- page, which is where every existing placement stays.
--
-- In `synchronize` mode db:deploy's schema-sync phase adds both columns from the entities before this file runs; in
-- `migrate` mode this file is what adds them. Idempotent (`ADD COLUMN IF NOT EXISTS`). Unlike 001-005 the
-- information_schema guard is scoped to `current_schema()`, so a database holding several schemas (a scratch test
-- schema next to the real one) decides on the schema it is migrating.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'dashboard_boards'
  ) THEN
    ALTER TABLE "dashboard_boards" ADD COLUMN IF NOT EXISTS "pages" jsonb;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'dashboard_widget_instances'
  ) THEN
    ALTER TABLE "dashboard_widget_instances" ADD COLUMN IF NOT EXISTS "pageKey" varchar(40);
  END IF;
END $$;
