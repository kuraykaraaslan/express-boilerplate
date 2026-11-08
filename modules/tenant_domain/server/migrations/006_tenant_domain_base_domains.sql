-- kind: expand; reversible: true
-- tenant_domain 006: the base domains the platform manages (docs/phases/56-managed-base-domains, 56.1, D340).
--
--   tenant_domain_base_domains   one row per managed base domain (`roltek.xyz`, `dev.roltek.xyz`, `lns.roltek.xyz` ...): its purpose,
--                                whether it is the default and offered, its DNS state and how its wildcard challenge is answered
--
-- Platform data (no tenant column, no RLS), like tenant_domain_acme_accounts. Empty after this migration: every process seeds the
-- environment's TENANT_WILDCARD_DOMAIN as the default ACTIVE row at boot (`seedBaseDomainFromEnv`, ON CONFLICT DO NOTHING), and until
-- then the platform reads the environment, so nothing changes for an installation that never adds a second base domain. Idempotent.

CREATE TABLE IF NOT EXISTS "tenant_domain_base_domains" (
  "baseDomainId"   uuid          NOT NULL DEFAULT gen_random_uuid(),
  "baseDomain"     varchar(253)  NOT NULL,
  "purpose"        varchar(20)   NOT NULL DEFAULT 'tenants',
  "isDefault"      boolean       NOT NULL DEFAULT false,
  "selectable"     boolean       NOT NULL DEFAULT true,
  "status"         varchar(20)   NOT NULL DEFAULT 'PENDING_DNS',
  "challengeMode"  varchar(20)   NOT NULL DEFAULT 'delegated',
  "dnsCheckedAt"   timestamp,
  "lastDnsError"   varchar(500),
  "createdAt"      timestamp     NOT NULL DEFAULT now(),
  "updatedAt"      timestamp     NOT NULL DEFAULT now(),
  CONSTRAINT "PK_tenant_domain_base_domains" PRIMARY KEY ("baseDomainId"),
  CONSTRAINT "CHK_tenant_domain_base_domains_purpose" CHECK ("purpose" IN ('tenants', 'wildcard_only')),
  CONSTRAINT "CHK_tenant_domain_base_domains_status" CHECK ("status" IN ('PENDING_DNS', 'ACTIVE', 'DISABLED')),
  CONSTRAINT "CHK_tenant_domain_base_domains_challenge" CHECK ("challengeMode" IN ('delegated', 'zone')),
  CONSTRAINT "CHK_tenant_domain_base_domains_default_purpose" CHECK (NOT "isDefault" OR "purpose" = 'tenants')
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_domain_base_domains_name" ON "tenant_domain_base_domains" ("baseDomain");
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_domain_base_domains_default" ON "tenant_domain_base_domains" ("isDefault") WHERE "isDefault" = true;
