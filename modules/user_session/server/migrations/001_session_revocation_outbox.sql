-- kind: expand
-- 001 — the durable outbox of session-revocation side effects (common.29).
--
-- A `user_session:session_revoked` hook that throws or overruns its 2 s budget used to be abandoned with a warning, so the
-- session-bound data it should have removed (a native push token, dependent access) could outlive the session. Such a
-- notification is now recorded here and replayed by the user_session outbox worker until every hook answers.
--
-- Down (exact reverse; nothing else depends on the table):
--   DROP TABLE IF EXISTS "session_revocation_outbox";
--
-- The statements are the DDL TypeORM renders for the entity, made idempotent so a database that `synchronize` already built is left alone.

CREATE TABLE IF NOT EXISTS "session_revocation_outbox" (
  "outboxId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "sessions" jsonb NOT NULL,
  "failedContributions" jsonb NOT NULL DEFAULT '[]',
  "attempts" integer NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "deadAt" TIMESTAMP WITH TIME ZONE,
  "lastError" text,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_session_revocation_outbox" PRIMARY KEY ("outboxId")
);
CREATE INDEX IF NOT EXISTS "IDX_session_revocation_outbox_next" ON "session_revocation_outbox" ("nextAttemptAt");
