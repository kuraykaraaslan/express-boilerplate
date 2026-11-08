-- kind: expand
-- repeatable: true
-- audit_log 007: retention checkpoints for a sealed chain, step 2 of 2 - the functions (docs/phases/02-fleet/04-security-model.md section 7).
--
--   audit_chain_checkpoint(p_tenant)  records, and returns, the point a purge may reach; deletes nothing.
--   audit_chain_purge(p_tenant)       deletes the rows the newest checkpoint covers, and only those.
--
-- A checkpoint may only cover rows that (1) are older than the tenant's retention window, read from audit_chain_policy."retentionDays" (a table the platform
-- operator writes, never a tenant setting), AND (2) are at or before a chain head the control plane has ACKNOWLEDGED (audit_chain_anchors): a row nobody outside
-- the node has witnessed is never the one that disappears. Both limits are computed here, from the database clock and the stored anchors: the caller supplies
-- a tenant and nothing else, so no argument can widen what is purged (in particular there is no "now" parameter).
--
-- SECURITY DEFINER, with the same reasoning as audit_anonymise_actor (005): audit item 10 withdraws DELETE and every write to these tables from the runtime role, so
-- these two functions become the only way to purge, and each therefore checks what row level security would have (the caller must be inside the tenant it names, or
-- be the admin bypass) and refuses a tenant whose policy row says 'legacy' (the legacy chain keeps its JavaScript purge). A tenant with no policy row is sealed by the role default of a node, but has no retention window either, so a checkpoint is a no-op for it until the operator writes its policy row. Both take the tenant's chain advisory lock, the one
-- the writer takes, so a purge and a write never interleave on one chain. search_path is pinned; repeatable like 002.

DO $mig$
DECLARE
  sch text := quote_ident(current_schema());
  ddl text;
BEGIN
  ------------------------------------------------------------------------------------------------------------------
  ddl := $f$
    CREATE OR REPLACE FUNCTION audit_chain_checkpoint(p_tenant uuid)
    RETURNS TABLE (checkpoint_id uuid, covered_through text, covered_through_id uuid, head_hash text, row_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, @SCHEMA@
    AS $b$
    DECLARE
      v_mode text;
      v_days integer;
      v_cutoff timestamp;
      v_prev_at timestamp;
      v_prev_id uuid;
      v_prev_total bigint;
      v_anchor_id uuid;
      v_anchor_at timestamp;
      v_anchor_row uuid;
      v_row_id uuid;
      v_row_at timestamp;
      v_row_hash text;
      v_count integer;
      v_checkpoint uuid;
    BEGIN
      IF p_tenant IS NULL THEN
        RAISE EXCEPTION 'audit_chain_checkpoint: tenant is required' USING ERRCODE = '22023';
      END IF;
      IF NOT (SELECT app_rls_bypass()) AND p_tenant IS DISTINCT FROM (SELECT app_current_tenant()) THEN
        RAISE EXCEPTION 'audit_chain_checkpoint: the caller is not inside tenant %', p_tenant USING ERRCODE = '42501';
      END IF;
      SELECT p."mode", p."retentionDays" INTO v_mode, v_days FROM audit_chain_policy p WHERE p."tenantId" = p_tenant;
      IF v_mode = 'legacy' THEN
        RAISE EXCEPTION 'audit_chain_checkpoint: tenant % is on the legacy chain', p_tenant USING ERRCODE = '23514';
      END IF;
      IF v_days IS NULL THEN
        RETURN;   -- keep forever
      END IF;

      PERFORM pg_advisory_xact_lock(hashtext('audit_log:chain:' || p_tenant::text));

      v_cutoff := date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') - make_interval(days => v_days);

      SELECT c."coveredThrough", c."coveredThroughId", c."purgedTotal" INTO v_prev_at, v_prev_id, v_prev_total
        FROM audit_chain_checkpoints c WHERE c."tenantId" = p_tenant
       ORDER BY c."coveredThrough" DESC, c."coveredThroughId" DESC LIMIT 1;
      v_prev_total := COALESCE(v_prev_total, 0);

      -- The newest acknowledged head that is still a row of this chain.
      SELECT an."anchorId", a."createdAt", a."auditLogId" INTO v_anchor_id, v_anchor_at, v_anchor_row
        FROM audit_chain_anchors an
        JOIN audit_logs a ON a."tenantId" = an."tenantId" AND a."rowHash" = an."headHash"
       WHERE an."tenantId" = p_tenant
       ORDER BY a."createdAt" DESC, a."auditLogId" DESC LIMIT 1;
      IF v_anchor_id IS NULL THEN
        RETURN;   -- nothing the control plane has witnessed: nothing may go
      END IF;

      -- The newest row that is both old enough and acknowledged, after the previous checkpoint.
      SELECT a."auditLogId", a."createdAt", a."rowHash" INTO v_row_id, v_row_at, v_row_hash
        FROM audit_logs a
       WHERE a."tenantId" = p_tenant
         AND a."createdAt" <= v_cutoff
         AND (a."createdAt", a."auditLogId") <= (v_anchor_at, v_anchor_row)
         AND (v_prev_at IS NULL OR (a."createdAt", a."auditLogId") > (v_prev_at, v_prev_id))
       ORDER BY a."createdAt" DESC, a."auditLogId" DESC LIMIT 1;
      IF v_row_id IS NULL OR v_row_hash IS NULL THEN
        RETURN;
      END IF;

      SELECT count(*)::integer INTO v_count
        FROM audit_logs a
       WHERE a."tenantId" = p_tenant
         AND (a."createdAt", a."auditLogId") <= (v_row_at, v_row_id)
         AND (v_prev_at IS NULL OR (a."createdAt", a."auditLogId") > (v_prev_at, v_prev_id));

      INSERT INTO audit_chain_checkpoints ("tenantId", "coveredThrough", "coveredThroughId", "headHash", "rowCount", "purgedTotal", "anchorId")
      VALUES (p_tenant, v_row_at, v_row_id, v_row_hash, v_count, v_prev_total + v_count, v_anchor_id)
      RETURNING "checkpointId" INTO v_checkpoint;

      RETURN QUERY SELECT v_checkpoint, to_char(v_row_at, 'YYYY-MM-DD HH24:MI:SS.US'), v_row_id, v_row_hash, v_count;
    END
    $b$
  $f$;
  EXECUTE replace(ddl, '@SCHEMA@', sch);

  ------------------------------------------------------------------------------------------------------------------
  ddl := $f$
    CREATE OR REPLACE FUNCTION audit_chain_purge(p_tenant uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, @SCHEMA@
    AS $b$
    DECLARE
      v_mode text;
      v_at timestamp;
      v_id uuid;
      v_deleted integer;
    BEGIN
      IF p_tenant IS NULL THEN
        RAISE EXCEPTION 'audit_chain_purge: tenant is required' USING ERRCODE = '22023';
      END IF;
      IF NOT (SELECT app_rls_bypass()) AND p_tenant IS DISTINCT FROM (SELECT app_current_tenant()) THEN
        RAISE EXCEPTION 'audit_chain_purge: the caller is not inside tenant %', p_tenant USING ERRCODE = '42501';
      END IF;
      SELECT p."mode" INTO v_mode FROM audit_chain_policy p WHERE p."tenantId" = p_tenant;
      IF v_mode = 'legacy' THEN
        RAISE EXCEPTION 'audit_chain_purge: tenant % is on the legacy chain', p_tenant USING ERRCODE = '23514';
      END IF;

      PERFORM pg_advisory_xact_lock(hashtext('audit_log:chain:' || p_tenant::text));

      SELECT c."coveredThrough", c."coveredThroughId" INTO v_at, v_id
        FROM audit_chain_checkpoints c WHERE c."tenantId" = p_tenant
       ORDER BY c."coveredThrough" DESC, c."coveredThroughId" DESC LIMIT 1;
      IF v_at IS NULL THEN
        RETURN 0;   -- no checkpoint, no purge
      END IF;

      DELETE FROM audit_logs a WHERE a."tenantId" = p_tenant AND (a."createdAt", a."auditLogId") <= (v_at, v_id);
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
      RETURN v_deleted;
    END
    $b$
  $f$;
  EXECUTE replace(ddl, '@SCHEMA@', sch);

  ------------------------------------------------------------------------------------------------------------------
  REVOKE ALL ON FUNCTION audit_chain_checkpoint(uuid) FROM PUBLIC;
  REVOKE ALL ON FUNCTION audit_chain_purge(uuid) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION audit_chain_checkpoint(uuid) TO app_runtime;
    GRANT EXECUTE ON FUNCTION audit_chain_purge(uuid) TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    GRANT EXECUTE ON FUNCTION audit_chain_checkpoint(uuid) TO app_admin;
    GRANT EXECUTE ON FUNCTION audit_chain_purge(uuid) TO app_admin;
  END IF;
END
$mig$;
