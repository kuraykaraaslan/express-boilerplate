-- 011 — a placement's compute script (phase 35.5, docs/phases/07-dashboard/35; ADR-0017).
--
-- `dashboard_widget_instances.transform`: `{ v: 1, enabled, script, timeoutMs?, onError }` (`TransformSchema`,
-- `server/transform.dto.ts`); NULL = the card draws its data as loaded. The script is stored as text the server never
-- evaluates: it runs in a Worker inside the compute frame of the board view, under the frame's own policy, and its
-- result is validated like a source's answer (`modules/dashboard/POSTURE.md` §14). It is a placement field, not a
-- setting and not a definition column (POSTURE §2 stands: `dashboard_widgets` carries `template`, never `script`).
--
-- In `synchronize` mode db:deploy's schema-sync phase adds the column from the entity before this file runs; in
-- `migrate` mode this file is what adds it. Idempotent (`ADD COLUMN IF NOT EXISTS`), guard scoped to `current_schema()`
-- like 009.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'dashboard_widget_instances'
  ) THEN
    ALTER TABLE "dashboard_widget_instances" ADD COLUMN IF NOT EXISTS "transform" jsonb;
  END IF;
END $$;
