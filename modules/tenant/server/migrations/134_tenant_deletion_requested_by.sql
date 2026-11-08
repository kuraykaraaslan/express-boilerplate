-- kind: expand; reversible: true
-- tenant 134: "tenants"."deletionRequestedBy", who asked for a tenant's pending deletion (docs/phases/40-ui-fixes/04-tenant-setting.md 1.7).
--
-- The deletion-request route lets a tenant's own OWNER schedule and cancel its deletion next to the platform operator. An owner may cancel only a
-- deletion an owner asked for (or the last member's account self-service deletion), never one the platform operator or the fleet control plane
-- scheduled. This column records the requester: OWNER, OPERATOR, FLEET or SELF_SERVICE, written by TenantDeletionService.requestDeletion together
-- with "deletionRequestedAt" and cleared with it on cancel.
--
-- Purely additive: a nullable column without a default and a CHECK every existing row passes (they all have a null requester), so the previous
-- release still reads and writes "tenants". No backfill: who asked for a deletion already pending is not recorded anywhere, so it stays NULL, and
-- the owner's cancel treats NULL as the operator's (fail closed). Type, name and CHECK are the entity's. Idempotent, and a no-op while the table
-- does not exist yet.
--
-- Rollback / mixed versions: the previous release neither writes nor clears this column, so while it runs after 134 the requester goes stale
-- (its cancel leaves an ACTIVE row with the old value; its re-request keeps the old value on a new PENDING_DELETION, e.g. an operator's deletion
-- still reading OWNER, which the owner could then cancel). On roll-forward after such a window, null the column on every row that is not
-- PENDING_DELETION and on the pending rows the old release wrote (deletionRequestedAt inside the window), in a later idempotent migration:
--   UPDATE "tenants" SET "deletionRequestedBy" = NULL WHERE "tenantStatus" <> 'PENDING_DELETION' OR "deletionRequestedAt" >= <window start>;

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenants') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "deletionRequestedBy" character varying(16);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenants_deletion_requested_by' AND conrelid = '"tenants"'::regclass) THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "ck_tenants_deletion_requested_by"
      CHECK ("deletionRequestedBy" IS NULL OR "deletionRequestedBy" IN ('OWNER', 'OPERATOR', 'FLEET', 'SELF_SERVICE'));
  END IF;
END $$;
