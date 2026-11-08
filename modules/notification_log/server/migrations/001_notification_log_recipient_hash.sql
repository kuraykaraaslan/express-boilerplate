-- kind: expand; reversible: true
-- supersedes: 1c8c6e321f93ed015e2e2e4592614bf606ade6ad53e9deaecbceb15fe1a8b3c4,1ea7e24e79ee9674a36ae6d4ed99eb63bbdeb8c4d9aa74b309c94061d72a947d,9f098ea4b5793d4a1149d8bee60050292114f8966f501bd05273b951b28d8a6a,b65786b069ddacd006e8e9ebff8e8d3fb2c2a270aeb121284af8d80d887ba041
-- notification_log 001: the blind index of a sealed recipient (P7-TDEK, decision F16 of docs/phases/02-fleet/decisions-2026-10-18.md).
--
-- `notification_logs.recipient` is now written as a field-encryption v2 envelope under the tenant's data key, with a random IV, so equality on it
-- no longer finds a row. `recipientHash` holds the keyed HMAC of the normalised recipient under the same key (tenantKeys.blindIndex): the exact
-- recipient filter and the right-to-erasure look rows up by it. Nullable: legacy plaintext rows, scrubbed rows and nodes without tenant keys have
-- none, and the readers keep matching those by the plaintext column (dual read, F17) until the online backfill fills it.
--
-- Purely additive: the previous release neither reads nor writes the column. The entity declares the same column and index by name, so a
-- synchronize-mode deploy builds the same shape. No CONCURRENTLY: the deploy runner wraps each migration in a transaction. RLS is unchanged
-- (the table's tenant_isolation policy covers the new column). Guarded on to_regclass so a deployment without the table skips it. Idempotent.
--
-- Down (exact reverse; the readers fall back to the plaintext column, so sealed rows are then only found by a full scan):
--   DROP INDEX IF EXISTS "idx_notification_logs_tenant_recipient_hash";
--   ALTER TABLE "notification_logs" DROP COLUMN IF EXISTS "recipientHash";

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.notification_logs') IS NOT NULL THEN
    ALTER TABLE "notification_logs" ADD COLUMN IF NOT EXISTS "recipientHash" character varying(64);
    CREATE INDEX IF NOT EXISTS "idx_notification_logs_tenant_recipient_hash" ON "notification_logs" ("tenantId", "recipientHash");
  END IF;
END $$;
