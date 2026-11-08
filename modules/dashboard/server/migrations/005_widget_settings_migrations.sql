-- 005 — dashboard_widgets.settingsMigrations: the steps of a tenant-authored settings template (phase 21.8, docs/phases/07-dashboard/21).
--
-- A tenant-authored widget's placement settings are versioned like a builtin's (owner decision D-21.6):
-- `settingsTemplate` names `{ id: 'tenant:<type>', version }` and `settingsMigrations` holds the
-- append-only steps, declarative ops only (rename, mapValue, materializeDefault, clamp, drop, each; no
-- stored code). Publishing a widget whose schema changed in a breaking way bumps the version and appends
-- one step (`widget.publishing.service.ts`); placements migrate at read and on every save.
--
-- In `synchronize` mode db:deploy's schema-sync phase adds both columns from the entity
-- (`dashboard_widget.entity.ts`) before this file runs; in `migrate` mode (no synchronize) this file is
-- what adds them. `settingsTemplate` arrived with 21.3 through schema-sync only, so it is added here too.
-- Either way the statements are idempotent (`ADD COLUMN IF NOT EXISTS`) and existing rows start at NULL:
-- a row with no tenant template is read as `tenant:<type>` v1 with no steps (D-21.3).
--
-- Guarded on information_schema: a deployment without the dashboard module skips it.
-- supersedes: b6332cb9ed4cfb8cc2b4801a10232a82e9d2a23e2e7cbeae3c1fa5b305db16ce,d9e749d391fbfda45a8655795cdf886e7905d68d19db73f3b5629cf51df8e03c,ee653760b67351a52f97ed5d860e24c1e970b901129c2ac7b10f0ea6b7ece110

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'dashboard_widgets' AND table_schema = current_schema()
  ) THEN
    ALTER TABLE "dashboard_widgets"
      ADD COLUMN IF NOT EXISTS "settingsTemplate" jsonb;
    ALTER TABLE "dashboard_widgets"
      ADD COLUMN IF NOT EXISTS "settingsMigrations" jsonb;
  END IF;
END $$;
