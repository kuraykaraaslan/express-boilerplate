-- kind: expand
-- 014 — dashboard_card_overlays: a card's settings per subject entity (docs/phases/07-dashboard/38, E38-7).
--
-- One row per card and subject (server/entities/dashboard_card_overlay.entity.ts): a JSON merge patch on the card's settings and an
-- optional title, read by the viewer for the entity a page shows (a station's own diagram, its own 3D design). No foreign key, as in the
-- other dashboard tables: a card's overlays are deleted with the card, a board's with the board, in the same transaction.
--
-- In `synchronize` mode db:deploy's schema-sync phase creates the table from the entity before this file runs; in `migrate` mode this
-- file is what creates it. Idempotent (`IF NOT EXISTS` everywhere, the policies dropped and recreated). Column types, defaults and every
-- constraint and index name match the entity, so neither mode fights the other. Tenant-scoped like 008.

CREATE TABLE IF NOT EXISTS "dashboard_card_overlays" (
  "overlayId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "boardId" uuid NOT NULL,
  "instanceId" uuid NOT NULL,
  "subjectType" character varying(60) NOT NULL,
  "subjectId" character varying(64) NOT NULL,
  "settings" jsonb NOT NULL DEFAULT '{}',
  "title" character varying(120),
  "revision" integer NOT NULL DEFAULT 1,
  "updatedByUserId" uuid,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "ck_dashboard_card_overlays_subject" CHECK ("subjectType" ~ '^[a-z][a-z0-9_.-]{0,59}$' AND "subjectId" ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT "PK_dashboard_card_overlays" PRIMARY KEY ("overlayId")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_dashboard_card_overlays_card_subject" ON "dashboard_card_overlays" ("tenantId", "instanceId", "subjectType", "subjectId");
CREATE INDEX IF NOT EXISTS "IDX_dashboard_card_overlays_board_subject" ON "dashboard_card_overlays" ("tenantId", "boardId", "subjectType", "subjectId");

ALTER TABLE "dashboard_card_overlays" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "dashboard_card_overlays";
DROP POLICY IF EXISTS tenant_self ON "dashboard_card_overlays";
DROP POLICY IF EXISTS tenant_admin_bypass ON "dashboard_card_overlays";
CREATE POLICY tenant_isolation ON "dashboard_card_overlays"
       USING ("tenantId" = (SELECT app_current_tenant()))
       WITH CHECK ("tenantId" = (SELECT app_current_tenant()));
CREATE POLICY tenant_admin_bypass ON "dashboard_card_overlays" TO app_admin
       USING ((SELECT app_rls_bypass()))
       WITH CHECK ((SELECT app_rls_bypass()));
