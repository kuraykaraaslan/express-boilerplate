-- kind: expand; reversible: true
-- approval 001: the keyed decision chain and its external anchor (approval.06 and approval.08, docs/phases/33-tests/29-open-defects).
--
--   approval_queue_items.decisionHash   the keyed seal over the row's decision state (status, reviewer, note, reviewedAt), bound to its rowHash.
--                                       NULL on rows written before this release; required on every v2 (keyed) row.
--   approval_chain_heads                one row per tenant: the newest rowHash on the chain and the chain's length, written in the same
--                                       transaction as each link, sealed with the chain key. verifyChain compares against it, so a truncated chain is reported.
--
-- Purely additive: the previous release neither reads nor writes either object. Mirrors the entities (same names). Tenant RLS like every
-- tenant table. Idempotent.

ALTER TABLE "approval_queue_items" ADD COLUMN IF NOT EXISTS "decisionHash" character varying(64);

CREATE TABLE IF NOT EXISTS "approval_chain_heads" (
  "tenantId" uuid NOT NULL,
  "headHash" character varying(64) NOT NULL,
  "length" integer NOT NULL,
  "seal" character varying(64) NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_approval_chain_heads" PRIMARY KEY ("tenantId")
);

ALTER TABLE "approval_chain_heads" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "approval_chain_heads";
DROP POLICY IF EXISTS tenant_admin_bypass ON "approval_chain_heads";
CREATE POLICY tenant_isolation ON "approval_chain_heads"
       USING ("tenantId" = (SELECT app_current_tenant()))
       WITH CHECK ("tenantId" = (SELECT app_current_tenant()));
CREATE POLICY tenant_admin_bypass ON "approval_chain_heads" TO app_admin
       USING ((SELECT app_rls_bypass()))
       WITH CHECK ((SELECT app_rls_bypass()));
