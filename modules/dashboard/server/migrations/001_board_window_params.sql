-- 001 — dashboard_boards.timeWindow / params (phases/dashboard/10-board-time-window-and-viewer-params.md)
--
-- The two jsonb columns themselves are added by db:deploy's schema-sync phase from
-- the TypeORM entity (`dashboard_board.entity.ts`); this file only adds what those
-- decorators cannot express: the shape CHECKs. The full shape (relative/absolute
-- window, parameter field vocabulary) is validated by `server/board-window.ts`;
-- the database only guarantees the coarse invariants so a hand-written row cannot
-- break the runner.
--
-- Module-local numbering (docs/legacy-db-migrations/README.md): the phase file
-- called this "096", the legacy dashboard range, which no longer receives files.
--
-- Guarded on information_schema: a deployment without the dashboard module skips it.
-- supersedes: 6522374da05cfd9ab05868a75ca95729eb8054e90095211adad70cefb546b672,8f0b81cfdfe10b2439000d2cbb659bbaddd42a85effa1cc4a59bbe2302cc46e5,a02f329c1aaab559f64abd8dae75998286944678488dd336dca2cabef2f2b18a

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dashboard_boards' AND table_schema = current_schema() AND column_name = 'timeWindow'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'dashboard_boards_time_window_shape' AND constraint_schema = current_schema()
  ) THEN
    ALTER TABLE "dashboard_boards"
      ADD CONSTRAINT "dashboard_boards_time_window_shape"
      CHECK ("timeWindow" IS NULL OR (
        jsonb_typeof("timeWindow") = 'object'
        AND "timeWindow"->>'mode' IN ('relative', 'absolute')
      ));
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dashboard_boards' AND table_schema = current_schema() AND column_name = 'params'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'dashboard_boards_params_shape' AND constraint_schema = current_schema()
  ) THEN
    -- At most 8 typed parameters: a parameter bar, not an entity-alias language.
    ALTER TABLE "dashboard_boards"
      ADD CONSTRAINT "dashboard_boards_params_shape"
      CHECK ("params" IS NULL OR (
        jsonb_typeof("params") = 'array'
        AND jsonb_array_length("params") <= 8
      ));
  END IF;
END $$;
