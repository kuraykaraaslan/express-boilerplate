-- kind: expand; reversible: true
-- tenant_domain 008: hosts a tenant left, redirected for 30 days (docs/phases/56-managed-base-domains, 56.3, D347).
--
--   tenant_domain_host_moves   one row per old host: the tenant, the host it moved to, why, and when the redirect ends
--
-- Platform data in the system context (no RLS): the proxy reads it by host name before any tenant is known, as it reads tenant_domains for
-- the host lookup. The tenant purge deletes a tenant's rows; the DNS recheck job deletes expired ones. Idempotent.

CREATE TABLE IF NOT EXISTS "tenant_domain_host_moves" (
  "fromHost"   varchar(253)  NOT NULL,
  "tenantId"   uuid          NOT NULL,
  "toHost"     varchar(253)  NOT NULL,
  "reason"     varchar(20)   NOT NULL,
  "expiresAt"  timestamp     NOT NULL,
  "createdAt"  timestamp     NOT NULL DEFAULT now(),
  CONSTRAINT "PK_tenant_domain_host_moves" PRIMARY KEY ("fromHost"),
  CONSTRAINT "CHK_tenant_domain_host_moves_reason" CHECK ("reason" IN ('base_change', 'slug_change'))
);

CREATE INDEX IF NOT EXISTS "IDX_tenant_domain_host_moves_tenant" ON "tenant_domain_host_moves" ("tenantId");
