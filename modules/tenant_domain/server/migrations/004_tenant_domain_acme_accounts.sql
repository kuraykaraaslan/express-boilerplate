-- kind: expand; reversible: true
-- tenant_domain 004: the platform's ACME account key per certificate authority directory (docs/phases/51-domain-certificates, 51.3).
--
--   tenant_domain_acme_accounts   one row per directory URL: the account key as an `encryptField` envelope under the node key
--
-- Platform data (no tenant column, no RLS): the account orders certificates for every tenant's hosts. Created on the first order and
-- read by the worker; two workers racing at that moment insert with ON CONFLICT DO NOTHING and both read the winner. Idempotent.

CREATE TABLE IF NOT EXISTS "tenant_domain_acme_accounts" (
  "accountId"      uuid       NOT NULL DEFAULT gen_random_uuid(),
  "directoryUrl"   varchar    NOT NULL,
  "accountKeyEnc"  text       NOT NULL,
  "contactEmail"   varchar,
  "createdAt"      timestamp  NOT NULL DEFAULT now(),
  CONSTRAINT "PK_tenant_domain_acme_accounts" PRIMARY KEY ("accountId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_domain_acme_accounts_directory" ON "tenant_domain_acme_accounts" ("directoryUrl");
