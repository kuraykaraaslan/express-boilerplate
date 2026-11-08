-- kind: expand; reversible: true
-- supersedes: 01b75da976e0558c6649c7b53da6adc9d926b61a7fdfac237daa7b0969b633ad,5e6345a4097ea17daae954db380f82b169fb104af74ed339cbe20623518d0c98,c8394dffd1d365ff8819a3b245fe322a87c65809230b2bbc284013856a74d5cc,d259bd711d78d5fa7305a1f8199239d413323a8f0db3a2b5dab35baf65b17efe
-- module_lifecycle 001: module governance (docs/phases/25-marketplace/03-module-governance).
--
--   installs."origin"         who installed a module row: tenant | plan | operator | default (06). Null on older rows = tenant.
--   installs."closedReason"   why the platform closed it: entitlement | policy | retired (06); null when active or switched off by a person.
--   module_policies           a sysadmin's per-tenant policy for one module (04): today only 'block'. Tenant-scoped: the generated
--                             tenant_isolation / tenant_admin_bypass pair, copied here because tenant:127 runs before this file on a
--                             fresh migrate-mode database and skips tables that do not exist yet.
--   module_availability       platform-wide availability of a module (03): available | unlisted | hidden | retired. An operator
--                             decision, not tenant data: no tenantId, exempt from tenant RLS (gen-rls-policies EXEMPT).
--
-- Purely additive and idempotent: TypeORM synchronize creates the same columns, tables and CHECKs (same names, declared on the
-- entities) on single-role deployments; this file does it for databases that run in migrate mode.

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.installs') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE "installs" ADD COLUMN IF NOT EXISTS "origin" character varying;
  ALTER TABLE "installs" ADD COLUMN IF NOT EXISTS "closedReason" character varying;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_installs_origin' AND conrelid = '"installs"'::regclass) THEN
    ALTER TABLE "installs" ADD CONSTRAINT "ck_installs_origin"
      CHECK ("origin" IS NULL OR "origin" IN ('tenant', 'plan', 'operator', 'default'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_installs_closed_reason' AND conrelid = '"installs"'::regclass) THEN
    ALTER TABLE "installs" ADD CONSTRAINT "ck_installs_closed_reason"
      CHECK ("closedReason" IS NULL OR "closedReason" IN ('entitlement', 'policy', 'retired'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "module_policies" (
  "tenantId" uuid NOT NULL,
  "moduleId" character varying NOT NULL,
  "policy" character varying NOT NULL DEFAULT 'block',
  "reason" text,
  "createdBy" uuid,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "ck_module_policies_policy" CHECK ("policy" IN ('block')),
  CONSTRAINT "PK_module_policies" PRIMARY KEY ("tenantId", "moduleId")
);

ALTER TABLE "module_policies" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "module_policies";
DROP POLICY IF EXISTS tenant_self ON "module_policies";
DROP POLICY IF EXISTS tenant_admin_bypass ON "module_policies";
CREATE POLICY tenant_isolation ON "module_policies"
       USING ("tenantId" = (SELECT app_current_tenant()))
       WITH CHECK ("tenantId" = (SELECT app_current_tenant()));
CREATE POLICY tenant_admin_bypass ON "module_policies" TO app_admin
       USING ((SELECT app_rls_bypass()))
       WITH CHECK ((SELECT app_rls_bypass()));

CREATE TABLE IF NOT EXISTS "module_availability" (
  "moduleId" character varying NOT NULL,
  "state" character varying NOT NULL DEFAULT 'available',
  "reason" text,
  "updatedBy" uuid,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "ck_module_availability_state" CHECK ("state" IN ('available', 'unlisted', 'hidden', 'retired')),
  CONSTRAINT "PK_module_availability" PRIMARY KEY ("moduleId")
);
