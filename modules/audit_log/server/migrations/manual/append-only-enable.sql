-- ============================================================================
-- MANUAL - make the audit trail append-only for the application (audit hardening item 10)
-- ============================================================================
--
-- NOT applied by `db:deploy`: the numbered runner reads `migrations/*.sql` and does not descend into this directory. Running it is a decision, not a
-- deployment side effect, because it takes away privileges the LEGACY chain still uses:
--
--   * audit_logs: UPDATE and DELETE are what the legacy purge, the legacy erasure (anonymizeActor) and soft deletes do. Run this ONLY on a node whose
--     tenants are ALL on the sealed chain: a sealed chain is purged by audit_chain_checkpoint / audit_chain_purge and erased by audit_anonymise_actor, all
--     SECURITY DEFINER, so they keep working without the privileges (the integration tests run them as a runtime role with these privileges revoked).
--   * audit_chain_policy: written by the platform operator (app_admin) and by nothing in the request path; after this the runtime role cannot downgrade a
--     tenant from sealed to legacy even with arbitrary SQL inside its own tenant.
--   * audit_chain_checkpoints: written only by audit_chain_checkpoint().
--   * audit_chain_imports: written only by audit_chain_import_record() (a tenant migration's import, 011).
--
-- What stays: INSERT on audit_logs (the writer), audit_actor_identities (the mapping, ON CONFLICT DO NOTHING) and audit_chain_anchors (the anchoring seam),
-- and SELECT everywhere. The privileges of app_admin are untouched.
--
-- The honest limit: the table owner and any superuser are outside every table privilege. This is only real on a node that connects as a non-owner member of
-- app_runtime. Check the result with `SELECT * FROM audit_append_only_status()` (all `writable = false`).
--
--     psql "$DATABASE_URL_UNPOOLED" -f modules/audit_log/server/migrations/manual/append-only-enable.sql
-- Reverse: append-only-disable.sql next to this file.
-- ============================================================================

DO $$
DECLARE
  sch text := quote_ident(current_schema());
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    RAISE NOTICE 'append-only-enable: the role app_runtime does not exist; nothing to revoke';
    RETURN;
  END IF;
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s.audit_logs FROM app_runtime', sch);
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s.audit_actor_identities FROM app_runtime', sch);
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %s.audit_chain_anchors FROM app_runtime', sch);
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %s.audit_chain_checkpoints FROM app_runtime', sch);
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %s.audit_chain_imports FROM app_runtime', sch);
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %s.audit_chain_policy FROM app_runtime', sch);
END
$$;
