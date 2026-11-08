-- kind: expand; reversible: true
-- audit_log 012: the keyed legacy chain and its external anchor (audit_log.02, .11, .12; docs/phases/33-tests/29-open-defects).
--
--   audit_logs.subjectDigest       the keyed digest of the person-bearing fields (actor, on-behalf-of, metadata, IP, user agent) that a keyed
--                                  legacy row hashes in their place; NULL on v1 and sealed rows.
--   audit_logs.erasureSeal         the keyed seal a right-to-erasure writes over the values it left; NULL until erased.
--   audit_legacy_chain_heads       one row per tenant: the legacy chain's head hash, row count and post-purge base, sealed with the chain key,
--                                  written in the same transaction as each legacy write and each retention purge.
--
-- Purely additive: the previous release neither reads nor writes these objects. Mirrors the entities (same names). Tenant RLS like every
-- tenant table. Idempotent.

ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "subjectDigest" character varying(64);
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "erasureSeal" character varying(64);

CREATE TABLE IF NOT EXISTS "audit_legacy_chain_heads" (
  "tenantId" uuid NOT NULL,
  "headHash" character varying(64),
  "rowCount" integer NOT NULL,
  "baseHash" character varying(64),
  "seal" character varying(64) NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_audit_legacy_chain_heads" PRIMARY KEY ("tenantId")
);

ALTER TABLE "audit_legacy_chain_heads" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "audit_legacy_chain_heads";
DROP POLICY IF EXISTS tenant_admin_bypass ON "audit_legacy_chain_heads";
CREATE POLICY tenant_isolation ON "audit_legacy_chain_heads"
       USING ("tenantId" = (SELECT app_current_tenant()))
       WITH CHECK ("tenantId" = (SELECT app_current_tenant()));
CREATE POLICY tenant_admin_bypass ON "audit_legacy_chain_heads" TO app_admin
       USING ((SELECT app_rls_bypass()))
       WITH CHECK ((SELECT app_rls_bypass()));
