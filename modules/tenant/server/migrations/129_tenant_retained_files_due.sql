-- kind: expand; reversible: true
-- supersedes: 33c58f75b0c5b92821692a400a97db880ee301e16da78a6e622600147356a363,3b33c17173748731e91d65b4ca1da920b73a1a405cc3cdbd258a495804dd5423,7af993a677b4b9849d16b6bb5f007e61f408eaf61b8a3778fa8f1e1c09beaa8d,8a99bc6af739125a8f79efc02956c1c491079badb3b206a68c81aee85baa207d
-- tenant 129: "tenants"."retainedFilesDueAt", the retention-aware purge's marker (docs/phases/37-extensions/11, section
-- "2026-10-17: retention-aware purge").
--
-- A purge keeps the stored files a module must still retain (issued invoices, documents under retention or legal hold) and deletes
-- them once their retention ends. This column says when a purged tenant's next retained file needs a verdict, so the daily sweep
-- reads only the tenants that have work instead of every tenant ever purged. Null on every live tenant and on every purged tenant
-- with no file left waiting. The files themselves carry their dates (storage 001, "uploaded_files"."retainUntil").
--
-- Purely additive: a nullable column, so the previous release keeps reading and writing "tenants" unchanged and a rollback leaves a
-- column it ignores. Type and name are TypeORM's for `@Column({ type: 'timestamp', nullable: true })`. Idempotent, and a no-op while
-- the table does not exist yet.

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenants') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "retainedFilesDueAt" TIMESTAMP NULL;
END $$;
