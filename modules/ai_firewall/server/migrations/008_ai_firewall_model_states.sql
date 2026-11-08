-- kind: expand; reversible: true
-- ai_firewall 008: shadow mode and the automatic promotion gate (docs/phases/55-ai-firewall/04-tree-models.md 4.6, 4.7, 4.9; owner
-- decision FWD-12; decisions D55-106 to D55-112).
--
--   "ai_firewall_incidents"."models"   what the two tree models said about the incident's actor in shadow (written by the incident
--                                      grouping, incidents/ai_firewall.incident-store.ts): per model its latest and peak score, the
--                                      peak's top contributions, the UTC days it flagged the actor and the model file's short sha. Names
--                                      and numbers only; the promotion gate reads it. `idx_ai_firewall_incidents_models` serves the gate's
--                                      read of the window's incidents a model scored.
--
--   "ai_firewall_model_states"         one row per tree model (behaviour, attack), the platform's, under the ROOT tenant: the model file's
--                                      sha256, shadow or promoted, when its shadow started, the last promotion and demotion (with the
--                                      failing criteria), a ROOT owner's hold, the gate's last verdict and the drift reference and report.
--                                      Written by the gate job (daily and at boot) and the hold route; every change is an audit row. No
--                                      personal data: who held a model is in the audit row only.
--
-- Tenant data: the tenant_isolation / tenant_admin_bypass pair of tenant migration 127 (db.rls-policy.ts tenantPolicyStatements), then
-- FORCE from birth, as 001, 002 and 004 do. In `synchronize` mode db:deploy's schema sync creates the table and the column from the entities
-- before this file runs; in `migrate` mode this file creates them. Names match the entities. Purely additive and idempotent.
--
-- Down (exact reverse; NEVER auto-run): 008_ai_firewall_model_states.sql.down.

ALTER TABLE "ai_firewall_incidents" ADD COLUMN IF NOT EXISTS "models" jsonb;
CREATE INDEX IF NOT EXISTS "idx_ai_firewall_incidents_models" ON "ai_firewall_incidents" ("tenantId", "lastSignalAt") WHERE "models" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "ai_firewall_model_states" (
  "tenantId" uuid NOT NULL,
  "model" character varying(16) NOT NULL,
  "modelSha256" character varying(64),
  "state" character varying(16) NOT NULL DEFAULT 'shadow',
  "shadowStartedAt" TIMESTAMP WITH TIME ZONE,
  "promotedAt" TIMESTAMP WITH TIME ZONE,
  "demotedAt" TIMESTAMP WITH TIME ZONE,
  "demotedReason" character varying(256),
  "heldAt" TIMESTAMP WITH TIME ZONE,
  "lastEvaluatedAt" TIMESTAMP WITH TIME ZONE,
  "verdict" jsonb,
  "drift" jsonb,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_ai_firewall_model_states" PRIMARY KEY ("tenantId", "model"),
  CONSTRAINT "ck_ai_firewall_model_states_model" CHECK ("model" IN ('behaviour', 'attack')),
  CONSTRAINT "ck_ai_firewall_model_states_state" CHECK ("state" IN ('shadow', 'promoted'))
);

-- ── RLS: the policy pair of db.rls-policy.ts (tenantPolicyStatements), then FORCE; both deploy modes ────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_firewall_model_states'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_self ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_admin_bypass ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId" = (SELECT app_current_tenant())) WITH CHECK ("tenantId" = (SELECT app_current_tenant()))', t);
    EXECUTE format('CREATE POLICY tenant_admin_bypass ON %I TO app_admin USING ((SELECT app_rls_bypass())) WITH CHECK ((SELECT app_rls_bypass()))', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
