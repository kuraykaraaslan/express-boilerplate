-- kind: expand; reversible: true
-- supersedes: 0dcefb57df89639ad4fe9d670fa0b781f52eb93801abbc800d652ef415c7c5f3,5500fd8c54795f54d139ce7202943231b4e665b0976caba6a997f146f6a372eb,560df19511075fdc31701177294d1002840768256d86196668111079d63a41e6,670ea9e282d8f54c16bc0b30681106e66beb65d6e1c4e01b81e8c2bb80cd4909,8f20ae1093d34bd4bad78759b994bea2252a6ecb8c7098ce59e8cf82c3a03544
-- db 001: tenant_databases gains databaseUrlEnc, regionId, status and schemaVersion (EXPAND phase of the DSN encryption).
--
-- Purely additive and backward compatible: the previous release only knows "databaseUrl", keeps writing it, and never
-- reads the new columns (status defaults to ACTIVE). The readers of this release prefer "databaseUrlEnc" and fall back
-- to "databaseUrl"; the TypeScript backfill in the deploy pipeline fills "databaseUrlEnc" for existing rows. A later
-- `contract` migration drops the plaintext column. TypeORM synchronize creates the same columns and CHECKs on
-- single-role deployments; this file does it for databases that run in migrate mode. Idempotent, and a no-op while the
-- table does not exist yet (a migrate-mode node before the baseline migration: that migration creates it in this shape).
-- 2026-10-21 (integration lane 2): the plaintext statements run only while "databaseUrl" exists. A schema the entities built
-- (synchronize mode, db.02: the entity has no plaintext column) failed here with "column databaseUrl does not exist"; there the
-- has-url CHECK is the entity's own ciphertext-only one.

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenant_databases') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass(quote_ident(current_schema()) || '.tenant_databases')
               AND attname = 'databaseUrl' AND attnum > 0 AND NOT attisdropped) THEN
    ALTER TABLE "tenant_databases" ALTER COLUMN "databaseUrl" DROP NOT NULL;
  END IF;
  ALTER TABLE "tenant_databases" ADD COLUMN IF NOT EXISTS "databaseUrlEnc" text;
  ALTER TABLE "tenant_databases" ADD COLUMN IF NOT EXISTS "regionId" varchar(64);
  ALTER TABLE "tenant_databases" ADD COLUMN IF NOT EXISTS "status" varchar(16) NOT NULL DEFAULT 'ACTIVE';
  ALTER TABLE "tenant_databases" ADD COLUMN IF NOT EXISTS "schemaVersion" varchar(32);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenant_databases_status' AND conrelid = '"tenant_databases"'::regclass) THEN
    ALTER TABLE "tenant_databases" ADD CONSTRAINT "ck_tenant_databases_status"
      CHECK ("status" IN ('PROVISIONING', 'ACTIVE', 'DROPPED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenant_databases_has_url' AND conrelid = '"tenant_databases"'::regclass) THEN
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = '"tenant_databases"'::regclass
                 AND attname = 'databaseUrl' AND attnum > 0 AND NOT attisdropped) THEN
      ALTER TABLE "tenant_databases" ADD CONSTRAINT "ck_tenant_databases_has_url"
        CHECK ("databaseUrl" IS NOT NULL OR "databaseUrlEnc" IS NOT NULL);
    ELSE
      ALTER TABLE "tenant_databases" ADD CONSTRAINT "ck_tenant_databases_has_url" CHECK ("databaseUrlEnc" IS NOT NULL);
    END IF;
  END IF;
END $$;
