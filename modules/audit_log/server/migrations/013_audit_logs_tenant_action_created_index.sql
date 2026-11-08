-- kind: expand; reversible: true
-- audit_log 013: the index of the per-action activity read (docs/phases/55-ai-firewall, the AI firewall's activity page).
--
-- `actionActivityCrossTenant` (audit_log.query.ts) asks each tenant, per exact action name and time window, how many rows it wrote and which
-- are the newest: `WHERE "tenantId" = $1 AND "action" IN (...) AND "createdAt" BETWEEN $2 AND $3`, grouped by action, and the same filter
-- ordered by "createdAt" DESC with a LIMIT. The only composite that leads with the tenant was (tenantId, createdAt), so every poll walked
-- every row the tenant wrote in the window and filtered the actions afterwards; this one answers each action's range directly.
--
-- Purely additive: the previous release neither needs nor minds it. The entity declares the same index by name, so a synchronize-mode
-- deploy builds the same shape and does not drop it. No CONCURRENTLY: the deploy runner wraps each migration in a transaction, so on a
-- large audit_logs table the build holds writes to it for its duration. RLS is unchanged. Idempotent.
--
-- Down (exact reverse):
--   DROP INDEX IF EXISTS "IDX_audit_logs_tenant_action_created";

CREATE INDEX IF NOT EXISTS "IDX_audit_logs_tenant_action_created" ON "audit_logs" ("tenantId", "action", "createdAt");
