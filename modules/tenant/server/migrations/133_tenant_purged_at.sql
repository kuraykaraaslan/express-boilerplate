-- kind: expand; reversible: true
-- supersedes: 6a5c4b1e2aa36a77136b6a2c8a8a9c628a14fa07108a53f8eb0d7998d5036a8b,874e57a158f1d5cb94ef09a6e196b10bfc8e8606196d8bdf078c48687bab2846,a8f76e12ae86f95e28f4affc10c25082a5bf91b43f56e354201d643e1ee0992a,ddbabc372998f78183d6865e1223c263fc28aa19eaff3df4a7f8f07df8d738bc
-- tenant 133: "tenants"."purgedAt", when this node actually purged the tenant (P7-TDEK crypto-shredding; the deletion purge or a migration's source purge).
--
-- The key-shredding sweep (tenant.deletion.service.ts sweepPurgedTenantKeys) retries the destroy of the data keys of purged tenants. It used to take
-- every row with "deletedAt" set for purged, but the admin soft delete (tenant.write.service.ts remove) sets "deletedAt" too, without any purge: the
-- sweep then destroyed that tenant's keys for good (reason TENANT_PURGE) while its rows were still in the database. And a migration's source purge
-- leaves a RELOCATED tombstone whose "deletedAt" stays NULL, so a destroy that failed there was never retried. This column is the purge's own mark:
-- set by the deletion purge in the same conditional update that claims the tenant, and by the source purge in the transaction that removes the
-- tenant's rows. Nothing else writes it.
--
-- Purely additive: a nullable column without a default, so the previous release keeps reading and writing "tenants" unchanged and a rollback leaves a
-- column it ignores. The backfill marks the tenants the previous release purged (claimed PENDING_DELETION with "deletedAt" at or after their
-- "deleteAfter", which the admin soft delete cannot produce for a tenant that was never scheduled); the source purges of earlier releases are not
-- recognisable after the fact and keep NULL (their receipts carry the destroy outcome). Type and name are the entity's. Idempotent, and a no-op
-- while the table does not exist yet.

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenants') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "purgedAt" TIMESTAMP WITH TIME ZONE;
  UPDATE "tenants" SET "purgedAt" = "deletedAt"
   WHERE "purgedAt" IS NULL AND "deletedAt" IS NOT NULL AND "tenantStatus" = 'PENDING_DELETION' AND "deleteAfter" IS NOT NULL AND "deletedAt" >= "deleteAfter";
END $$;
