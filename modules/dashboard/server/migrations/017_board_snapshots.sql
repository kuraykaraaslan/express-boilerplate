-- kind: expand
-- 017 — dashboard_board_snapshots: the copy of a board Discard puts back (owner 2026-10-27: "add Discard to the dashboard editor").
--
-- One row per Customise sitting, at most 5 per person and board (server/entities/dashboard_board_snapshot.entity.ts): the board's document, its cards and their overlays
-- as they were when the person started customising, the revision then, and the last other person who changed the board since. No
-- foreign key, as in the other dashboard tables: a board's copies are deleted with the board, in the same transaction.
--
-- In `synchronize` mode db:deploy's schema-sync phase creates the table from the entity before this file runs; in `migrate` mode this
-- file is what creates it. Idempotent (`IF NOT EXISTS` everywhere, the policies dropped and recreated). Column types, defaults and every
-- constraint and index name match the entity, so neither mode fights the other. Tenant-scoped like 014.

CREATE TABLE IF NOT EXISTS "dashboard_board_snapshots" (
  "snapshotId" uuid NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" uuid NOT NULL,
  "boardId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "revision" integer NOT NULL,
  "document" jsonb NOT NULL,
  "otherUserId" uuid,
  "otherAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_dashboard_board_snapshots" PRIMARY KEY ("snapshotId")
);
CREATE INDEX IF NOT EXISTS "IDX_dashboard_board_snapshots_board_user" ON "dashboard_board_snapshots" ("tenantId", "boardId", "userId");

ALTER TABLE "dashboard_board_snapshots" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "dashboard_board_snapshots";
DROP POLICY IF EXISTS tenant_self ON "dashboard_board_snapshots";
DROP POLICY IF EXISTS tenant_admin_bypass ON "dashboard_board_snapshots";
CREATE POLICY tenant_isolation ON "dashboard_board_snapshots"
       USING ("tenantId" = (SELECT app_current_tenant()))
       WITH CHECK ("tenantId" = (SELECT app_current_tenant()));
CREATE POLICY tenant_admin_bypass ON "dashboard_board_snapshots" TO app_admin
       USING ((SELECT app_rls_bypass()))
       WITH CHECK ((SELECT app_rls_bypass()));
