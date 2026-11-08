-- kind: expand
-- supersedes: d82e6f98ed4541a003c662102e31e160c91c273b9fc53ecb5a8b480b8b04955a
-- 2026-10-18 (fleet HEALTH-3): the uuid defaults read gen_random_uuid() (built in) instead of uuid_generate_v4(): a module
-- migration runs with only the target schema on the search path, where uuid-ossp (in public) is not found. A database that
-- ran the earlier text keeps its tables and their old default, which works there; the ledger row is re-stamped.
-- 066 — Slack / Teams destinations and the post-mortem's document + approval links
-- (docs/phases/09-observability/14-incident-management-v2.md, respond track).
--
-- One new tenant table, `chat_destinations`: a Slack or Microsoft Teams channel that incident lifecycle events are posted to. The incoming-webhook URL
-- is the credential for the channel, so it is stored ONLY as AES-256-GCM ciphertext (`urlCipher`) with its host for display and a per-tenant
-- fingerprint for the unique index. Six nullable columns on `incident_postmortems` (additive): the `document` record the published write-up lives in
-- and its version number, the `approval` queue item the review went through, how the review was done, its outcome and when it was decided.
--
-- Nothing that exists today changes meaning: a post-mortem without these columns set is exactly what it was (its review and publication use the
-- original built-in path), and a tenant without a chat destination posts nothing.
--
-- The statements are the DDL TypeORM renders for the entities (generated through the scratch-schema tool), made idempotent with IF NOT EXISTS so
-- a database `synchronize` already built is left alone; names are TypeORM's own, so `db:schema:drift` stays quiet.
--
-- DOWN (the exact reverse; run by hand, nothing here is destructive to data that predates it):
--   DROP TABLE IF EXISTS "chat_destinations";
--   ALTER TABLE "incident_postmortems" DROP COLUMN IF EXISTS "documentId", DROP COLUMN IF EXISTS "documentVersionNo", DROP COLUMN IF EXISTS "approvalItemId",
--     DROP COLUMN IF EXISTS "reviewMode", DROP COLUMN IF EXISTS "reviewOutcome", DROP COLUMN IF EXISTS "reviewedAt";
-- (the `document` rows a publication created are left in the document module, where its own retention rules govern them)

CREATE TABLE IF NOT EXISTS "chat_destinations" ("destinationId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "kind" character varying(8) NOT NULL, "label" character varying(120) NOT NULL, "urlCipher" text NOT NULL, "urlHost" character varying(253) NOT NULL, "urlFingerprint" character varying(64) NOT NULL, "audience" character varying(8) NOT NULL DEFAULT 'INTERNAL', "events" jsonb, "severities" jsonb, "enabled" boolean NOT NULL DEFAULT true, "consecutiveFailures" integer NOT NULL DEFAULT '0', "lastStatus" character varying(40), "lastSentAt" TIMESTAMP WITH TIME ZONE, "disabledAt" TIMESTAMP WITH TIME ZONE, "createdBy" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_abb861574ceb1850fa000a74819" PRIMARY KEY ("destinationId"));
CREATE INDEX IF NOT EXISTS "IDX_657fdca9eb0f5a4887f20e22c6" ON "chat_destinations" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_chat_destination_url" ON "chat_destinations" ("tenantId", "urlFingerprint");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'incident_postmortems'
  ) THEN
    ALTER TABLE "incident_postmortems" ADD COLUMN IF NOT EXISTS "documentId" uuid;
    ALTER TABLE "incident_postmortems" ADD COLUMN IF NOT EXISTS "documentVersionNo" smallint;
    ALTER TABLE "incident_postmortems" ADD COLUMN IF NOT EXISTS "approvalItemId" uuid;
    ALTER TABLE "incident_postmortems" ADD COLUMN IF NOT EXISTS "reviewMode" character varying(10);
    ALTER TABLE "incident_postmortems" ADD COLUMN IF NOT EXISTS "reviewOutcome" character varying(10);
    ALTER TABLE "incident_postmortems" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP WITH TIME ZONE;
  END IF;
END $$;
