-- kind: expand; reversible: true
-- api_key 002: per-module API key permissions (docs/phases/48-api-key-scopes, lead decisions D11-D14).
--
--   api_keys.permissions   the module permission ids the key may use on module routes (simple-array text). NULL only on a row
--                          written before this phase; every insert since writes it.
--   api_keys.scopeReview   the key should be reviewed by an admin (D14).
--
-- D14 (D48-7): every existing key gets an explicit, empty permission list, which is what it can do on module routes today (no
-- module route accepted a key before), keeps its scopes (the machine routes keep working) and is marked for review. The backfill
-- picks the rows by "permissions IS NULL", so it also catches the rows of a database where synchronize created the columns first,
-- and a second run changes nothing. Additive: the previous release neither reads nor writes these columns. Mirrors the entity.
-- DOWN: 002_api_key_permissions.sql.down.

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "permissions" text;
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "scopeReview" boolean NOT NULL DEFAULT false;
UPDATE "api_keys" SET "permissions" = '', "scopeReview" = true WHERE "permissions" IS NULL;
