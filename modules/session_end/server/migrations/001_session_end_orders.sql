-- kind: expand; reversible: true
-- session_end 001: the transactional outbox of "end this session" orders (docs/audits/2026-11-03-redis-outage.md §3, layer 1).
--
--   session_end_orders   one order per row: a device kick for `iot:kicks`, a websocket control order for `ws:control:stream`.
--                        Written in the same transaction as the change that causes it, delivered right after the commit (the row
--                        is then deleted) or by the relay, oldest first, until Redis takes it; a dead letter (`deadAt`) is kept
--                        for an operator and never deleted automatically.
--
-- On the shared database only (the entity is @SharedDatabaseOnly): the relay reads one table for every tenant. In `synchronize` mode
-- db:deploy's schema sync creates the table from the entity before this file runs; in `migrate` mode this file creates it. Column
-- types, defaults, constraint and index names match the entity. Tenant data: the tenant_isolation / tenant_admin_bypass pair of
-- tenant migration 127 (db.rls-policy.ts tenantPolicyStatements), then FORCE from birth (the iot_ota precedent). Idempotent.

CREATE TABLE IF NOT EXISTS "session_end_orders" (
  "orderId" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "kind" character varying(64) NOT NULL,
  "payload" jsonb NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "deadAt" TIMESTAMP WITH TIME ZONE,
  "lastError" text,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_session_end_orders" PRIMARY KEY ("orderId")
);
CREATE INDEX IF NOT EXISTS "idx_session_end_orders_due" ON "session_end_orders" ("nextAttemptAt") WHERE "deadAt" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_session_end_orders_dead" ON "session_end_orders" ("deadAt") WHERE "deadAt" IS NOT NULL;

-- ── RLS: the policy pair of db.rls-policy.ts (tenantPolicyStatements), then FORCE; both deploy modes ────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['session_end_orders'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_self ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_admin_bypass ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId" = (SELECT app_current_tenant())) WITH CHECK ("tenantId" = (SELECT app_current_tenant()))', t);
    EXECUTE format('CREATE POLICY tenant_admin_bypass ON %I TO app_admin USING ((SELECT app_rls_bypass())) WITH CHECK ((SELECT app_rls_bypass()))', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
