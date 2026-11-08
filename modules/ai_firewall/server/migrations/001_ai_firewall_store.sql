-- kind: expand; reversible: true
-- ai_firewall 001: the firewall's store (docs/phases/55-ai-firewall/01 §1.7).
--
--   ai_firewall_events     one row per stored SecuritySignal, written by the fw:signals consumer in the worker
--                          (store/ai_firewall.signal-consumer.ts). Append-only. Key ("tenantId", "at", "signalId"): the tenant first and
--                          the time column in it (the db:time_series key contract); "signalId" is the signal's own id, so a redelivered
--                          stream entry inserts nothing twice (ON CONFLICT DO NOTHING).
--   ai_firewall_incidents  one row per incident (03): an actor's signals grouped into one case, open until closed.
--   ai_firewall_actions    one row per proposal of a registered action (05): proposed -> executed -> undone / expired, or rejected,
--                          refused, failed, noop.
--
-- Platform rows (a signal's tenantId null) are stored under the ROOT tenant's id (store/ai_firewall.store.ts): the hypertable key cannot
-- hold a NULL tenant, and the policy pair below shows a ROOT-tenant row to the ROOT tenant only.
--
-- ai_firewall_events is a plain table here. db's time-series deploy phase (`db:time_series`, this module's ai_firewall.timeseries.ts)
-- makes it a hypertable owned by the owner role behind the "ai_firewall_events_v" access view, with 1-day chunks and a 365-day chunk-drop
-- backstop, or, without TimescaleDB, keeps it plain with the batched-delete retention. Readers and writers go through `accessRel`. The
-- tenant's own retention (setting aiFirewallRetentionDays, default 90 days) is the job ai_firewall.retention.job.ts, on all three tables.
--
-- Personal data: actor ids (user ids, addresses), subject ids, the address and user agent in "attrs", the people in "closedBy",
-- "decidedBy", "undoneBy"; exported (tenant_export:collection) and erased (privacy:erasure) by this module.
--
-- Tenant data: the tenant_isolation / tenant_admin_bypass pair of tenant migration 127 (db.rls-policy.ts tenantPolicyStatements) on all
-- three tables, then FORCE from birth (the iot_rules precedent). In `synchronize` mode db:deploy's schema sync creates the tables from the
-- entities before this file runs; in `migrate` mode this file creates them. Column types, defaults, constraint and index names match the
-- entities. Purely additive and idempotent.
--
-- Down (exact reverse; NEVER auto-run): 001_ai_firewall_store.sql.down.

CREATE TABLE IF NOT EXISTS "ai_firewall_events" (
  "tenantId" uuid NOT NULL,
  "at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "signalId" character varying(128) NOT NULL,
  "lane" character varying(32) NOT NULL,
  "kind" character varying(128) NOT NULL,
  "actorKind" character varying(16) NOT NULL,
  "actorId" character varying(128) NOT NULL,
  "subjectType" character varying(128),
  "subjectId" character varying(128),
  "outcome" character varying(8) NOT NULL,
  "severity" character varying(8) NOT NULL,
  "attrs" jsonb NOT NULL,
  "source" character varying(64) NOT NULL,
  "storedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_ai_firewall_events" PRIMARY KEY ("tenantId", "at", "signalId")
);
CREATE INDEX IF NOT EXISTS "idx_ai_firewall_events_actor" ON "ai_firewall_events" ("tenantId", "actorKind", "actorId", "at");
CREATE INDEX IF NOT EXISTS "idx_ai_firewall_events_kind" ON "ai_firewall_events" ("tenantId", "kind", "at");

CREATE TABLE IF NOT EXISTS "ai_firewall_incidents" (
  "incidentId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "status" character varying(16) NOT NULL DEFAULT 'open',
  "severity" character varying(8) NOT NULL,
  "actorKind" character varying(16) NOT NULL,
  "actorId" character varying(128) NOT NULL,
  "lane" character varying(32) NOT NULL DEFAULT 'unknown',
  "score" double precision,
  "kinds" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "signalCount" integer NOT NULL DEFAULT 0,
  "reason" character varying(64),
  "openedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "lastSignalAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "closedAt" TIMESTAMP WITH TIME ZONE,
  "closedBy" uuid,
  "closeReason" character varying(64),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_ai_firewall_incidents" PRIMARY KEY ("incidentId"),
  CONSTRAINT "ck_ai_firewall_incidents_status" CHECK ("status" IN ('open', 'acknowledged', 'closed'))
);
CREATE INDEX IF NOT EXISTS "idx_ai_firewall_incidents_status" ON "ai_firewall_incidents" ("tenantId", "status", "openedAt");
CREATE INDEX IF NOT EXISTS "idx_ai_firewall_incidents_actor" ON "ai_firewall_incidents" ("tenantId", "actorKind", "actorId");

CREATE TABLE IF NOT EXISTS "ai_firewall_actions" (
  "proposalId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "incidentId" uuid,
  "actionId" character varying(128) NOT NULL,
  "rung" character varying(24) NOT NULL,
  "lane" character varying(32) NOT NULL,
  "actorKind" character varying(16) NOT NULL,
  "actorId" character varying(128) NOT NULL,
  "subjectType" character varying(128),
  "subjectId" character varying(128),
  "status" character varying(16) NOT NULL DEFAULT 'proposed',
  "mode" character varying(8) NOT NULL,
  "reason" character varying(64) NOT NULL,
  "resultReason" character varying(64),
  "ttlSeconds" integer NOT NULL,
  "undoData" jsonb,
  "proposedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "decidedAt" TIMESTAMP WITH TIME ZONE,
  "decidedBy" uuid,
  "executedAt" TIMESTAMP WITH TIME ZONE,
  "expiresAt" TIMESTAMP WITH TIME ZONE,
  "endedAt" TIMESTAMP WITH TIME ZONE,
  "undoneBy" uuid,
  "undoWhy" character varying(16),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_ai_firewall_actions" PRIMARY KEY ("proposalId"),
  CONSTRAINT "ck_ai_firewall_actions_status" CHECK ("status" IN ('proposed', 'executed', 'undone', 'expired', 'rejected', 'refused', 'failed', 'noop')),
  CONSTRAINT "ck_ai_firewall_actions_mode" CHECK ("mode" IN ('observe', 'suggest', 'auto')),
  CONSTRAINT "ck_ai_firewall_actions_ttl" CHECK ("ttlSeconds" >= 0 AND "ttlSeconds" <= 2592000)
);
CREATE INDEX IF NOT EXISTS "idx_ai_firewall_actions_status" ON "ai_firewall_actions" ("tenantId", "status", "proposedAt");
CREATE INDEX IF NOT EXISTS "idx_ai_firewall_actions_actor" ON "ai_firewall_actions" ("tenantId", "actorKind", "actorId");
CREATE INDEX IF NOT EXISTS "idx_ai_firewall_actions_incident" ON "ai_firewall_actions" ("tenantId", "incidentId");

-- ── RLS: the policy pair of db.rls-policy.ts (tenantPolicyStatements), then FORCE; both deploy modes ────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_firewall_events', 'ai_firewall_incidents', 'ai_firewall_actions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_self ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_admin_bypass ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId" = (SELECT app_current_tenant())) WITH CHECK ("tenantId" = (SELECT app_current_tenant()))', t);
    EXECUTE format('CREATE POLICY tenant_admin_bypass ON %I TO app_admin USING ((SELECT app_rls_bypass())) WITH CHECK ((SELECT app_rls_bypass()))', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
