-- kind: expand
-- 019 — dashboard_scene_bindings: which document a subject shows and which device is which (docs/phases/07-dashboard/42, D42-3).
--
-- One row per subject, slot and document kind (server/entities/dashboard_scene_binding.entity.ts): the document (a bare uuid of a kind a
-- module contributes through `dashboard:scene_kind`), the devices by role, the exceptions of the key = element match, hidden keys, the
-- view of a building page and the rules. No foreign key, as in the other dashboard tables.
--
-- In `synchronize` mode db:deploy's schema-sync phase creates the table from the entity before this file runs; in `migrate` mode this
-- file is what creates it. Idempotent (`IF NOT EXISTS` everywhere, the policies dropped and recreated). Column types, defaults and every
-- constraint and index name match the entity, so neither mode fights the other. Tenant-scoped like 014, and FORCE from birth like the
-- newer IoT tables (OD-155): the table owner is subject to the policy too.

CREATE TABLE IF NOT EXISTS "dashboard_scene_bindings" (
  "bindingId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "subjectType" character varying(60) NOT NULL,
  "subjectId" character varying(64) NOT NULL,
  "slot" character varying(32) NOT NULL DEFAULT 'main',
  "kind" character varying(32) NOT NULL,
  "documentId" uuid NOT NULL,
  "documentHash" character varying(128),
  "devices" jsonb NOT NULL DEFAULT '{}',
  "map" jsonb NOT NULL DEFAULT '{}',
  "hidden" jsonb,
  "view" jsonb,
  "rules" jsonb,
  "status" character varying(16) NOT NULL DEFAULT 'ok',
  "revision" integer NOT NULL DEFAULT 1,
  "createdByUserId" uuid,
  "updatedByUserId" uuid,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "ck_dashboard_scene_bindings_subject" CHECK ("subjectType" ~ '^[a-z][a-z0-9_.-]{0,59}$' AND "subjectId" ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT "ck_dashboard_scene_bindings_slot_kind" CHECK ("slot" ~ '^[a-z][a-z0-9_-]{0,31}$' AND "kind" ~ '^[a-z][a-z0-9_]{0,31}$'),
  CONSTRAINT "ck_dashboard_scene_bindings_status" CHECK ("status" IN ('ok', 'unresolved')),
  CONSTRAINT "PK_dashboard_scene_bindings" PRIMARY KEY ("bindingId")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_dashboard_scene_bindings_subject_slot_kind" ON "dashboard_scene_bindings" ("tenantId", "subjectType", "subjectId", "slot", "kind");
CREATE INDEX IF NOT EXISTS "IDX_dashboard_scene_bindings_document" ON "dashboard_scene_bindings" ("tenantId", "kind", "documentId");
CREATE INDEX IF NOT EXISTS "IDX_dashboard_scene_bindings_subject" ON "dashboard_scene_bindings" ("tenantId", "subjectType", "subjectId");

ALTER TABLE "dashboard_scene_bindings" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "dashboard_scene_bindings";
DROP POLICY IF EXISTS tenant_self ON "dashboard_scene_bindings";
DROP POLICY IF EXISTS tenant_admin_bypass ON "dashboard_scene_bindings";
CREATE POLICY tenant_isolation ON "dashboard_scene_bindings"
       USING ("tenantId" = (SELECT app_current_tenant()))
       WITH CHECK ("tenantId" = (SELECT app_current_tenant()));
CREATE POLICY tenant_admin_bypass ON "dashboard_scene_bindings" TO app_admin
       USING ((SELECT app_rls_bypass()))
       WITH CHECK ((SELECT app_rls_bypass()));
ALTER TABLE "dashboard_scene_bindings" FORCE ROW LEVEL SECURITY;
