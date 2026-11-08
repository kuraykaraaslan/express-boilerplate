-- kind: expand
-- 008 — dashboard_display_links: per-board display tokens (owner decision 2026-10-17 #10; docs/phases/07-dashboard/20 items 20.2c and 20.2d).
--
-- One row per display link (server/entities/dashboard_display_link.entity.ts): the SHA-256 of the token, never the token,
-- the board it shows, who issued it, when it expires and whether it was revoked. No foreign key, as in the other
-- dashboard tables: a board's links are deleted with the board, in the same transaction.
--
-- In `synchronize` mode db:deploy's schema-sync phase creates the table from the entity before this file runs; in
-- `migrate` mode this file is what creates it. Idempotent (`IF NOT EXISTS` everywhere, the policies dropped and
-- recreated). Column types, defaults and every constraint and index name match the entity, so neither mode fights the
-- other. Tenant-scoped like audit_log 010 (the tenant_isolation / tenant_admin_bypass pair).

CREATE TABLE IF NOT EXISTS "dashboard_display_links" (
  "displayLinkId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "boardId" uuid NOT NULL,
  "tokenHash" character varying(64) NOT NULL,
  "tokenHint" character varying(8) NOT NULL,
  "label" character varying(80) NOT NULL,
  "createdByUserId" uuid NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "expiresAt" TIMESTAMP NOT NULL,
  "revokedAt" TIMESTAMP,
  "revokedByUserId" uuid,
  "lastUsedAt" TIMESTAMP,
  CONSTRAINT "ck_dashboard_display_links_values" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$' AND "expiresAt" > "createdAt"),
  CONSTRAINT "PK_dashboard_display_links" PRIMARY KEY ("displayLinkId")
);
CREATE INDEX IF NOT EXISTS "IDX_dashboard_display_links_tenant_board" ON "dashboard_display_links" ("tenantId", "boardId");
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_dashboard_display_links_token_hash" ON "dashboard_display_links" ("tokenHash");

ALTER TABLE "dashboard_display_links" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "dashboard_display_links";
DROP POLICY IF EXISTS tenant_self ON "dashboard_display_links";
DROP POLICY IF EXISTS tenant_admin_bypass ON "dashboard_display_links";
CREATE POLICY tenant_isolation ON "dashboard_display_links"
       USING ("tenantId" = (SELECT app_current_tenant()))
       WITH CHECK ("tenantId" = (SELECT app_current_tenant()));
CREATE POLICY tenant_admin_bypass ON "dashboard_display_links" TO app_admin
       USING ((SELECT app_rls_bypass()))
       WITH CHECK ((SELECT app_rls_bypass()));
