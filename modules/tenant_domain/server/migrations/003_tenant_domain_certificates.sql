-- kind: expand; reversible: true
-- tenant_domain 003: the certificates the platform obtains for its own domains (docs/phases/51-domain-certificates, 51.2).
--
--   tenant_domain_certificates   one row per domain row ("tenantDomainId", a bare uuid, no foreign key): the certificate chain (public), the
--                                private key as an `encryptField` envelope under the node key ("privateKeyEnc": Caddy asks by host name before
--                                any tenant is known), the validity window, the renewal date and the order's back-off state
--
-- Tenant data: the tenant_isolation / tenant_admin_bypass pair, like announcement 001; forcing RLS is the platform's manual
-- cutover (rls-force-enable.sql), never a migration. The TLS hand-over route reads it across tenants through the system context, which
-- passes the bypass policy. A no-op re-run: everything is IF NOT EXISTS / DROP IF EXISTS.

CREATE TABLE IF NOT EXISTS "tenant_domain_certificates" (
  "certificateId"   uuid        NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"        uuid        NOT NULL,
  "tenantDomainId"  uuid        NOT NULL,
  "domain"          varchar     NOT NULL,
  "status"          varchar     NOT NULL DEFAULT 'PENDING',
  "certPem"         text,
  "privateKeyEnc"   text,
  "notBefore"       timestamp,
  "notAfter"        timestamp,
  "issuedAt"        timestamp,
  "renewAfter"      timestamp,
  "attempts"        integer     NOT NULL DEFAULT 0,
  "lastError"       text,
  "lastAttemptAt"   timestamp,
  "retryAt"         timestamp,
  "createdAt"       timestamp   NOT NULL DEFAULT now(),
  "updatedAt"       timestamp   NOT NULL DEFAULT now(),
  CONSTRAINT "PK_tenant_domain_certificates" PRIMARY KEY ("certificateId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_domain_certificates_domain_id" ON "tenant_domain_certificates" ("tenantDomainId");
CREATE INDEX IF NOT EXISTS "IDX_tenant_domain_certificates_tenant" ON "tenant_domain_certificates" ("tenantId");
CREATE INDEX IF NOT EXISTS "IDX_tenant_domain_certificates_domain" ON "tenant_domain_certificates" ("domain");
CREATE INDEX IF NOT EXISTS "IDX_tenant_domain_certificates_not_after" ON "tenant_domain_certificates" ("notAfter");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_domain_certificates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_admin_bypass ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId" = (SELECT app_current_tenant())) WITH CHECK ("tenantId" = (SELECT app_current_tenant()))', t);
    EXECUTE format('CREATE POLICY tenant_admin_bypass ON %I TO app_admin USING ((SELECT app_rls_bypass())) WITH CHECK ((SELECT app_rls_bypass()))', t);
  END LOOP;
END $$;
