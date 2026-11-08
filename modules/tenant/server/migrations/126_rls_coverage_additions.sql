-- ============================================================================
-- Migration 126 - policies for tenant-scoped tables added after 123 was applied
-- ============================================================================
--
-- 123 is generated and rewritten in place, but the runner applies each file once,
-- so a database that already recorded 123 never saw the tables the generator
-- added later. This file carries those: notification_telegram_links and
-- tenant_usage_metrics (the same two names are in 123 for fresh databases).
--
-- Idempotent and additive, like 123. It only adds policies; FORCE stays with
-- migrations/manual/rls-force-enable.sql (re-run that on a database that has
-- already cut over, it is idempotent and now covers these tables too).
--
-- RULE for later additions: a tenant-scoped table added after a database applied 123
-- needs its own numbered file like this one (copy the block, change the names).
-- ============================================================================

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'notification_telegram_links',
    'tenant_usage_metrics'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = current_schema() AND table_name = t) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
      EXECUTE format($f$
        CREATE POLICY tenant_isolation ON %I
          USING (app_rls_bypass() OR "tenantId" = app_current_tenant())
          WITH CHECK (app_rls_bypass() OR "tenantId" = app_current_tenant())
      $f$, t);
    END IF;
  END LOOP;
END $$;
