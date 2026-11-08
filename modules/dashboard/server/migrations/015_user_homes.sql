-- kind: expand
-- 015 — dashboard_user_homes: a person's own home dashboard (phase 20.2e; owner 2026-10-26: a shared board can be made just my home).
--
-- One row per person and tenant (server/entities/dashboard_user_home.entity.ts): the board this person lands on at the admin home, any
-- standalone board they can open, a shared one included. No foreign key, as in the other dashboard tables: a board's pointers are
-- deleted with the board, in the same transaction.
--
-- In `synchronize` mode db:deploy's schema-sync phase creates the table from the entity before this file runs; in `migrate` mode this
-- file is what creates it. Idempotent (`IF NOT EXISTS` everywhere, the policies dropped and recreated). Column types, defaults and every
-- constraint and index name match the entity, so neither mode fights the other. Tenant-scoped like 014.

CREATE TABLE IF NOT EXISTS "dashboard_user_homes" (
  "homeId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "boardId" uuid NOT NULL,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_dashboard_user_homes" PRIMARY KEY ("homeId")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_dashboard_user_homes_user" ON "dashboard_user_homes" ("tenantId", "userId");
CREATE INDEX IF NOT EXISTS "IDX_dashboard_user_homes_board" ON "dashboard_user_homes" ("tenantId", "boardId");

ALTER TABLE "dashboard_user_homes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "dashboard_user_homes";
DROP POLICY IF EXISTS tenant_self ON "dashboard_user_homes";
DROP POLICY IF EXISTS tenant_admin_bypass ON "dashboard_user_homes";
CREATE POLICY tenant_isolation ON "dashboard_user_homes"
       USING ("tenantId" = (SELECT app_current_tenant()))
       WITH CHECK ("tenantId" = (SELECT app_current_tenant()));
CREATE POLICY tenant_admin_bypass ON "dashboard_user_homes" TO app_admin
       USING ((SELECT app_rls_bypass()))
       WITH CHECK ((SELECT app_rls_bypass()));
