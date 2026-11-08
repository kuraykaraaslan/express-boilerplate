-- 006 — dashboard_boards.settings in `migrate` mode (phase 21, docs/phases/07-dashboard/21).
--
-- 003 moved the board backdrop into `dashboard_boards.settings` (jsonb, the `core:board` template,
-- stamped `$v`) and left the column itself to db:deploy's schema-sync phase. A `migrate`-mode database
-- (node / fleet roles) has no schema-sync phase, so it never got the column and every board read failed
-- with "column DashboardBoard.settings does not exist" (found by `npm run db:schema:drift` and the real
-- PostgreSQL suite `dashboard.boards.integration.test.ts`).
--
-- In `synchronize` mode the column already exists when this runs; either way the statement is
-- idempotent. `null` = the template defaults, the same value a new board is created with.
--
-- Guarded on information_schema: a deployment without the dashboard module skips it.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'dashboard_boards'
  ) THEN
    ALTER TABLE "dashboard_boards"
      ADD COLUMN IF NOT EXISTS "settings" jsonb;
  END IF;
END $$;
