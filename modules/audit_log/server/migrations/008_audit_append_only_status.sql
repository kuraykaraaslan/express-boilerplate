-- kind: expand
-- repeatable: true
-- audit_log 008: append-only status (docs/phases/02-fleet/04-security-model.md section 7, audit hardening item 10).
--
-- audit_append_only_status() reports, per protected relation, whether the runtime role (app_runtime) still holds a privilege that would let the application
-- rewrite or erase the audit trail. It changes nothing: the REVOKE itself is the MANUAL file manual/append-only-enable.sql (never part of a numbered deploy,
-- because it breaks the legacy chain's JavaScript purge and erasure, which UPDATE and DELETE audit_logs; run it on a node whose tenants are all sealed, see
-- the file). This function is what a compliance check (`audit.append_only`) and an operator ask afterwards.
--
--   relation   the table
--   forbidden  the privileges the runtime role must not hold on it
--   writable   true when app_runtime holds at least one of them; NULL when the role does not exist (a single-role deployment: the question has no answer)
--
-- Only app_runtime is judged. The table owner and a superuser are outside every table privilege (and, until RLS is forced, outside the policies): the
-- guarantee is only real on a node that connects as a non-owner member of app_runtime. Pinned search_path, EXECUTE closed to PUBLIC, like 002.

DO $mig$
DECLARE
  sch text := quote_ident(current_schema());
  ddl text;
BEGIN
  ddl := $f$
    CREATE OR REPLACE FUNCTION audit_append_only_status() RETURNS TABLE (relation text, forbidden text[], writable boolean)
    LANGUAGE plpgsql STABLE
    SET search_path = pg_catalog, @SCHEMA@
    AS $b$
    DECLARE
      v_has_role boolean := EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = 'app_runtime');
      v_spec text[][] := ARRAY[
        ['audit_logs',              'UPDATE,DELETE,TRUNCATE'],
        ['audit_actor_identities',  'UPDATE,DELETE,TRUNCATE'],
        ['audit_chain_anchors',     'UPDATE,DELETE,TRUNCATE'],
        ['audit_chain_checkpoints', 'INSERT,UPDATE,DELETE,TRUNCATE'],
        ['audit_chain_imports',     'INSERT,UPDATE,DELETE,TRUNCATE'],
        ['audit_chain_policy',      'INSERT,UPDATE,DELETE,TRUNCATE']
      ];
      i integer;
      v_privs text[];
      v_priv text;
      v_any boolean;
    BEGIN
      FOR i IN 1 .. array_length(v_spec, 1) LOOP
        v_privs := string_to_array(v_spec[i][2], ',');
        relation := v_spec[i][1];
        forbidden := v_privs;
        IF NOT v_has_role OR to_regclass(quote_ident(@SCHEMA_TEXT@) || '.' || quote_ident(relation)) IS NULL THEN
          writable := NULL;
        ELSE
          v_any := false;
          FOREACH v_priv IN ARRAY v_privs LOOP
            IF has_table_privilege('app_runtime', quote_ident(@SCHEMA_TEXT@) || '.' || quote_ident(relation), v_priv) THEN v_any := true; END IF;
          END LOOP;
          writable := v_any;
        END IF;
        RETURN NEXT;
      END LOOP;
    END
    $b$
  $f$;
  -- current_schema() inside the function would be pg_catalog (the pinned search_path puts it first), so the schema is spliced in as a literal as well
  EXECUTE replace(replace(ddl, '@SCHEMA@', sch), '@SCHEMA_TEXT@', quote_literal(current_schema()));

  REVOKE ALL ON FUNCTION audit_append_only_status() FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION audit_append_only_status() TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    GRANT EXECUTE ON FUNCTION audit_append_only_status() TO app_admin;
  END IF;
END
$mig$;
