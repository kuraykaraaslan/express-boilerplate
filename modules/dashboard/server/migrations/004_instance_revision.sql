-- 004 — dashboard_widget_instances.revision: an optimistic lock per placement (phase 15.3c, docs/phases/07-dashboard/15).
--
-- A placement PATCH was last-write-wins: two people editing the same card silently overwrote each
-- other. The column mirrors `dashboard_boards.revision` (an int counter): every placement write bumps
-- it, and a PATCH carrying a stale `expectedRevision` is refused with 409 (`instance.crud.service.ts`).
--
-- In `synchronize` mode db:deploy's schema-sync phase adds the column from the entity
-- (`dashboard_widget_instance.entity.ts`) before this file runs; in `migrate` mode (no synchronize)
-- this file is what adds it. Either way the statement is idempotent: `ADD COLUMN IF NOT EXISTS`, and
-- existing rows start at 1, the same value a new placement is created with.
--
-- Guarded on information_schema: a deployment without the dashboard module skips it.
-- supersedes: 0f95390c00503718827abb6198fbfb822694dbe6192ca8ffbf00ce6bfc7c6af8,b7e8faf0e1447cc58635a72d21dc0fb71bbe3c02b7f960582d017d0022a99338,e642dd7d612c748751f3cf55d9da5d9e4187a7889f8f1319ed59f8957e8b7576

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'dashboard_widget_instances' AND table_schema = current_schema()
  ) THEN
    ALTER TABLE "dashboard_widget_instances"
      ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;
  END IF;
END $$;
