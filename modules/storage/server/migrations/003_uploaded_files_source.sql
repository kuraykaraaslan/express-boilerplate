-- kind: expand; reversible: true
-- storage 003: whose storage account holds an object (docs/phases/53-setting-levels, 53.5). "source" is 'platform' when the root
-- tenant's provider stored it (the module's setting level is platform): counted against the plan's storage. It is 'tenant' when the
-- tenant's own provider stored it. Reads and deletes go to that side even after the level changes, so switching a level never
-- strands the objects already stored.
--
-- Purely additive: a nullable column. Objects stored before keep NULL, which means "follow the provider in force", exactly what
-- they did before; the previous release keeps writing rows without it. Column type is TypeORM's for
-- `@Column({ nullable: true, type: 'varchar', length: 16 })`. Idempotent, and a no-op while the table does not exist yet; the
-- deploy runner wraps each file in a transaction.

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.uploaded_files') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "uploaded_files" ADD COLUMN IF NOT EXISTS "source" character varying(16) NULL;
END $$;
