-- kind: expand; reversible: true
-- supersedes: 91ad415c176af6c5fd9a18625892351b50c7a18127473e7a32d7381b02ed3678,92f157adc57822fe364eb09d86d9624ae09233b42a9b2ebad199918440cb9d18,a7b7a1c86d8efc9adf1a6b37b463647436fb2810d9c64a14f12d0efd4a0bfd38,b145cfaf623348e70c418e29cf9ef46af7ae19f6d5d02cc7934de59f8ec44fae
-- db 003: "tenant_keys"."slotsPendingAt", when a destroy of this key could not destroy its provider slot (P7-TDEK crypto-shredding).
--
-- `tenantKeys.destroy` marks a key DESTROYED in one transaction and destroys its provider slots (the wrapped key outside the database with the `file`
-- provider, and its hold slot) after the commit. A slot that fails there used to leave no trace but the purge receipt's TDEK_PENDING_SLOTS: the row was
-- already DESTROYED, so the key-shredding sweep, which looked only for keys not DESTROYED, never retried it, and a pre-purge backup kept opening the
-- key. The destroy now stamps this column on every key whose slot is still pending and clears it once a later destroy reached every slot; the sweep
-- (tenant.deletion.service.ts PURGED_TENANTS_WITH_LIVE_KEYS_SQL) reruns the destroy for such keys.
--
-- Purely additive: a nullable column without a default, outside the guard trigger's identity and state checks, so the previous release keeps reading
-- and writing "tenant_keys" unchanged and a rollback leaves a column it ignores. The partial index keeps the sweep's probe cheap. Type and names are
-- the entity's. Idempotent, and a no-op while the table does not exist yet.

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenant_keys') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "tenant_keys" ADD COLUMN IF NOT EXISTS "slotsPendingAt" TIMESTAMP WITH TIME ZONE;
  CREATE INDEX IF NOT EXISTS "ix_tenant_keys_slots_pending" ON "tenant_keys" ("tenantId") WHERE "slotsPendingAt" IS NOT NULL;
END $$;
