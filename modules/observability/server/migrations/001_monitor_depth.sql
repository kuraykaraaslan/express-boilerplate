-- 001 — monitor depth (docs/phases/09-observability/09-monitor-depth.md).
--
-- New monitor types (TLS, DOMAIN, HEARTBEAT, STEPS) need a wider `type` column ('HEARTBEAT' is 9 characters), and the new
-- check features add nullable columns only. Existing rows and their rollups are untouched: every new column is NULL for them,
-- and NULL means "behave exactly as before".
--
-- In `synchronize` mode db:deploy's schema-sync phase adds the columns from the entity before this file runs; in `migrate`
-- mode this file is what adds them. Idempotent (`IF NOT EXISTS`, a no-op type change), scoped to `current_schema()`.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'monitors'
  ) THEN
    ALTER TABLE "monitors" ALTER COLUMN "type" TYPE varchar(16);
    ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "assertions" jsonb;
    ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "certWarnDays" integer;
    ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "certCriticalDays" integer;
    ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "heartbeatTokenHash" varchar(64);
    ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "heartbeatGraceSeconds" integer;
    ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "lastHeartbeatAt" timestamptz;
    ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "heartbeatStartedAt" timestamptz;
    ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "heartbeatState" varchar(8);
    ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "steps" jsonb;
    ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "secrets" jsonb;
    ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "latencyBaselineFactor" real;
    ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "groupName" varchar(100);
    ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "tags" jsonb;
    ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "pausedUntil" timestamptz;
    ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "maintenanceUntil" timestamptz;
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_monitors_heartbeat_token" ON "monitors" ("heartbeatTokenHash") WHERE "heartbeatTokenHash" IS NOT NULL;
  END IF;
END $$;
