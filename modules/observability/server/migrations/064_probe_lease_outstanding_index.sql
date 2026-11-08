-- kind: expand
-- 064 — outstanding-lease index (docs/phases/09-observability/10-multi-region-and-private-probes.md, respond track: runner caps).
--
-- One partial index on `probe_leases`. The control-plane caps on probe-runner leases (probe.caps.ts, probe.lease.service.ts) count the leases that are
-- OUTSTANDING: handed out, not yet resulted (`completedAt` is null) and not yet expired. Without the index that count would scan a day of lease history
-- (leases are kept 24 hours after their deadline); with it the count touches only the handful of live rows. No table, column or row changes meaning, and a
-- deployment that configures no cap never runs the count at all, so this is safe to apply ahead of the code.
--
-- The statement is the DDL TypeORM renders for the `@Index('idx_probe_lease_outstanding', ['expiresAt', 'tenantId'], { where: ... })` on the ProbeLease
-- entity, made idempotent with IF NOT EXISTS so a database `synchronize` already built is left alone.
--
-- Reverse (exact; nothing else depends on the index):
--   DROP INDEX IF EXISTS "idx_probe_lease_outstanding";

CREATE INDEX IF NOT EXISTS "idx_probe_lease_outstanding" ON "probe_leases" ("expiresAt", "tenantId") WHERE "completedAt" IS NULL;
