-- kind: expand
-- announcement 001: the `announcements` and `announcement_receipts` tables (docs/phases/47-announcements, 47.1).
--
-- `announcements`: one message from the platform operator (tenantId NULL, every tenant) or a tenant admin (their tenant),
-- with its text per language, audience, channels, schedule and numbers. A maintenance window's notices are rows too
-- (windowId + stage, one per stage: the partial unique index).
-- `announcement_receipts`: one row per person reached (primary key announcement + user), where the shell reads what to
-- show and the acknowledgement is kept.
--
-- Both carry tenantId and so get the tenant_isolation / tenant_admin_bypass policy pair from the generated
-- tenant 127_rls_policy_hardening.sql. The module reads and writes them on the SYSTEM connection on purpose (a platform
-- row has no tenant) and filters on the sender itself.
--
-- The statements are the DDL TypeORM renders for the entities, made idempotent so a database that `synchronize`
-- already built is left alone.
--
-- Down (exact reverse; nothing else depends on the tables):
--   DROP TABLE IF EXISTS "announcement_receipts";
--   DROP TABLE IF EXISTS "announcements";

SELECT set_config('search_path', quote_ident(current_schema()) || ', public', true);

CREATE TABLE IF NOT EXISTS "announcements" (
  "announcementId" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "tenantId" uuid,
  "kind" character varying(20) NOT NULL DEFAULT 'GENERAL',
  "status" character varying(20) NOT NULL DEFAULT 'DRAFT',
  "severity" character varying(10) NOT NULL DEFAULT 'info',
  "content" jsonb NOT NULL,
  "defaultLanguage" character varying(16) NOT NULL DEFAULT 'en',
  "linkUrl" character varying(2000),
  "audience" jsonb NOT NULL,
  "channels" jsonb NOT NULL DEFAULT '[]',
  "sendAt" TIMESTAMP,
  "expiresAt" TIMESTAMP,
  "sentAt" TIMESTAMP,
  "withdrawnAt" TIMESTAMP,
  "windowId" uuid,
  "stage" character varying(20),
  "edited" boolean NOT NULL DEFAULT false,
  "stats" jsonb NOT NULL DEFAULT '{}',
  "fanoutCursor" uuid,
  "createdByUserId" uuid,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_announcements" PRIMARY KEY ("announcementId")
);
CREATE INDEX IF NOT EXISTS "IDX_announcements_tenant_status" ON "announcements" ("tenantId", "status");
CREATE INDEX IF NOT EXISTS "IDX_announcements_due" ON "announcements" ("status", "sendAt");
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_announcements_window_stage" ON "announcements" ("windowId", "stage") WHERE "windowId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "announcement_receipts" (
  "announcementId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "channels" jsonb NOT NULL DEFAULT '[]',
  "deliveredAt" TIMESTAMP,
  "seenAt" TIMESTAMP,
  "acknowledgedAt" TIMESTAMP,
  "dismissedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_announcement_receipts" PRIMARY KEY ("announcementId", "userId")
);
CREATE INDEX IF NOT EXISTS "IDX_announcement_receipts_user" ON "announcement_receipts" ("userId");

-- Tenant isolation, the shape of tenant 127 (which skips a table that does not exist yet when it runs before this file).
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['announcements', 'announcement_receipts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_admin_bypass ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId" = (SELECT app_current_tenant())) WITH CHECK ("tenantId" = (SELECT app_current_tenant()))', t);
    EXECUTE format('CREATE POLICY tenant_admin_bypass ON %I TO app_admin USING ((SELECT app_rls_bypass())) WITH CHECK ((SELECT app_rls_bypass()))', t);
  END LOOP;
END $rls$;
