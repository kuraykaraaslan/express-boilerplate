-- ============================================================================
-- MANUAL - give the application its write privileges on the audit trail back (reverse of append-only-enable.sql)
-- ============================================================================
-- Restores what migration 122 granted app_runtime on these tables: SELECT, INSERT, UPDATE, DELETE. Needed again if a legacy tenant is (re)introduced on
-- the node, because the legacy purge and erasure UPDATE and DELETE audit_logs.
--
--     psql "$DATABASE_URL_UNPOOLED" -f modules/audit_log/server/migrations/manual/append-only-disable.sql
-- ============================================================================

DO $$
DECLARE
  sch text := quote_ident(current_schema());
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    RAISE NOTICE 'append-only-disable: the role app_runtime does not exist; nothing to grant';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['audit_logs', 'audit_actor_identities', 'audit_chain_anchors', 'audit_chain_checkpoints', 'audit_chain_policy', 'audit_chain_imports'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s.%I TO app_runtime', sch, t);
  END LOOP;
END
$$;
