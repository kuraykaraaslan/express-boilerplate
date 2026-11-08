-- kind: expand; reversible: true
-- supersedes: a1f25d03872731cd32d616d159af572cd1e9a86bbd8f3b55294f6af4bcf3adcc,d04eb09fded7cb3878a3f6b3f2b050fa6c43a323beea94321617420354111b0d,d1c60e11f3de50226baff621fce2f43ea0f2c95c9a75c4bdf63e801d311d514e,d56e786956e6b5b78110d3ce65bb72c0bc468cb83f771c9411d8ef85df262137
-- storage 001: the retention columns of "uploaded_files" (docs/phases/37-extensions/11, section "2026-10-17: retention-aware purge").
--
-- A tenant purge used to delete every stored object of the tenant, including issued invoice PDFs and documents whose retention had
-- not ended. It now stamps each file of the purged tenant: "retainUntil" is when a module's retention of it ends (the file is kept until
-- then and asked about again), "retentionReason" says which module keeps it and why. Both stay null while the tenant lives.
--
-- Purely additive: nullable columns, so the previous release keeps reading and writing "uploaded_files" unchanged and a rollback leaves
-- columns it ignores. Column types and names are TypeORM's for `@Column({ type: 'timestamp', nullable: true })` and
-- `@Column({ type: 'varchar', length: 255, nullable: true })`. Idempotent, and a no-op while the table does not exist yet; the deploy
-- runner wraps each file in a transaction.

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.uploaded_files') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "uploaded_files" ADD COLUMN IF NOT EXISTS "retainUntil" TIMESTAMP NULL;
  ALTER TABLE "uploaded_files" ADD COLUMN IF NOT EXISTS "retentionReason" character varying(255) NULL;
END $$;
