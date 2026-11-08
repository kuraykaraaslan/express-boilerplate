-- kind: expand; reversible: true
-- tenant_domain 007: the wildcard certificate of each managed base domain (docs/phases/56-managed-base-domains, 56.2, D343).
--
--   tenant_domain_base_domain_certificates   one row per base domain: the chain for `<base>` and `*.<base>`, the private key as an
--                                            `encryptField` envelope under the node key, the timing and back-off of phase 51's rows
--
-- Platform data (no tenant column, no RLS): `tls-cert` answers by host name before any tenant is known, and the certificate serves every
-- tenant under the base. The row goes with its base domain (ON DELETE CASCADE). Idempotent.

CREATE TABLE IF NOT EXISTS "tenant_domain_base_domain_certificates" (
  "certificateId"  uuid          NOT NULL DEFAULT gen_random_uuid(),
  "baseDomainId"   uuid          NOT NULL,
  "domain"         varchar(253)  NOT NULL,
  "names"          varchar(600)  NOT NULL DEFAULT '',
  "status"         varchar(20)   NOT NULL DEFAULT 'PENDING',
  "certPem"        text,
  "directoryUrl"   varchar,
  "privateKeyEnc"  text,
  "notBefore"      timestamp,
  "notAfter"       timestamp,
  "issuedAt"       timestamp,
  "renewAfter"     timestamp,
  "attempts"       integer       NOT NULL DEFAULT 0,
  "lastError"      varchar(500),
  "lastAttemptAt"  timestamp,
  "retryAt"        timestamp,
  "createdAt"      timestamp     NOT NULL DEFAULT now(),
  "updatedAt"      timestamp     NOT NULL DEFAULT now(),
  CONSTRAINT "PK_tenant_domain_base_domain_certificates" PRIMARY KEY ("certificateId"),
  CONSTRAINT "FK_tenant_domain_base_domain_certificates_base" FOREIGN KEY ("baseDomainId") REFERENCES "tenant_domain_base_domains" ("baseDomainId") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_domain_base_domain_certificates_base" ON "tenant_domain_base_domain_certificates" ("baseDomainId");
