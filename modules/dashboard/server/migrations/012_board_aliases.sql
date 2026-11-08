-- 012 — board entity aliases (phase 36, docs/phases/07-dashboard/36; the ThingsBoard model, owner decision 2026-10-24).
--
-- `dashboard_boards.aliases`: the board's named entity filters, `[{ key, name, resolveMultiple, filter }]`
-- (`BoardAliasesSchema`, `server/board-aliases.ts`); NULL = none. A placement names one with `{ "$alias": "<key>" }` in a
-- binding param; the server resolves it against the entity types modules contribute (`dashboard:entity_type`). The key
-- filters of 36.7 get their own column with that slice.
--
-- In `synchronize` mode db:deploy's schema-sync phase adds the column from the entity before this file runs; in
-- `migrate` mode this file is what adds it. Idempotent (`ADD COLUMN IF NOT EXISTS`), guard scoped to `current_schema()`
-- like 007.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'dashboard_boards'
  ) THEN
    ALTER TABLE "dashboard_boards" ADD COLUMN IF NOT EXISTS "aliases" jsonb;
  END IF;
END $$;
