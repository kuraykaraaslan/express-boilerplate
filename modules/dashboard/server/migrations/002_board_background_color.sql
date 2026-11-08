-- 002 — dashboard_boards.backgroundColor shape CHECK
--
-- The varchar(7) column itself is added by db:deploy's schema-sync phase from the
-- TypeORM entity (`dashboard_board.entity.ts`); this file only adds what that
-- decorator cannot express: the `#rrggbb` shape. `UpdateBoardDTO` validates the
-- same pattern, so the CHECK only guards a hand-written row — the board view puts
-- this value straight into a `style` attribute.
--
-- Guarded on information_schema: a deployment without the dashboard module skips it.
-- supersedes: 3b6ab5b844390bae37e2a2e55326809787f7d11e53e90cc48b774468bceb47c0,c158c6a2aba74a8afeab059c96b60fe375e52d40203afdf68361ad92343b6dbc,fda69f280d7c53b35d81436e555d480100d9dc0188de75f89c0673dc16b45d4a

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dashboard_boards' AND table_schema = current_schema() AND column_name = 'backgroundColor'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'dashboard_boards_background_color_shape' AND constraint_schema = current_schema()
  ) THEN
    ALTER TABLE "dashboard_boards"
      ADD CONSTRAINT "dashboard_boards_background_color_shape"
      CHECK ("backgroundColor" IS NULL OR "backgroundColor" ~ '^#[0-9a-fA-F]{6}$');
  END IF;
END $$;
