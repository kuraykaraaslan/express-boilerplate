-- kind: expand; reversible: true
-- ai_firewall 003: incidents as the rule scorer's grouping (docs/phases/55-ai-firewall/02 §2.4, §2.7; decisions D55-36 to D55-38).
--
-- "ai_firewall_incidents" gets what the grouping of scored detections writes (incidents/ai_firewall.incident-store.ts):
--   "peakScore", "peakAt"     the highest score of the incident (0..100) and when; "score" is now the latest score (0..100)
--   "scorings"                how many scored detections joined it
--   "detections"              per detector: how often it held, its strongest strength, when it last held
--   "explanation"             the peak scoring's contributions (the top features, the detections with their evidence shares): feature
--                             names and numbers only, never a raw id, path or header value
--   "history"                 the scorings, bounded (the first and the newest, 50 at most), the incident's score timeline
--   "platform", "alertsOnly"  a platform-scope finding (shown in ROOT only, D55-24) and a device or machine finding (FWA-6)
--   "coldStart"               the latest scoring had no own baseline yet
--   "acknowledgedAt", "acknowledgedBy"  who acknowledged it (a person; personal data, exported redacted and erased like "closedBy")
--
-- and the partial unique index "uq_ai_firewall_incidents_active": at most ONE open or acknowledged incident per actor and tenant. The
-- grouping relies on it to deduplicate across worker processes (an INSERT that meets it does nothing and the scoring joins the incident
-- another worker opened). The table had no writer before this release, so no existing rows can violate it.
--
-- Additive: new columns with defaults or nullable; the previous release neither reads nor writes them. In `synchronize` mode db:deploy's
-- schema sync applies them from the entity before this file runs; in `migrate` mode this file does. Names match the entity. Idempotent.
-- RLS is unchanged (the policy pair and FORCE of 001 cover the table).
--
-- Down (exact reverse; NEVER auto-run): 003_ai_firewall_incident_grouping.sql.down.

ALTER TABLE "ai_firewall_incidents" ADD COLUMN IF NOT EXISTS "peakScore" double precision;
ALTER TABLE "ai_firewall_incidents" ADD COLUMN IF NOT EXISTS "peakAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "ai_firewall_incidents" ADD COLUMN IF NOT EXISTS "scorings" integer NOT NULL DEFAULT 0;
ALTER TABLE "ai_firewall_incidents" ADD COLUMN IF NOT EXISTS "detections" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "ai_firewall_incidents" ADD COLUMN IF NOT EXISTS "explanation" jsonb;
ALTER TABLE "ai_firewall_incidents" ADD COLUMN IF NOT EXISTS "history" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "ai_firewall_incidents" ADD COLUMN IF NOT EXISTS "platform" boolean NOT NULL DEFAULT false;
ALTER TABLE "ai_firewall_incidents" ADD COLUMN IF NOT EXISTS "alertsOnly" boolean NOT NULL DEFAULT false;
ALTER TABLE "ai_firewall_incidents" ADD COLUMN IF NOT EXISTS "coldStart" boolean NOT NULL DEFAULT false;
ALTER TABLE "ai_firewall_incidents" ADD COLUMN IF NOT EXISTS "acknowledgedAt" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "ai_firewall_incidents" ADD COLUMN IF NOT EXISTS "acknowledgedBy" uuid;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_firewall_incidents_active" ON "ai_firewall_incidents" ("tenantId", "actorKind", "actorId")
  WHERE "status" IN ('open', 'acknowledged');
