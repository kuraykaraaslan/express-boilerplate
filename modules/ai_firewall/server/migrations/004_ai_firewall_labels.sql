-- kind: expand; reversible: true
-- ai_firewall 004: the label store (docs/phases/55-ai-firewall/03 §3.1, §3.2; decisions D55-75 to D55-81).
--
--   ai_firewall_labels  one row per label: what a source whose truth we know says about one incident or one stored event, the
--                       examples the two tree models of 04 learn from. Written by
--                         - the fw:signals consumer's label producer (labels/ai_firewall.label-producer.ts): every honeytoken touch
--                           (source honeytoken, confidence 1) and every address ban an operator placed or an automatic or firewall
--                           ban an operator lifted (source ban_confirmed), both from the stored events, idempotent per reference;
--                         - the incident pages (ai_firewall.incident.service.ts): a person's verdict on an incident (source admin:
--                           true positive with its class, false positive, unsure), and the false alarm close of 02 (D55-43);
--                         - the probe lane and the benign traffic of 03.3 / 03.4 (sources synthetic, benign_traffic) later.
--
--   "refKind", "refId"   the incident (its uuid as text) or the event (its signal id) the label is about; "refAt" when that behaviour
--                        happened (the incident's opening, the event's time), so the dataset export (03.5) finds the feature vector
--                        without the row it points at, which the retention deletes first.
--   "actorKind", "actorId", "lane"  the labelled actor (a person, session, key, device or address), copied from the reference.
--   "kind"               the event's signal kind (null for an incident); "detectors" the incident's detectors, strongest first
--                        (`score.rules` when none held), which the per-detector counter of 04.8 reads.
--   "labelClass"         a closed list (labels/ai_firewall.label-model.ts LABEL_CLASSES): benign, the ten detector ids of 02,
--                        honeytoken_touch, other. "verdict" a person's (true_positive, false_positive, unsure), null for a system source.
--   "source"             honeytoken | admin | ban_confirmed | synthetic | benign_traffic; at most ONE label per reference and source
--                        (`uq_ai_firewall_labels_ref`): a system source writes once (ON CONFLICT DO NOTHING), a person's later verdict
--                        replaces the earlier one.
--   "confidence"         0..1. "labelledBy" the person (a user id; cleared by the erasure) or "labelledBySystem" the producer.
--
-- Platform labels (an address's ban, a platform incident) are stored under the ROOT tenant like the rest of the store; the policy pair
-- below shows them to ROOT only.
--
-- Personal data: "actorId" (a user, session or key id, an address) and "labelledBy" (a person); exported with redaction
-- (tenant_export:collection), erased (privacy:erasure: a label about the erased person's own events goes with them, one about their
-- incident loses the actor like the incident, a label they gave loses its labeller) and purged with the tenant. Deleted by the nightly
-- retention once "labelledAt" is older than the tenant's aiFirewallRetentionDays.
--
-- Tenant data: the tenant_isolation / tenant_admin_bypass pair of tenant migration 127 (db.rls-policy.ts tenantPolicyStatements), then
-- FORCE from birth, as 001 and 002 do. In `synchronize` mode db:deploy's schema sync creates the table from the entity before this file
-- runs; in `migrate` mode this file creates it. Column types, defaults, constraint and index names match the entity. Purely additive and
-- idempotent.
--
-- Down (exact reverse; NEVER auto-run): 004_ai_firewall_labels.sql.down.

CREATE TABLE IF NOT EXISTS "ai_firewall_labels" (
  "labelId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "refKind" character varying(16) NOT NULL,
  "refId" character varying(128) NOT NULL,
  "refAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "actorKind" character varying(16) NOT NULL,
  "actorId" character varying(128) NOT NULL,
  "lane" character varying(32) NOT NULL DEFAULT 'unknown',
  "kind" character varying(128),
  "detectors" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "labelClass" character varying(32) NOT NULL,
  "verdict" character varying(16),
  "source" character varying(16) NOT NULL,
  "confidence" double precision NOT NULL,
  "labelledBy" uuid,
  "labelledBySystem" character varying(32),
  "labelledAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_ai_firewall_labels" PRIMARY KEY ("labelId"),
  CONSTRAINT "ck_ai_firewall_labels_ref_kind" CHECK ("refKind" IN ('incident', 'event')),
  CONSTRAINT "ck_ai_firewall_labels_class" CHECK ("labelClass" IN ('benign', 'credential_stuffing', 'password_spray', 'enumeration',
    'session_hijack', 'data_exfiltration', 'admin_misuse', 'api_key_abuse', 'public_bot', 'signup_abuse', 'device_lane', 'honeytoken_touch',
    'other')),
  CONSTRAINT "ck_ai_firewall_labels_verdict" CHECK ("verdict" IS NULL OR "verdict" IN ('true_positive', 'false_positive', 'unsure')),
  CONSTRAINT "ck_ai_firewall_labels_source" CHECK ("source" IN ('honeytoken', 'admin', 'ban_confirmed', 'synthetic', 'benign_traffic')),
  CONSTRAINT "ck_ai_firewall_labels_confidence" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_firewall_labels_ref" ON "ai_firewall_labels" ("tenantId", "refKind", "refId", "source");
CREATE INDEX IF NOT EXISTS "idx_ai_firewall_labels_labelled" ON "ai_firewall_labels" ("tenantId", "labelledAt");
CREATE INDEX IF NOT EXISTS "idx_ai_firewall_labels_actor" ON "ai_firewall_labels" ("tenantId", "actorKind", "actorId");

-- ── RLS: the policy pair of db.rls-policy.ts (tenantPolicyStatements), then FORCE; both deploy modes ────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_firewall_labels'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_self ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_admin_bypass ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId" = (SELECT app_current_tenant())) WITH CHECK ("tenantId" = (SELECT app_current_tenant()))', t);
    EXECUTE format('CREATE POLICY tenant_admin_bypass ON %I TO app_admin USING ((SELECT app_rls_bypass())) WITH CHECK ((SELECT app_rls_bypass()))', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
