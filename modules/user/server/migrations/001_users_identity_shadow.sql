-- kind: expand; reversible: true
-- supersedes: 3afed20988573cf04a6c54b657499f2748fc2d7cbc24a9b19651d1ab8328119c,5626d89d4c0f9a1566916449cfc16d98738b833c814cef83355f1dfeec89e520,97df30df56145dbad13c1b40deb9390a6b5db69d0ee37cae2db0e8e6e4b8518d,c2805800677f633a5e6f146209ae46fbe562f7d7f82f12bac6a57ec024624cc4
-- user 001: shadow users of Fleet ID on a tenant node (FID-07; docs/phases/02-fleet/12-fleet-identity.md sections 2 and 4.2; decisions F10, F14).
--
-- On a node whose people log in through Fleet ID, a person is a SHADOW user: the row carries the pairwise subject the hub issued for this node
-- (`identitySub`, F14: base64url of an HMAC, so two nodes cannot correlate a person) and no local credential. Three changes:
--  - `identitySub`: nullable, unique among the rows that have one (`uq_users_identity_sub`, partial), restricted to the base64url alphabet and
--    16 to 128 characters (`ck_users_identity_sub`). A local account has none.
--  - `emailReleased`: whether `email` is the person's real address released by the hub (F10: only with an accepted workspace membership on this
--    node and the person's agreement) or a synthetic, non-routable placeholder. Default false.
--  - `password` becomes nullable: a shadow user has no password. `ck_users_credential_or_identity` keeps every other row as it was: a row
--    without a password must carry an `identitySub`, so a local account can never lose its password by accident.
--
-- Expand: the previous release never writes NULL into `password` and never reads the two new columns; every existing row has a password, so the
-- CHECK validates at once. The entity declares the same columns, index and CHECKs by name, so a synchronize-mode deploy builds the same shape.
-- `users` is a platform table (no tenantId): no RLS pair. Guarded on to_regclass and pg_constraint, so it is idempotent and skips a database
-- without the table.
--
-- Down (exact reverse; refuses while a shadow user exists, which is the point: delete or convert the shadows first):
--   ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "ck_users_credential_or_identity";
--   ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "ck_users_identity_sub";
--   DROP INDEX IF EXISTS "uq_users_identity_sub";
--   ALTER TABLE "users" ALTER COLUMN "password" SET NOT NULL;
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "emailReleased";
--   ALTER TABLE "users" DROP COLUMN IF EXISTS "identitySub";

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.users') IS NOT NULL THEN
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "identitySub" character varying(128);
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailReleased" boolean NOT NULL DEFAULT false;
    ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_identity_sub" ON "users" ("identitySub") WHERE "identitySub" IS NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_users_identity_sub' AND conrelid = to_regclass(quote_ident(current_schema()) || '.users')) THEN
      ALTER TABLE "users" ADD CONSTRAINT "ck_users_identity_sub" CHECK ("identitySub" IS NULL OR "identitySub" ~ '^[A-Za-z0-9_-]{16,128}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_users_credential_or_identity' AND conrelid = to_regclass(quote_ident(current_schema()) || '.users')) THEN
      ALTER TABLE "users" ADD CONSTRAINT "ck_users_credential_or_identity" CHECK ("password" IS NOT NULL OR "identitySub" IS NOT NULL);
    END IF;
  END IF;
END $$;
