-- kind: expand; reversible: true
-- db 005: user_key_erasures, the durable and final record of a person's erasure for the per-user data keys (decision F27; P7-TDEK review).
--
-- Before this table the only trace that a user was erased was a `user_keys` row destroyed with reason USER_ERASURE. A user who never had a key
-- left no such row, so a later write (a request on a still-valid session, the online backfill re-sealing a value a failed erasure step left behind)
-- created a fresh ACTIVE key for an erased person; and a destroy that failed (key store or database down) left nothing durable to retry it from.
-- A row here is written when the person is erased or merged away, before their keys are destroyed: while it exists the key service never creates
-- a key for that user, and `keysDestroyedAt` stays null until a destroy marked every key DESTROYED, which is what the retry
-- (db.user-keys.service.ts `retryErasures`) reruns. The user id only, never key material.
--
-- Purely additive: the previous release neither reads nor writes it. Node-local and user-level like user_keys (db 004): control database only,
-- RLS-exempt (modules/db/scripts/gen-rls-policies.mts gives the reason), no tenant column, never in a bundle or a tenant export. The CHECK and the
-- partial index are mirrored on the entity under the same names; the guard trigger (which synchronize cannot express) keeps a row from being
-- deleted, moved to another user or reopened. Idempotent.

CREATE TABLE IF NOT EXISTS "user_key_erasures" (
  "userId" uuid NOT NULL,
  "reason" character varying(32) NOT NULL,
  "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "keysDestroyedAt" TIMESTAMP WITH TIME ZONE,
  CONSTRAINT "ck_user_key_erasures_reason" CHECK ("reason" IN ('USER_ERASURE', 'USER_MERGED')),
  CONSTRAINT "PK_user_key_erasures" PRIMARY KEY ("userId")
);
CREATE INDEX IF NOT EXISTS "ix_user_key_erasures_pending" ON "user_key_erasures" ("requestedAt") WHERE "keysDestroyedAt" IS NULL;

-- ─── guard ───────────────────────────────────────────────────────────────────
-- An erasure is final: its row is never deleted, never names another user, and once the keys are recorded destroyed it never reads pending again.

CREATE OR REPLACE FUNCTION user_key_erasures_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'user_key_erasures: an erasure is final and never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."requestedAt" IS DISTINCT FROM OLD."requestedAt" OR NEW."reason" IS DISTINCT FROM OLD."reason" THEN
    RAISE EXCEPTION 'user_key_erasures: the identity of an erasure is never changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."keysDestroyedAt" IS NOT NULL AND NEW."keysDestroyedAt" IS DISTINCT FROM OLD."keysDestroyedAt" THEN
    RAISE EXCEPTION 'user_key_erasures: a recorded destroy is never reopened' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_key_erasures_guard ON "user_key_erasures";
CREATE TRIGGER user_key_erasures_guard BEFORE UPDATE OR DELETE ON "user_key_erasures" FOR EACH ROW EXECUTE FUNCTION user_key_erasures_guard();
