-- kind: expand; reversible: true
-- user_security 001: the security lock of an account (docs/phases/55-ai-firewall/00-wire-existing-controls.md 0.1, P-1).
--
-- Two locks, deliberately. The guessing lock (`lockedUntil`, 5 failures / 15 min, exponential) stays as it is and holds for the password
-- sign-in only, so a stranger guessing a password cannot lock a person out of their passkey or SSO. The security lock is new: an
-- administrator or the firewall sets it, it refuses EVERY sign-in method at the one session-creation path (user_session createSession)
-- and setting it ends the account's live sessions.
--
--   user_securities."securityLockedAt"     when it was set; null = never locked (or unlocked since).
--   user_securities."securityLockedUntil"  when it stops holding by itself; null = until an unlock.
--   user_securities."securityLockReason"   the operator's or the firewall's note (never shown to the person, never mailed).
--   user_securities."securityLockedBy"     the user who set it; null for the firewall or another system actor.
--   user_securities."securityLockSource"   'admin' | 'firewall'.
--
-- Purely additive: the previous release neither reads nor writes these columns, and every existing row reads as "not locked". The entity
-- declares the same columns, so a synchronize-mode deploy builds the same shape. `user_securities` is a platform table (no tenantId): no
-- RLS pair. Guarded on to_regclass and idempotent.
--
-- Down (exact reverse):
--   ALTER TABLE "user_securities" DROP COLUMN IF EXISTS "securityLockSource";
--   ALTER TABLE "user_securities" DROP COLUMN IF EXISTS "securityLockedBy";
--   ALTER TABLE "user_securities" DROP COLUMN IF EXISTS "securityLockReason";
--   ALTER TABLE "user_securities" DROP COLUMN IF EXISTS "securityLockedUntil";
--   ALTER TABLE "user_securities" DROP COLUMN IF EXISTS "securityLockedAt";

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.user_securities') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE "user_securities" ADD COLUMN IF NOT EXISTS "securityLockedAt" TIMESTAMP;
  ALTER TABLE "user_securities" ADD COLUMN IF NOT EXISTS "securityLockedUntil" TIMESTAMP;
  ALTER TABLE "user_securities" ADD COLUMN IF NOT EXISTS "securityLockReason" character varying(500);
  ALTER TABLE "user_securities" ADD COLUMN IF NOT EXISTS "securityLockedBy" uuid;
  ALTER TABLE "user_securities" ADD COLUMN IF NOT EXISTS "securityLockSource" character varying(16);
END
$$;
