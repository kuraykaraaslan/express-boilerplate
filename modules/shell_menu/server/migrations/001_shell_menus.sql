-- kind: expand
-- shell_menu 001: the installation's sidebar menu, set by the sysadmin in Platform → Menu (docs/phases/54-menu-editor).
--
-- `shell_menus` holds at most one draft and one published row; `shell_menu_revisions` keeps every published state
-- (append-only). System-wide by design, like `translations`: there is no tenant column, one menu serves the whole
-- installation. The CREATE TABLE statements are the DDL TypeORM generates from the entities (constraint names
-- included), so `synchronize` and this file build the same tables, and every statement is idempotent.
--
-- ## Row-level security
--
-- None: there is no tenant column to isolate on. Both tables are classified in the EXEMPT list of
-- modules/db/scripts/rls-exempt.ts with that reason.

SELECT set_config('search_path', quote_ident(current_schema()) || ', public', true);

CREATE TABLE IF NOT EXISTS "shell_menus" (
  "menuId" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "state" character varying(16) NOT NULL,
  "spec" jsonb NOT NULL,
  "labels" jsonb,
  "revision" integer NOT NULL DEFAULT 0,
  "etag" character varying(64) NOT NULL,
  "updatedBy" uuid,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "uq_shell_menus_state" UNIQUE ("state"),
  CONSTRAINT "ck_shell_menus_state" CHECK ("state" IN ('draft', 'published')),
  CONSTRAINT "PK_51a6edf43e0caab45de9a43a415" PRIMARY KEY ("menuId")
);

CREATE TABLE IF NOT EXISTS "shell_menu_revisions" (
  "revisionId" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "revision" integer NOT NULL,
  "spec" jsonb NOT NULL,
  "labelTexts" jsonb NOT NULL,
  "action" character varying(16) NOT NULL,
  "note" character varying(280),
  "via" character varying(8) NOT NULL,
  "createdBy" uuid,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "uq_shell_menu_revisions_revision" UNIQUE ("revision"),
  CONSTRAINT "ck_shell_menu_revisions_action" CHECK ("action" IN ('publish', 'restore', 'import')),
  CONSTRAINT "ck_shell_menu_revisions_via" CHECK ("via" IN ('ui', 'cli')),
  CONSTRAINT "PK_850e37a6e972925e30324bbbb0a" PRIMARY KEY ("revisionId")
);
