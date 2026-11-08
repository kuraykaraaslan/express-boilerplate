-- kind: expand
-- supersedes: dd5090bf6c65ce22b0961b4ba2a74a1c679b3ae93ac3043eaa3e82e7ef0da93c
-- 2026-10-18 (fleet HEALTH-3): the uuid defaults read gen_random_uuid() (built in) instead of uuid_generate_v4(): a module
-- migration runs with only the target schema on the search path, where uuid-ossp (in public) is not found. A database that
-- ran the earlier text keeps its tables and their old default, which works there; the ledger row is re-stamped.
-- 010 — status page v2 (docs/phases/09-observability/15-status-page-v2.md).
--
-- Four new tenant tables (status_pages, status_component_groups, status_translations, status_automations), four nullable-or-defaulted
-- columns on `status_components` (groupId, showUptime, showHistory, showRegions) and the columns a subscriber needs for the SMS and
-- webhook channels on `status_subscribers` (channel, phone, endpointUrl, signingSecret, pageId, locale, consecutiveFailures), with
-- `email` made nullable because an SMS or webhook subscriber has none.
--
-- Nothing that exists today changes meaning: a subscriber row keeps channel EMAIL, a component keeps showing its uptime, and a tenant
-- with no `status_pages` row keeps serving its one page exactly as before (the default page is virtual until somebody edits it).
--
-- The statements are the DDL TypeORM renders for the entities (generated through the scratch-schema tool), made idempotent with IF NOT
-- EXISTS so a database `synchronize` already built is left alone; names are TypeORM's own, so `db:schema:drift` stays quiet.

CREATE TABLE IF NOT EXISTS "status_pages" ("pageId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "slug" character varying(64) NOT NULL, "name" character varying(200) NOT NULL, "isDefault" boolean NOT NULL DEFAULT false, "enabled" boolean NOT NULL DEFAULT true, "audience" character varying(16) NOT NULL DEFAULT 'PUBLIC', "passwordHash" character varying(100), "ipAllowlist" jsonb, "domain" character varying(253), "theme" character varying(8) NOT NULL DEFAULT 'AUTO', "languages" jsonb, "componentIds" jsonb, "embedOrigins" jsonb, "snapshotEnabled" boolean NOT NULL DEFAULT true, "snapshotAt" TIMESTAMP WITH TIME ZONE, "snapshotFiles" jsonb, "snapshotHash" character varying(64), "snapshotError" character varying(300), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0dc62400636a99acef94ee37710" PRIMARY KEY ("pageId"));
CREATE INDEX IF NOT EXISTS "IDX_6bed839fa5b280a5531308c0d5" ON "status_pages" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_status_page_domain" ON "status_pages" ("tenantId", "domain") WHERE "domain" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_status_page_default" ON "status_pages" ("tenantId") WHERE "isDefault" = true;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_status_page_slug" ON "status_pages" ("tenantId", "slug");
CREATE TABLE IF NOT EXISTS "status_component_groups" ("groupId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "name" character varying(200) NOT NULL, "description" character varying(500), "order" integer NOT NULL DEFAULT '0', "collapsed" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c9f2b4606f5bbe74e430bdfddb0" PRIMARY KEY ("groupId"));
CREATE INDEX IF NOT EXISTS "IDX_9282796e886f64423920cddcab" ON "status_component_groups" ("tenantId");
CREATE TABLE IF NOT EXISTS "status_translations" ("translationId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "entityType" character varying(12) NOT NULL, "entityId" uuid NOT NULL, "locale" character varying(12) NOT NULL, "name" character varying(300), "body" character varying(2000), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_476f9ab98102ee5212a86d031eb" PRIMARY KEY ("translationId"));
CREATE INDEX IF NOT EXISTS "IDX_9ccf647abaaec769a9db199158" ON "status_translations" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_status_translation" ON "status_translations" ("tenantId", "entityType", "entityId", "locale");
CREATE TABLE IF NOT EXISTS "status_automations" ("automationId" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid NOT NULL, "componentId" uuid NOT NULL, "enabled" boolean NOT NULL DEFAULT true, "minStatus" character varying(16) NOT NULL DEFAULT 'PARTIAL_OUTAGE', "postTitle" character varying(300) NOT NULL, "postMessage" character varying(2000) NOT NULL, "resolveMessage" character varying(2000), "severity" character varying(12) NOT NULL DEFAULT 'MAJOR', "autoResolve" boolean NOT NULL DEFAULT true, "autoPublish" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c58fc245bf0ac2d8377482993e1" PRIMARY KEY ("automationId"));
CREATE INDEX IF NOT EXISTS "IDX_dc4628365ad1b7227f318ee4a3" ON "status_automations" ("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_status_automation_component" ON "status_automations" ("tenantId", "componentId");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'status_components'
  ) THEN
    ALTER TABLE "status_components" ADD COLUMN IF NOT EXISTS "groupId" uuid;
    ALTER TABLE "status_components" ADD COLUMN IF NOT EXISTS "showUptime" boolean NOT NULL DEFAULT true;
    ALTER TABLE "status_components" ADD COLUMN IF NOT EXISTS "showHistory" boolean NOT NULL DEFAULT true;
    ALTER TABLE "status_components" ADD COLUMN IF NOT EXISTS "showRegions" boolean NOT NULL DEFAULT false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'status_subscribers'
  ) THEN
    ALTER TABLE "status_subscribers" ALTER COLUMN "email" DROP NOT NULL;
    ALTER TABLE "status_subscribers" ADD COLUMN IF NOT EXISTS "channel" character varying(8) NOT NULL DEFAULT 'EMAIL';
    ALTER TABLE "status_subscribers" ADD COLUMN IF NOT EXISTS "phone" character varying(20);
    ALTER TABLE "status_subscribers" ADD COLUMN IF NOT EXISTS "endpointUrl" character varying(500);
    ALTER TABLE "status_subscribers" ADD COLUMN IF NOT EXISTS "signingSecret" text;
    ALTER TABLE "status_subscribers" ADD COLUMN IF NOT EXISTS "pageId" uuid;
    ALTER TABLE "status_subscribers" ADD COLUMN IF NOT EXISTS "locale" character varying(12);
    ALTER TABLE "status_subscribers" ADD COLUMN IF NOT EXISTS "consecutiveFailures" integer NOT NULL DEFAULT '0';
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_status_subscriber_endpoint" ON "status_subscribers" ("tenantId", "endpointUrl") WHERE "endpointUrl" IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_status_subscriber_phone" ON "status_subscribers" ("tenantId", "phone") WHERE "phone" IS NOT NULL;
  END IF;
END $$;
