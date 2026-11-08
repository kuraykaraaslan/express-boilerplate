-- kind: contract; reversible: false
-- supersedes: 481aae099810543f2ba561aa20014c900df5bead313fb6b1018e585bc8721dad,586d0b67f0da33c28a3a4f1f0de056b77f1f056fb0a9c66dd4a80e5b3ba950c0,67f84abfe002233527f0f707f97f8459c0acf550b7c1ae6970ebf0108d6e6fa3,823596a3f01f597f45cfba5268a3b4aa646eaa8f8190026d0259e313e7d91993,93d9f71c5c4da0ef50fba1cb6942bf7fe2edbae756b29ee60b5c7893305bff6f
-- db 007: the CONTRACT phase of the tenant database URL encryption (db.02, docs/phases/33-tests/29-open-defects; decided
-- 2026-10-21: "a guarded migration that backfills, then drops the plaintext column in this release, and refuses to run while
-- any row still lacks ciphertext. No one-release staging.").
--
-- The backfill is TypeScript (it needs SETTINGS_ENCRYPTION_KEY): the deploy runs it BEFORE the schema step
-- (db.tenant-database.backfill.ts `assertPlaintextDropSafe`, called from db.deploy.ts) and stops there while a row would lose
-- its address. This file repeats the refusal in SQL, so it can never drop the column under a row that has only the plaintext,
-- whatever ran before it. Then the CHECK is rewritten to require the ciphertext and the plaintext column is dropped.
--
-- Not reversible: the plaintext is gone (by decision there is no N-1 release that reads it). A no-op while the table does not
-- exist yet, and once the column is gone. On the single role `synchronize` makes the same change from the entity.

DO $$
DECLARE left_rows integer;
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenant_databases') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = to_regclass(quote_ident(current_schema()) || '.tenant_databases') AND attname = 'databaseUrl' AND attnum > 0 AND NOT attisdropped
  ) THEN
    RETURN;
  END IF;

  SELECT count(*) INTO left_rows FROM "tenant_databases"
   WHERE "databaseUrlEnc" IS NULL AND "databaseUrl" IS NOT NULL AND "databaseUrl" <> '';
  IF left_rows > 0 THEN
    RAISE EXCEPTION 'db.02: % tenant database URL(s) have no ciphertext; configure SETTINGS_ENCRYPTION_KEY and run the deploy backfill first', left_rows;
  END IF;

  ALTER TABLE "tenant_databases" DROP CONSTRAINT IF EXISTS "ck_tenant_databases_has_url";
  ALTER TABLE "tenant_databases" ADD CONSTRAINT "ck_tenant_databases_has_url" CHECK ("databaseUrlEnc" IS NOT NULL) NOT VALID;
  ALTER TABLE "tenant_databases" DROP COLUMN "databaseUrl";
END $$;
