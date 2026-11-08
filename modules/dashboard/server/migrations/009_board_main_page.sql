-- 009 — the main page's own name and icon (phase 29, docs/phases/07-dashboard/29).
--
-- `dashboard_boards.mainPage`: `{ title?, icon? }` (`MainPageSchema`, `server/board-pages.ts`); NULL = the main page is
-- called "Main" and has no icon. The other pages keep their settings in `pages` (no change there: the new page fields
-- `hidden`, `inputs`, `opensAs`, `size` and `start` live inside that jsonb).
--
-- In `synchronize` mode db:deploy's schema-sync phase adds the column from the entity before this file runs; in
-- `migrate` mode this file is what adds it. Idempotent (`ADD COLUMN IF NOT EXISTS`), guard scoped to `current_schema()`
-- like 007.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'dashboard_boards'
  ) THEN
    ALTER TABLE "dashboard_boards" ADD COLUMN IF NOT EXISTS "mainPage" jsonb;
  END IF;
END $$;
