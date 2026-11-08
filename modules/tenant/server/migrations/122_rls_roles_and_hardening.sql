-- ============================================================================
-- Migration 122 — RLS roles + policy hardening (phases/db Faz 0)
-- ============================================================================
--
-- Migration 001 enabled row-level security on 19 tenant-scoped tables and then
-- left it toothless, in two separate ways:
--
--   1. `ENABLE ROW LEVEL SECURITY` does not apply to a table's OWNER, and the
--      application connects as the role that created the tables. Every policy
--      written in 001 is therefore skipped for every query the app makes.
--   2. `app_rls_bypass()` reads a session GUC and nothing else. Anything able
--      to run one statement on that connection — a raw-SQL injection, a
--      careless helper — can execute `SET LOCAL app.bypass_rls = 'on'` and
--      switch its own isolation off. A guard that the guarded party can lift
--      is not a guard.
--
-- This migration fixes (2) and prepares the roles that fix (1). It deliberately
-- does NOT turn enforcement on:
--
--   *** THIS MIGRATION MUST NOT CHANGE ANY RUNTIME BEHAVIOUR. ***
--
-- `FORCE ROW LEVEL SECURITY` is what makes the policies bite, and no code path
-- in this repository issues `SET LOCAL app.current_tenant` yet (phases/db Faz
-- 2/3 do that). Forcing today would turn every tenant-scoped query in the
-- product into "0 rows" — the whole application, instantly. So forcing lives in
-- `migrations/manual/rls-force-enable.sql`, which the numbered runner does not
-- pick up, and is the cutover step of Faz 4. Its reverse is beside it.
--
-- WHY GROUP ROLES WITHOUT PASSWORDS
-- ---------------------------------
-- The plan called for `CREATE ROLE app_runtime LOGIN PASSWORD '...'`. A
-- password in a committed migration is a credential in git, and a placeholder
-- password is worse (it is a real, guessable login on a real database). These
-- are NOLOGIN **group** roles instead: the operator creates the login user for
-- their environment and grants it membership. `pg_has_role(..., 'member')`
-- below is true through membership, which is exactly what the hardened policy
-- checks.
--
-- Note that BYPASSRLS is a role ATTRIBUTE and is not inherited through
-- membership — which is another reason the bypass path here goes through the
-- policy (GUC + membership) rather than through that attribute.
-- ============================================================================

-- ─── Roles ──────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- The runtime connection: may read and write tenant rows, never bypasses.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOBYPASSRLS;
  END IF;

  -- The cross-tenant path: cron sweeps, CLI tooling, migrations.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin NOLOGIN;
  END IF;
END $$;

-- The role that runs this migration is today's application connection AND the
-- table owner. Granting it membership in `app_admin` is what keeps
-- `withSystemRLS()` working the moment the hardened function below replaces the
-- old one — without it, this migration would silently break every cross-tenant
-- job the day enforcement is switched on.
DO $$
BEGIN
  EXECUTE format('GRANT app_admin TO %I', current_user);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'could not grant app_admin to %, do it manually before cutover', current_user;
END $$;

-- ─── Privileges for the future runtime role ─────────────────────────────────
-- Granted now so the cutover in Faz 4 is one URL change rather than a
-- privilege audit. Nothing connects as this role yet.

GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

-- Future tables too: `synchronize` creates them as the owner, and keeping a
-- hand-written list in step with 328 entities is a promise nobody keeps.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

-- ─── The hardened bypass check ──────────────────────────────────────────────
-- Both halves must hold: the session asked for bypass AND the connected role is
-- allowed to have it. The GUC alone is a string anybody on the connection can
-- set; role membership is a property of the connection that no SQL text can
-- forge.

CREATE OR REPLACE FUNCTION app_rls_bypass() RETURNS BOOLEAN AS $$
BEGIN
  RETURN COALESCE(current_setting('app.bypass_rls', true), 'off') = 'on'
         AND pg_has_role(current_user, 'app_admin', 'member');
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION app_rls_bypass() IS
  'True only when the session opted into bypass AND the connected role is a member of app_admin. Migration 122 (phases/db Faz 0) added the second half: a GUC-only check can be set by whatever it is meant to be guarding against.';
