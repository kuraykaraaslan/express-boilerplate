-- kind: expand
-- 001 — the database-held version of the record-scope cache (organization.34).
--
-- VisibilityService caches a user's record scope in Redis for 60 s and purged it after a team-membership change; a purge
-- that Redis refused was swallowed, so a member just removed from a team kept seeing the team's records until the TTL ran
-- out. The version here is bumped in the membership change's own transaction and is part of every scope cache key.
--
-- Down (exact reverse; nothing else depends on the table):
--   DROP TABLE IF EXISTS "abac_scope_versions";
--
-- The statements are the DDL TypeORM renders for the entity, made idempotent so a database that `synchronize` already built is left alone.

CREATE TABLE IF NOT EXISTS "abac_scope_versions" (
  "tenantId" uuid NOT NULL,
  "version" integer NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_abac_scope_versions" PRIMARY KEY ("tenantId")
);
