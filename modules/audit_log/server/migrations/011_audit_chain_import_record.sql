-- kind: expand
-- repeatable: true
-- audit_log 011: the record of an audit history that arrived with a tenant migration, step 2 of 2 - the function (docs/phases/02-fleet/05-tenancy-and-routing.md
-- section 6.4 "Audit chain").
--
--   audit_chain_import_record(p_tenant, p_source_node, p_head_proven)
--       called once by an import, in the transaction that restored the tenant's rows (audit_chain_import_begin marked it): walks the tenant's chain from the
--       newest checkpoint the bundle carried with audit_verify_chain (002), finds the newest imported row (or that checkpoint, when no row was kept), and
--       writes one audit_chain_imports row (010). The verdict is PROVEN only when the head was proven (p_head_proven: the node app verified the bundle's
--       proof against its trust bundle before any row was written) AND every link recomputed; EMPTY when nothing was imported; IMPORTED_UNVERIFIED
--       otherwise. Returns the row's id, the verdict, the chain status and the number of rows.
--
-- The caller names the tenant, the source and one fact it alone can check (the proof's signature); the boundary and the chain status are read here, so no
-- argument can mark rows that were not imported or call a broken chain verified. Outside an open restore of that tenant in THIS transaction it refuses.
-- SECURITY DEFINER (the table's writes are withdrawn from the runtime role by the append-only switch), executable by app_admin only, like
-- audit_chain_import_begin; search_path pinned; repeatable like 002 and 007.
DO $mig$
DECLARE
  sch text := quote_ident(current_schema());
  ddl text;
BEGIN
  ddl := $f$
    CREATE OR REPLACE FUNCTION audit_chain_import_record(p_tenant uuid, p_source_node text, p_head_proven boolean)
    RETURNS TABLE (import_id uuid, verdict text, chain_status text, row_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, @SCHEMA@
    AS $b$
    DECLARE
      c_page constant integer := 1000;
      v_cp_at timestamp;
      v_cp_id uuid;
      v_cp_hash text;
      v_after_at text;
      v_after_id uuid;
      v_prev text;
      v_step record;
      v_status text := 'VERIFIED';
      v_head_at timestamp;
      v_head_id uuid;
      v_head_hash text;
      v_rows integer;
      v_verdict text;
      v_id uuid;
    BEGIN
      IF p_tenant IS NULL OR p_source_node IS NULL OR p_head_proven IS NULL THEN
        RAISE EXCEPTION 'audit_chain_import_record: tenant, source node and proof verdict are required' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM audit_chain_import_marks m WHERE m."txid" = txid_current() AND m."tenantId" = p_tenant) THEN
        RAISE EXCEPTION 'audit_chain_import_record: no restore of tenant % is open in this transaction', p_tenant USING ERRCODE = '42501';
      END IF;
      -- The kept chain starts after the newest checkpoint the bundle carried: its first row must link to the checkpoint's head (NULL: nothing was purged).
      SELECT c."coveredThrough", c."coveredThroughId", c."headHash" INTO v_cp_at, v_cp_id, v_cp_hash
        FROM audit_chain_checkpoints c WHERE c."tenantId" = p_tenant
       ORDER BY c."coveredThrough" DESC, c."coveredThroughId" DESC LIMIT 1;
      v_prev := v_cp_hash;
      v_after_id := v_cp_id;
      v_after_at := CASE WHEN v_cp_at IS NULL THEN NULL ELSE to_char(v_cp_at, 'YYYY-MM-DD HH24:MI:SS.US') END;
      LOOP
        SELECT * INTO v_step FROM audit_verify_chain(p_tenant, v_after_at, v_after_id, v_prev, c_page);
        IF v_step.broken_id IS NOT NULL THEN v_status := 'BROKEN'; EXIT; END IF;
        -- a v1 row (hashVersion NULL) is only recomputable in JavaScript: the database cannot vouch for this history
        IF v_step.stopped_at_v1 THEN v_status := 'NOT_VERIFIABLE'; EXIT; END IF;
        EXIT WHEN v_step.checked < c_page;
        v_after_at := v_step.last_at;
        v_after_id := v_step.last_id;
        v_prev := v_step.last_hash;
      END LOOP;
      SELECT a."createdAt", a."auditLogId", a."rowHash" INTO v_head_at, v_head_id, v_head_hash
        FROM audit_logs a WHERE a."tenantId" = p_tenant
       ORDER BY a."createdAt" DESC, a."auditLogId" DESC LIMIT 1;
      SELECT count(*)::integer INTO v_rows FROM audit_logs a WHERE a."tenantId" = p_tenant;
      IF v_head_id IS NULL AND v_cp_id IS NOT NULL THEN
        v_head_at := v_cp_at; v_head_id := v_cp_id; v_head_hash := v_cp_hash;
      END IF;
      v_verdict := CASE
        WHEN v_head_id IS NULL THEN 'EMPTY'
        WHEN p_head_proven AND v_status = 'VERIFIED' THEN 'PROVEN'
        ELSE 'IMPORTED_UNVERIFIED'
      END;
      INSERT INTO audit_chain_imports ("tenantId", "sourceNodeId", "verdict", "chainStatus", "headProven", "coveredThrough", "coveredThroughId", "headHash", "rowCount")
      VALUES (p_tenant, p_source_node, v_verdict, v_status, p_head_proven, v_head_at, v_head_id, v_head_hash, v_rows)
      RETURNING "importId" INTO v_id;
      RETURN QUERY SELECT v_id, v_verdict, v_status, v_rows;
    END
    $b$
  $f$;
  EXECUTE replace(ddl, '@SCHEMA@', sch);

  REVOKE ALL ON FUNCTION audit_chain_import_record(uuid, text, boolean) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    GRANT EXECUTE ON FUNCTION audit_chain_import_record(uuid, text, boolean) TO app_admin;
  END IF;
END
$mig$;
