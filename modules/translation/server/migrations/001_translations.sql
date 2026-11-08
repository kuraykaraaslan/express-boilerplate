-- kind: expand
-- translation 001: the `translations` table, UI texts kept in the database on top of the module dictionaries in code.
--
-- One row per (locale, module, platform, key); `platform` NULL = shared by web and mobile. System-wide by design: there
-- is no tenant column, every tenant reads the same texts. The CREATE TABLE is the DDL TypeORM generates from the
-- entity (constraint names included), so `synchronize` and this file build the same table; on a single-role deployment
-- synchronize has already built it when this file runs, and every statement is idempotent.
--
-- ## NULLS NOT DISTINCT
--
-- NULL is a real value in a key column (`platform`). A plain unique index treats two NULLs as different, which would
-- allow the same shared text twice; `NULLS NOT DISTINCT` (PostgreSQL 15+) treats them as equal. TypeORM 0.3 cannot
-- express that, so the index lives here and the entity declares the same name with `synchronize: false` (never created
-- or dropped by synchronize). If an older index of that name exists without the option, it is replaced.
--
-- ## Row-level security
--
-- None: there is no tenant column to isolate on. The table is classified in the EXEMPT list of
-- modules/db/scripts/gen-rls-policies.mts with that reason.

-- The primary key default is uuid-ossp's uuid_generate_v4(), installed in `public` by the baseline; the runner's search
-- path is the target schema alone, so `public` is added for this transaction only, exactly as the baseline does.
SELECT set_config('search_path', quote_ident(current_schema()) || ', public', true);

CREATE TABLE IF NOT EXISTS "translations" (
  "translationId" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "locale" character varying(16) NOT NULL,
  "module" character varying(64) NOT NULL,
  "platform" character varying(8),
  "key" character varying(255) NOT NULL,
  "value" text NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "ck_translations_key_module" CHECK (left("key", length("module") + 1) = "module" || '.'),
  CONSTRAINT "ck_translations_platform" CHECK ("platform" IS NULL OR "platform" IN ('web', 'mobile')),
  CONSTRAINT "PK_a18b5beab8aeb18316c07f2f869" PRIMARY KEY ("translationId")
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'uq_translations_scope_key' AND c.relnamespace = current_schema()::regnamespace
      AND NOT i.indnullsnotdistinct
  ) THEN
    DROP INDEX "uq_translations_scope_key";
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_translations_scope_key"
  ON "translations" ("locale", "module", "platform", "key") NULLS NOT DISTINCT;
