-- kind: expand
-- audit_log 009: the record of the weekly chain verification (docs/phases/02-fleet/08 section 7 `audit.chain_ok`).
--
--   audit_chain_verify_runs   one row per run of audit_log.verify.job.ts: when, how many tenants and rows, how many broken or unverifiable. Counts only.
--
-- Node-level (no tenantId), RLS-exempt like the fleet node tables (modules/db/scripts/gen-rls-policies.mts lists the reason). Purely additive: the job writes
-- a row after each run and nothing else reads it but the compliance check; the previous release does not know it. The CHECK and index are mirrored on the
-- entity (same names). Idempotent.

CREATE TABLE IF NOT EXISTS "audit_chain_verify_runs" (
  "runId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "finishedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "tenants" integer NOT NULL,
  "checked" bigint NOT NULL,
  "broken" integer NOT NULL,
  "errors" integer NOT NULL,
  CONSTRAINT "ck_audit_chain_verify_runs_values" CHECK ("tenants" >= 0 AND "checked" >= 0 AND "broken" >= 0 AND "errors" >= 0 AND "broken" + "errors" <= "tenants" AND "finishedAt" >= "startedAt"),
  CONSTRAINT "PK_audit_chain_verify_runs" PRIMARY KEY ("runId")
);
CREATE INDEX IF NOT EXISTS "idx_audit_chain_verify_runs_finished" ON "audit_chain_verify_runs" ("finishedAt");
