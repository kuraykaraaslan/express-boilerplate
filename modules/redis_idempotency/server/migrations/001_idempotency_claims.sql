-- kind: expand
-- 001 — the durable Idempotency-Key claims (redis_idempotency.02).
--
-- Redis was the only guard of an Idempotency-Key: with Redis down a retried request executed again, and an evicted record
-- let a duplicate run. The claim (pending / completed, with its expiry) is now also written here; the HTTP wrapper falls
-- back to it when Redis cannot answer and checks it when Redis lost the key. Expired rows are purged by the claim path.
--
-- Down (exact reverse; nothing else depends on the table):
--   DROP TABLE IF EXISTS "idempotency_claims";

CREATE TABLE IF NOT EXISTS "idempotency_claims" (
  "claimKey" character varying(400) NOT NULL,
  "status" character varying(16) NOT NULL,
  "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_idempotency_claims" PRIMARY KEY ("claimKey")
);
CREATE INDEX IF NOT EXISTS "IDX_idempotency_claims_expires" ON "idempotency_claims" ("expiresAt");
