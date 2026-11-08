-- kind: expand; reversible: true
-- ai_firewall 002: per-actor baselines and per-role priors of the feature store (docs/phases/55-ai-firewall/02 §2.1).
--
--   ai_firewall_baselines  one row per person or API key of a tenant ("actorKind" user | apiKey, "actorKey" the keyed hash of its id:
--                          features/ai_firewall.feature-id.ts, never the raw id), and one per role as the cold-start prior
--                          ("actorKind" role, "actorKey" the role name). Written once a day by the baseline job
--                          (features/ai_firewall.baseline.job.ts) from the day profiles the feature store keeps in Redis; read by the
--                          feature vector (features/ai_firewall.feature-vector.ts). "lastDay" (YYYYMMDD, UTC) keeps a day from being
--                          folded twice.
--
-- Platform actors are stored under the ROOT tenant's id, as the event store does (001); the policy pair below shows them to ROOT only.
--
-- Personal data: an actor's row is pseudonymous (keyed hash) and its "data" holds countries (location), ASNs (network) and device tags
-- (device); exported with redaction (tenant_export:collection) and deleted by the erasure (privacy:erasure) of this module; a prior holds
-- no country, ASN or device.
--
-- Tenant data: the tenant_isolation / tenant_admin_bypass pair of tenant migration 127 (db.rls-policy.ts tenantPolicyStatements), then
-- FORCE from birth, as 001 does. In `synchronize` mode db:deploy's schema sync creates the table from the entity before this file runs; in
-- `migrate` mode this file creates it. Column types, defaults, constraint and index names match the entity. Purely additive and
-- idempotent.
--
-- Down (exact reverse; NEVER auto-run): 002_ai_firewall_baselines.sql.down.

CREATE TABLE IF NOT EXISTS "ai_firewall_baselines" (
  "tenantId" uuid NOT NULL,
  "actorKind" character varying(16) NOT NULL,
  "actorKey" character varying(64) NOT NULL,
  "role" character varying(32),
  "days" integer NOT NULL DEFAULT 0,
  "lastDay" character varying(8) NOT NULL,
  "data" jsonb NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_ai_firewall_baselines" PRIMARY KEY ("tenantId", "actorKind", "actorKey")
);
CREATE INDEX IF NOT EXISTS "idx_ai_firewall_baselines_day" ON "ai_firewall_baselines" ("tenantId", "lastDay");

-- ── RLS: the policy pair of db.rls-policy.ts (tenantPolicyStatements), then FORCE; both deploy modes ────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_firewall_baselines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_self ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_admin_bypass ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId" = (SELECT app_current_tenant())) WITH CHECK ("tenantId" = (SELECT app_current_tenant()))', t);
    EXECUTE format('CREATE POLICY tenant_admin_bypass ON %I TO app_admin USING ((SELECT app_rls_bypass())) WITH CHECK ((SELECT app_rls_bypass()))', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
