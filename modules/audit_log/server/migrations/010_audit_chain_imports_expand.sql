-- kind: expand
-- audit_log 010: the record of an audit history that arrived with a tenant migration, step 1 of 2 - the table (docs/phases/02-fleet/05-tenancy-and-routing.md
-- section 6.4 "Audit chain": a history whose chain does not verify or whose head is not proven against the source's acknowledged root is imported as
-- IMPORTED_UNVERIFIED rows behind a checkpoint).
--
--   audit_chain_imports   one row per import of a tenant's history onto this node: the source node, the verdict (PROVEN | IMPORTED_UNVERIFIED | EMPTY),
--                         how the chain recomputed (VERIFIED | BROKEN | NOT_VERIFIABLE), whether the head was proven, and the boundary: every row up to and
--                         including (coveredThrough, coveredThroughId) is the imported history. Written only by audit_chain_import_record() (011).
--
-- Purely additive: nothing writes it until 011's function is called by an import, and the previous release does not know it. Tenant-scoped like 006's
-- tables (the tenant_isolation / tenant_admin_bypass pair); it travels with the tenant in a migration bundle, like the checkpoints. The CHECK and the
-- index are mirrored on the entity (same names). Idempotent.

CREATE TABLE IF NOT EXISTS "audit_chain_imports" (
  "importId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "sourceNodeId" character varying(64) NOT NULL,
  "verdict" character varying(24) NOT NULL,
  "chainStatus" character varying(16) NOT NULL,
  "headProven" boolean NOT NULL,
  "coveredThrough" TIMESTAMP,
  "coveredThroughId" uuid,
  "headHash" character varying(64),
  "rowCount" integer NOT NULL,
  "importedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "ck_audit_chain_imports_values" CHECK ("verdict" IN ('PROVEN', 'IMPORTED_UNVERIFIED', 'EMPTY') AND "chainStatus" IN ('VERIFIED', 'BROKEN', 'NOT_VERIFIABLE') AND "rowCount" >= 0 AND ("headHash" IS NULL OR "headHash" ~ '^[a-f0-9]{64}$') AND ("coveredThrough" IS NULL) = ("coveredThroughId" IS NULL) AND ("verdict" = 'EMPTY') = ("coveredThroughId" IS NULL) AND ("verdict" <> 'PROVEN' OR ("headProven" AND "chainStatus" = 'VERIFIED'))),
  CONSTRAINT "PK_0ecafe688d5ba110bbac7af4667" PRIMARY KEY ("importId")
);
CREATE INDEX IF NOT EXISTS "IDX_audit_chain_imports_tenant_imported" ON "audit_chain_imports" ("tenantId", "importedAt");

ALTER TABLE "audit_chain_imports" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "audit_chain_imports";
DROP POLICY IF EXISTS tenant_self ON "audit_chain_imports";
DROP POLICY IF EXISTS tenant_admin_bypass ON "audit_chain_imports";
CREATE POLICY tenant_isolation ON "audit_chain_imports"
       USING ("tenantId" = (SELECT app_current_tenant()))
       WITH CHECK ("tenantId" = (SELECT app_current_tenant()));
CREATE POLICY tenant_admin_bypass ON "audit_chain_imports" TO app_admin
       USING ((SELECT app_rls_bypass()))
       WITH CHECK ((SELECT app_rls_bypass()));
