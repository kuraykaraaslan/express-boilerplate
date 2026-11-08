-- kind: expand
-- audit_log 001: hardened audit chain, step 1 of 3 (docs/phases/02-fleet/10-roadmap/02-phases-5-to-9.md, Phase 5).
--
-- Additive only, so an N-1 application keeps working against the new schema:
--   * audit_logs gains the pseudonymous actor references, the SERVICE-actor provenance columns and the hash version
--     (all nullable; NULL hashVersion = a v1 row, written and verified by JavaScript exactly as before);
--   * audit_actor_identities maps (tenant, actorRef) -> actorId: the only place a pseudonym resolves to a person;
--   * audit_chain_policy selects, per tenant, the legacy or the sealed chain (the trigger of 003 reads it).
--
-- On a single-role deployment `synchronize` has already built these objects from the entities when this file runs,
-- and the baseline carries them on a fresh database, so every statement is idempotent and every index and constraint
-- here is mirrored in the entity decorators (synchronize DROPS an index or CHECK the entity does not declare).
--
-- The two new tables are tenant-scoped: the generated tenant_isolation / tenant_admin_bypass pair is installed here
-- (same text as modules/tenant 127, which will also list them once regenerated; DROP + CREATE makes both orders safe).
-- INSERT/UPDATE/DELETE on audit_chain_policy and DELETE on the mapping belong to the operator and to the erasure
-- function; withdrawing them from app_runtime is a separate, LATER expand file (never kind contract, never in the
-- release that introduces the functions, so a rollback never meets "permission denied").

ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actorRef" character varying(64);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "onBehalfOfRef" character varying(64);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "commandJti" uuid;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "nodeId" uuid;
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "hashVersion" smallint;
CREATE INDEX IF NOT EXISTS "IDX_audit_logs_tenant_actor_ref" ON "audit_logs" ("tenantId", "actorRef");

CREATE TABLE IF NOT EXISTS "audit_actor_identities" (
  "tenantId" uuid NOT NULL,
  "actorRef" character varying(64) NOT NULL,
  "actorId" uuid NOT NULL,
  "keyVersion" smallint NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_4583d6b9727f19a2974da14a903" PRIMARY KEY ("tenantId", "actorRef")
);
CREATE INDEX IF NOT EXISTS "IDX_audit_actor_identities_actor" ON "audit_actor_identities" ("tenantId", "actorId");

CREATE TABLE IF NOT EXISTS "audit_chain_policy" (
  "tenantId" uuid NOT NULL,
  "mode" character varying(16) NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "ck_audit_chain_policy_mode" CHECK ("mode" IN ('legacy', 'sealed')),
  CONSTRAINT "PK_949e93bf90c943d2f47ba40fe02" PRIMARY KEY ("tenantId")
);

ALTER TABLE "audit_actor_identities" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "audit_actor_identities";
DROP POLICY IF EXISTS tenant_self ON "audit_actor_identities";
DROP POLICY IF EXISTS tenant_admin_bypass ON "audit_actor_identities";
CREATE POLICY tenant_isolation ON "audit_actor_identities"
       USING ("tenantId" = (SELECT app_current_tenant()))
       WITH CHECK ("tenantId" = (SELECT app_current_tenant()));
CREATE POLICY tenant_admin_bypass ON "audit_actor_identities" TO app_admin
       USING ((SELECT app_rls_bypass()))
       WITH CHECK ((SELECT app_rls_bypass()));

ALTER TABLE "audit_chain_policy" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "audit_chain_policy";
DROP POLICY IF EXISTS tenant_self ON "audit_chain_policy";
DROP POLICY IF EXISTS tenant_admin_bypass ON "audit_chain_policy";
CREATE POLICY tenant_isolation ON "audit_chain_policy"
       USING ("tenantId" = (SELECT app_current_tenant()))
       WITH CHECK ("tenantId" = (SELECT app_current_tenant()));
CREATE POLICY tenant_admin_bypass ON "audit_chain_policy" TO app_admin
       USING ((SELECT app_rls_bypass()))
       WITH CHECK ((SELECT app_rls_bypass()));
