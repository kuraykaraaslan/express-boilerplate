-- kind: expand; reversible: true
-- user_session 002: the device id of a session (lead decision D28, docs/audits/2026-10-28-lead-decisions.md).
--
-- A sign-in used to add a session row and nothing ever took one away until the tenant's cap (off by default) or the person did: the same
-- browser signing in again and again piled up rows (36 for one admin on the demo). A browser now carries a `device-id` cookie, the
-- sign-in stores it here, and a new sign-in from the same device replaces that device's earlier session of the same user and tenant.
--
--   user_sessions."deviceId"   the cookie's UUID; null on older rows and on sessions that do not come from a sign-in.
--
-- Purely additive and idempotent: TypeORM synchronize builds the same column and index (same names, declared on the entity) on
-- single-role deployments; this file does it for databases that run in migrate mode. Guarded on to_regclass.
--
-- Down (exact reverse):
--   DROP INDEX IF EXISTS "IDX_user_sessions_device";
--   ALTER TABLE "user_sessions" DROP COLUMN IF EXISTS "deviceId";

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.user_sessions') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "deviceId" character varying(64);
  CREATE INDEX IF NOT EXISTS "IDX_user_sessions_device" ON "user_sessions" ("userId", "tenantId", "deviceId");
END
$$;
