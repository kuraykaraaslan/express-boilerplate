-- ============================================================================
-- Migration 124 — table privileges for the `app_admin` group role (phases/db Faz 4)
-- ============================================================================
--
-- Migration 122 created `app_admin` as the identity of cross-tenant work
-- (`getSystemDataSource()` connects with DATABASE_URL_ADMIN, a login that is a
-- member of `app_admin`, then sets `app.bypass_rls`) but granted table
-- privileges only to `app_runtime`. While the app still connected as the table
-- owner this was invisible; the day it connects as a non-owner login every
-- cron, sweep and export on the system DataSource fails with
-- "permission denied for table ...". Found during the local cutover rehearsal
-- on 2026-10-06.
--
-- Same grants as `app_runtime` gets in 122: DML only. DDL stays with the owner
-- role that runs migrations. RLS still decides which rows are visible: the
-- policies let `app_admin` members through only when the bypass GUC is set,
-- so these grants do not weaken tenant isolation for `app_runtime`.
--
-- Idempotent: GRANT is a no-op when the privilege is already held.

GRANT USAGE ON SCHEMA public TO app_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_admin;

-- Tables and sequences created by later migrations pick the grants up too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_admin;
