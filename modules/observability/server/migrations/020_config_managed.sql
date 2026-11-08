-- kind: expand
-- 020 — monitoring-as-code marks (docs/phases/09-observability/21-monitoring-as-code-and-api.md).
--
-- A resource applied from a repository is marked `managedBy = 'code'`; the ones that have a stable file key also carry `sourceKey = 'code:<key>'`
-- (monitors already had `sourceKey`, used by `observability:probe-target` providers with a `<moduleId>:<key>` value; the two never collide
-- because `code` is not a module id). Dependencies and update templates are identified by their natural key, so they only need the mark.
--
-- Nullable columns only: every row that exists today is NULL, which means "the UI owns it" and changes nothing. A partial unique index
-- keeps a key from naming two rows. Names are TypeORM's own, so `db:schema:drift` stays quiet. Idempotent and guarded like 001: the
-- tables are created by `synchronize` or by older migrations, so a table that is not there yet is skipped.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'monitors'
  ) THEN
    ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "managedBy" varchar(8);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'status_components'
  ) THEN
    ALTER TABLE "status_components" ADD COLUMN IF NOT EXISTS "managedBy" varchar(8);
    ALTER TABLE "status_components" ADD COLUMN IF NOT EXISTS "sourceKey" varchar(200);
    CREATE UNIQUE INDEX IF NOT EXISTS "IDX_9ed69c267a088c145934ca88c2" ON "status_components" ("tenantId", "sourceKey") WHERE "sourceKey" IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'slos'
  ) THEN
    ALTER TABLE "slos" ADD COLUMN IF NOT EXISTS "managedBy" varchar(8);
    ALTER TABLE "slos" ADD COLUMN IF NOT EXISTS "sourceKey" varchar(200);
    CREATE UNIQUE INDEX IF NOT EXISTS "IDX_bc9d7f978f48dfdbeb807ce051" ON "slos" ("tenantId", "sourceKey") WHERE "sourceKey" IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'alert_routes'
  ) THEN
    ALTER TABLE "alert_routes" ADD COLUMN IF NOT EXISTS "managedBy" varchar(8);
    ALTER TABLE "alert_routes" ADD COLUMN IF NOT EXISTS "sourceKey" varchar(200);
    CREATE UNIQUE INDEX IF NOT EXISTS "IDX_b7a236050e22eeeac799c26521" ON "alert_routes" ("tenantId", "sourceKey") WHERE "sourceKey" IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'alert_integrations'
  ) THEN
    ALTER TABLE "alert_integrations" ADD COLUMN IF NOT EXISTS "managedBy" varchar(8);
    ALTER TABLE "alert_integrations" ADD COLUMN IF NOT EXISTS "sourceKey" varchar(200);
    CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cfd6c48bd4836aa0adf384ef7b" ON "alert_integrations" ("tenantId", "sourceKey") WHERE "sourceKey" IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'alert_dependencies'
  ) THEN
    ALTER TABLE "alert_dependencies" ADD COLUMN IF NOT EXISTS "managedBy" varchar(8);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'incident_update_templates'
  ) THEN
    ALTER TABLE "incident_update_templates" ADD COLUMN IF NOT EXISTS "managedBy" varchar(8);
  END IF;
END $$;
