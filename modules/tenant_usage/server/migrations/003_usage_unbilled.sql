-- kind: expand
-- tenant_usage 003: the `tenant_usage_unbilled` ledger (lead decision D25, docs/audits/2026-10-28-lead-decisions.md).
--
-- A quota reservation that meets a Redis error still admits the units (losing a customer's message is worse than billing
-- it a few minutes late) and writes them here; a release that cannot reach Redis writes its units back as a negative row.
-- The flush job and the next reservation that reaches Redis apply the rows to the Redis counters and delete them in one
-- transaction (tenant_usage.unbilled.ts `reconcileUnbilled`).
--
-- The table carries tenantId and so gets the tenant_isolation / tenant_admin_bypass policy pair from the generated
-- tenant 127_rls_policy_hardening.sql; the same pair is created here for a database where 127 ran before this file.
--
-- The statements are the DDL TypeORM renders for the entity, made idempotent so a database that `synchronize` already
-- built is left alone.
--
-- Down (exact reverse; nothing else depends on the table; pending rows are units not yet billed):
--   DROP TABLE IF EXISTS "tenant_usage_unbilled";

SELECT set_config('search_path', quote_ident(current_schema()) || ', public', true);

CREATE TABLE IF NOT EXISTS "tenant_usage_unbilled" (
  "unbilledId" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "tenantId" uuid NOT NULL,
  "metric" character varying(64) NOT NULL,
  "month" character varying(7) NOT NULL,
  "day" character varying(10) NOT NULL,
  "units" integer NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_5e11635fa036e76e5375082b665" PRIMARY KEY ("unbilledId")
);
CREATE INDEX IF NOT EXISTS "IDX_tenant_usage_unbilled_tenant_metric_month" ON "tenant_usage_unbilled" ("tenantId", "metric", "month");

-- Tenant isolation, the shape of tenant 127 (which skips a table that does not exist yet when it runs before this file).
DO $rls$
BEGIN
  EXECUTE 'ALTER TABLE "tenant_usage_unbilled" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON "tenant_usage_unbilled"';
  EXECUTE 'DROP POLICY IF EXISTS tenant_admin_bypass ON "tenant_usage_unbilled"';
  EXECUTE 'CREATE POLICY tenant_isolation ON "tenant_usage_unbilled" USING ("tenantId" = (SELECT app_current_tenant())) WITH CHECK ("tenantId" = (SELECT app_current_tenant()))';
  EXECUTE 'CREATE POLICY tenant_admin_bypass ON "tenant_usage_unbilled" TO app_admin USING ((SELECT app_rls_bypass())) WITH CHECK ((SELECT app_rls_bypass()))';
END $rls$;
