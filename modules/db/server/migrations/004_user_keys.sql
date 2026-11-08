-- kind: expand; reversible: true
-- db 004: user_keys, the per-user data keys of field-encryption v2 (decision F27; P7-TDEK, docs/phases/02-fleet/04 section 3).
--
-- One row per user data key (UDEK): kid `udek-<userId>-<generation>`, its state (ACTIVE encrypts, RETIRED only decrypts, DESTROYED is gone), the
-- provider that wrapped it, the WRAPPED key (never a raw one) and, under a legal hold, an escrow copy wrapped under the hold slot. It protects a
-- person's user-level secrets (social-login OAuth tokens, the auth TOTP secret), which belong to no single tenant. Same shape and guard as
-- tenant_keys (db 002, 003), in a table of its own so that no constraint of tenant_keys is relaxed and no tenant code path that reads tenant_keys by
-- tenantId can meet a user's key. Node-local and user-level by design: it lives in the node's control database only, only the key service reads it,
-- in system context; RLS-exempt like tenant_keys (modules/db/scripts/gen-rls-policies.mts gives the reason); no tenant column, so never part of a
-- migration bundle or a tenant export.
--
-- Purely additive: the previous release neither reads nor writes it. Every CHECK and index is mirrored on the entity (same names), so TypeORM
-- synchronize on single-role deployments builds the same table; this file does it for databases that run in migrate mode, and adds the guard
-- trigger synchronize cannot express. Idempotent.

CREATE TABLE IF NOT EXISTS "user_keys" (
  "kid" character varying(80) NOT NULL,
  "userId" uuid NOT NULL,
  "generation" integer NOT NULL,
  "state" character varying(16) NOT NULL DEFAULT 'ACTIVE',
  "provider" character varying(16) NOT NULL,
  "wrappedDek" text,
  "escrowWrappedDek" text,
  "escrowUntil" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "retiredAt" TIMESTAMP WITH TIME ZONE,
  "destroyedAt" TIMESTAMP WITH TIME ZONE,
  "destroyReason" character varying(32),
  "slotsPendingAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "ck_user_keys_kid" CHECK ("generation" >= 1 AND "kid" = 'udek-' || "userId"::text || '-' || "generation"::text),
  CONSTRAINT "ck_user_keys_state" CHECK ("state" IN ('ACTIVE', 'RETIRED', 'DESTROYED') AND ("state" = 'DESTROYED') = ("wrappedDek" IS NULL) AND ("state" = 'DESTROYED') = ("destroyedAt" IS NOT NULL) AND ("destroyedAt" IS NULL) = ("destroyReason" IS NULL) AND ("state" <> 'RETIRED' OR "retiredAt" IS NOT NULL)),
  CONSTRAINT "ck_user_keys_provider" CHECK ("provider" IN ('node-key', 'file', 'kms', 'vault')),
  CONSTRAINT "ck_user_keys_escrow" CHECK (("escrowWrappedDek" IS NULL) = ("escrowUntil" IS NULL)),
  CONSTRAINT "PK_user_keys" PRIMARY KEY ("kid")
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_keys_active" ON "user_keys" ("userId") WHERE "state" = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_keys_generation" ON "user_keys" ("userId", "generation");
CREATE INDEX IF NOT EXISTS "ix_user_keys_slots_pending" ON "user_keys" ("userId") WHERE "slotsPendingAt" IS NOT NULL;

-- ─── guard ───────────────────────────────────────────────────────────────────
-- What an entity cannot express. The identity of a key (kid, user, generation, provider, creation) never changes, a key never moves back to ACTIVE
-- once retired, and a destroyed key stays destroyed: no wrapped key can be written into a DESTROYED row again (only its escrow may still be released).

CREATE OR REPLACE FUNCTION user_keys_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."kid" IS DISTINCT FROM OLD."kid"
     OR NEW."userId" IS DISTINCT FROM OLD."userId"
     OR NEW."generation" IS DISTINCT FROM OLD."generation"
     OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'user_keys: the identity of a key is never changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."state" <> 'ACTIVE' AND NEW."state" = 'ACTIVE' THEN
    RAISE EXCEPTION 'user_keys: a retired or destroyed key is never active again' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."state" = 'DESTROYED'
     AND (NEW."state" <> 'DESTROYED' OR NEW."wrappedDek" IS NOT NULL OR NEW."destroyedAt" IS DISTINCT FROM OLD."destroyedAt"
          OR (NEW."escrowWrappedDek" IS NOT NULL AND NEW."escrowWrappedDek" IS DISTINCT FROM OLD."escrowWrappedDek")) THEN
    RAISE EXCEPTION 'user_keys: a destroyed key stays destroyed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_keys_guard ON "user_keys";
CREATE TRIGGER user_keys_guard BEFORE UPDATE ON "user_keys" FOR EACH ROW EXECUTE FUNCTION user_keys_guard();
