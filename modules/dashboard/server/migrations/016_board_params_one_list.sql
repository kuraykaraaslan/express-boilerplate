-- kind: expand
-- 016 — a board's parameters in one list (phase 41, docs/phases/07-dashboard/41-parameters-one-concept.md, D41-1 / D41-8).
--
-- `dashboard_boards.params` holds the value AND the entity parameters since phase 41 (`BoardParamListSchema`,
-- `server/board-params.ts`): at most 48, the limits of the two lists it replaces (16 parameters, 32 entity aliases). 001's
-- shape CHECK capped the array at 8 and was never raised when 17.3a took the board to 16; this widens it to 48. Nothing else
-- of the row changes here: the stored aliases and `{ $alias }` references are rewritten by the `db:post_deploy` step
-- `dashboard:board_params_v41` (`dashboard.post-deploy.params.ts`), which needs the code's normaliser.
--
-- Idempotent (the constraint dropped if present and added again), guard scoped to `current_schema()` like 001.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dashboard_boards' AND table_schema = current_schema() AND column_name = 'params'
  ) THEN
    ALTER TABLE "dashboard_boards" DROP CONSTRAINT IF EXISTS "dashboard_boards_params_shape";
    ALTER TABLE "dashboard_boards"
      ADD CONSTRAINT "dashboard_boards_params_shape"
      CHECK ("params" IS NULL OR (
        jsonb_typeof("params") = 'array'
        AND jsonb_array_length("params") <= 48
      ));
  END IF;
END $$;
