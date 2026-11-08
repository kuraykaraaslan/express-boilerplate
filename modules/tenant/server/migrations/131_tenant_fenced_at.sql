-- kind: expand; reversible: true
-- supersedes: 27593caee4601539f40cff6832069b46f58ae959e8a837589e2304e707f73c22,54d8264fc645044bb1d3453291a4da94764c808468ca7bc691b0a4947314a172,b33dac0762e05b76a7ac2f6e77b230c593d131fee4909a40d51b34e833befaa0,d481cbe9b4f56d094ee31b8531af4dcdf315046b2fe67e8e4d32bcd968250cf1
-- tenant 131: "tenants"."fencedAt", when this node was fenced as the tenant's OLD home (docs/phases/02-fleet/decisions-2026-10-18.md F1).
--
-- A returning old primary that hears, through the heartbeat's tenantStatusDelta, that a higher assignment version homes its tenant elsewhere records the
-- new home and stamps this column (tenant.migration.service.ts fenceAfterDirectoryMove). The stamp is what keeps the old home read-only for every writer,
-- not only HTTP: the db write fence (db.write-fence.ts) opens each tenant-scoped transaction of a stamped tenant READ ONLY, like a MIGRATING one, and
-- routing answers it with its own FENCED refusal instead of the "misplaced" error. A failback's go-live clears it.
--
-- Purely additive: a nullable column without a default, so the previous release keeps reading and writing "tenants" unchanged and a rollback leaves a
-- column it ignores. Type and name are the entity's. Idempotent, and a no-op while the table does not exist yet.

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenants') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "fencedAt" TIMESTAMP WITH TIME ZONE;
END $$;
