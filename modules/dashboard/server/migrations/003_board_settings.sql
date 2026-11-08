-- 003 — dashboard_boards: the backdrop moves into the board's own settings (phase 21, docs/phases/07-dashboard/21).
--
-- `dashboard_boards.settings` (jsonb, the `core:board` template, stamped `$v`) and
-- `dashboard_widgets.settingsTemplate` are added by db:deploy's schema-sync phase from the entities.
-- This file removes what 002 added: the `#rrggbb`-only `backgroundColor` column and its CHECK. Colours
-- are free now (any CSS colour or a theme token, owner decision D-21.1) and live in `settings`.
-- Owner decision D-21.3: existing values are not carried over.
--
-- Guarded on information_schema: a deployment without the dashboard module skips it.
-- supersedes: 48b6fee01ff14d450d54b714c3ccc2273ccb27b8083bfd858ddd5911dde17dbf,56ff4ee0353bf7b8d15e1b5c01da5c47f260bc6aa7ea6cc5386b6953aa1c2235,cee9ca327a969e9f8dfe6cc94a1b2487e7c256a9803f41797a42b543f2a29a81

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'dashboard_boards_background_color_shape' AND constraint_schema = current_schema()
  ) THEN
    ALTER TABLE "dashboard_boards" DROP CONSTRAINT "dashboard_boards_background_color_shape";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dashboard_boards' AND table_schema = current_schema() AND column_name = 'backgroundColor'
  ) THEN
    ALTER TABLE "dashboard_boards" DROP COLUMN "backgroundColor";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dashboard_boards' AND table_schema = current_schema() AND column_name = 'settings'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'dashboard_boards_settings_shape' AND constraint_schema = current_schema()
  ) THEN
    ALTER TABLE "dashboard_boards"
      ADD CONSTRAINT "dashboard_boards_settings_shape"
      CHECK ("settings" IS NULL OR jsonb_typeof("settings") = 'object');
  END IF;
END $$;
