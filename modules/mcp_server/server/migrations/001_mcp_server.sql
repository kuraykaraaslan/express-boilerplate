-- kind: expand; reversible: true
-- mcp_server 001: the OAuth grants of the platform's MCP authorization server (docs/phases/57-mcp-server D57-8).
--
--   mcp_oauth_grants   one row per grant: the person, the client (its Client ID Metadata Document URL, name and host), the resource
--                      and scope consented to, the status (active / suspended / revoked), the SHA-256 of the current refresh token and of
--                      the one before it (reuse detection), the lifetime. No token is stored in clear. Tenant data: the tenant_isolation /
--                      tenant_admin_bypass pair of db.rls-policy.ts, then FORCE from birth.
--
-- In `synchronize` mode db:deploy's schema sync creates the table from entities/mcp_oauth_grant.entity.ts before this file runs; in
-- `migrate` mode this file creates it. Names match the entity. Idempotent. DOWN: 001_mcp_server.sql.down.

CREATE TABLE IF NOT EXISTS "mcp_oauth_grants" (
  "grantId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "clientId" character varying(512) NOT NULL,
  "clientName" character varying(100) NOT NULL,
  "clientHost" character varying(253) NOT NULL,
  "resource" character varying(512) NOT NULL,
  "scope" character varying(100) NOT NULL,
  "status" character varying(12) NOT NULL DEFAULT 'active',
  "suspendedUntil" TIMESTAMP WITH TIME ZONE,
  "refreshHash" character(64),
  "previousRefreshHash" character(64),
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "lastUsedAt" TIMESTAMP WITH TIME ZONE,
  "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "revokedAt" TIMESTAMP WITH TIME ZONE,
  "revokedReason" character varying(32),
  CONSTRAINT "PK_mcp_oauth_grants" PRIMARY KEY ("grantId"),
  CONSTRAINT "ck_mcp_oauth_grants_status" CHECK ("status" IN ('active', 'suspended', 'revoked'))
);
CREATE INDEX IF NOT EXISTS "idx_mcp_oauth_grants_user" ON "mcp_oauth_grants" ("tenantId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_mcp_oauth_grants_refresh" ON "mcp_oauth_grants" ("tenantId", "refreshHash") WHERE "refreshHash" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_mcp_oauth_grants_previous_refresh" ON "mcp_oauth_grants" ("tenantId", "previousRefreshHash");

-- ── RLS: the policy pair of db.rls-policy.ts (tenantPolicyStatements), then FORCE ───────────────────────────────────────────

ALTER TABLE "mcp_oauth_grants" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mcp_oauth_grants";
DROP POLICY IF EXISTS tenant_admin_bypass ON "mcp_oauth_grants";
CREATE POLICY tenant_isolation ON "mcp_oauth_grants"
  USING ("tenantId" = (SELECT app_current_tenant())) WITH CHECK ("tenantId" = (SELECT app_current_tenant()));
CREATE POLICY tenant_admin_bypass ON "mcp_oauth_grants" TO app_admin
  USING ((SELECT app_rls_bypass())) WITH CHECK ((SELECT app_rls_bypass()));
ALTER TABLE "mcp_oauth_grants" FORCE ROW LEVEL SECURITY;
