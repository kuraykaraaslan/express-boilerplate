-- kind: expand
-- audit_log 006: retention checkpoints for a sealed chain, step 1 of 2 - the tables (docs/phases/02-fleet/04-security-model.md section 7).
--
--   audit_chain_anchors       the chain heads the control plane has ACKNOWLEDGED (one row per tenant and attestation): the proof that a row was witnessed
--                             outside the node. Written by the node app when the agent reports a verified ack (the anchoring seam).
--   audit_chain_checkpoints   one row per retention purge, recorded before any row is deleted: up to which row the chain was purged, the hash that row had
--                             (what the first kept row must link to) and how many rows went. Created only by audit_chain_checkpoint() (007).
--   audit_chain_policy        gains "retentionDays": how long a SEALED chain is kept, in a table the platform operator writes, not in a tenant setting.
--
-- Additive: nothing reads these until the functions of 007 are called. Tenant-scoped like 001's tables: the generated tenant_isolation / tenant_admin_bypass pair.
-- Every index and CHECK is mirrored in the entities (synchronize drops what the entities do not declare).

CREATE TABLE IF NOT EXISTS "audit_chain_anchors" (
  "anchorId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "attestationId" uuid NOT NULL,
  "headHash" character varying(64) NOT NULL,
  "rowCount" integer NOT NULL,
  "ackedAt" TIMESTAMP NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "ck_audit_chain_anchors_values" CHECK ("headHash" ~ '^[a-f0-9]{64}$' AND "rowCount" > 0),
  CONSTRAINT "PK_audit_chain_anchors" PRIMARY KEY ("anchorId")
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_audit_chain_anchors_attestation" ON "audit_chain_anchors" ("tenantId", "attestationId");
CREATE INDEX IF NOT EXISTS "IDX_audit_chain_anchors_tenant_acked" ON "audit_chain_anchors" ("tenantId", "ackedAt");

CREATE TABLE IF NOT EXISTS "audit_chain_checkpoints" (
  "checkpointId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "coveredThrough" TIMESTAMP NOT NULL,
  "coveredThroughId" uuid NOT NULL,
  "headHash" character varying(64) NOT NULL,
  "rowCount" integer NOT NULL,
  "purgedTotal" bigint NOT NULL,
  "anchorId" uuid NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "ck_audit_chain_checkpoints_values" CHECK ("headHash" ~ '^[a-f0-9]{64}$' AND "rowCount" > 0 AND "purgedTotal" >= "rowCount"),
  CONSTRAINT "PK_audit_chain_checkpoints" PRIMARY KEY ("checkpointId")
);
CREATE INDEX IF NOT EXISTS "IDX_audit_chain_checkpoints_tenant_through" ON "audit_chain_checkpoints" ("tenantId", "coveredThrough");

ALTER TABLE "audit_chain_policy" ADD COLUMN IF NOT EXISTS "retentionDays" integer;
DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conname = 'ck_audit_chain_policy_retention'
       AND c.conrelid = to_regclass(quote_ident(current_schema()) || '.audit_chain_policy')
  ) THEN
    ALTER TABLE "audit_chain_policy" ADD CONSTRAINT "ck_audit_chain_policy_retention" CHECK ("retentionDays" IS NULL OR "retentionDays" > 0);
  END IF;
END
$mig$;

ALTER TABLE "audit_chain_anchors" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "audit_chain_anchors";
DROP POLICY IF EXISTS tenant_self ON "audit_chain_anchors";
DROP POLICY IF EXISTS tenant_admin_bypass ON "audit_chain_anchors";
CREATE POLICY tenant_isolation ON "audit_chain_anchors"
       USING ("tenantId" = (SELECT app_current_tenant()))
       WITH CHECK ("tenantId" = (SELECT app_current_tenant()));
CREATE POLICY tenant_admin_bypass ON "audit_chain_anchors" TO app_admin
       USING ((SELECT app_rls_bypass()))
       WITH CHECK ((SELECT app_rls_bypass()));

ALTER TABLE "audit_chain_checkpoints" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "audit_chain_checkpoints";
DROP POLICY IF EXISTS tenant_self ON "audit_chain_checkpoints";
DROP POLICY IF EXISTS tenant_admin_bypass ON "audit_chain_checkpoints";
CREATE POLICY tenant_isolation ON "audit_chain_checkpoints"
       USING ("tenantId" = (SELECT app_current_tenant()))
       WITH CHECK ("tenantId" = (SELECT app_current_tenant()));
CREATE POLICY tenant_admin_bypass ON "audit_chain_checkpoints" TO app_admin
       USING ((SELECT app_rls_bypass()))
       WITH CHECK ((SELECT app_rls_bypass()));
