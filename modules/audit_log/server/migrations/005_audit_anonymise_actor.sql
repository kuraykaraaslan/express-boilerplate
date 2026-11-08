-- kind: expand
-- repeatable: true
-- audit_log 005: erasure of a sealed actor, step 2 of 2 - the function (docs/phases/02-fleet/10-roadmap/02-phases-5-to-9.md, Phase 5, audit item 8).
--
-- audit_anonymise_actor(p_tenant, p_actor) withdraws the identity of one actor from a SEALED tenant: every mapping row that names the actor becomes a
-- tombstone ("actorId" NULL, "erasedAt" set; see 004) and ONE audit row, `audit.anonymised`, is appended to the tenant's chain in the same transaction.
-- No audit_logs row and no hashed column changes, so the chain keeps verifying; the actor simply stops being resolvable, for good (the tombstone also
-- survives the actor's next write). Returns how many audit rows named the actor (the number the legacy erasure reported).
--
-- Why SECURITY DEFINER: the mapping becomes append-only for the runtime role in a later release (the REVOKE file, audit item 10); this function is then
-- the ONLY way to change a mapping row. That makes the function the policy, so it checks what row level security would have: the caller must be inside
-- the tenant it names (app_current_tenant()) or be the admin bypass. It refuses a tenant whose policy row says 'legacy' (a legacy row carries the id
-- itself and is erased by the legacy path); a tenant with NO policy row is sealed by the role default of a node, so it is allowed: it has no mapping rows to
-- erase unless it really was written sealed, and it names no person in the row it appends: the resource is the first erased pseudonym, the metadata only counts.
-- Repeatable on purpose, like 002: a defect is fixed by editing this file. The search_path is pinned for the same reason as there.

DO $mig$
DECLARE
  sch text := quote_ident(current_schema());
  ddl text;
BEGIN
  ddl := $f$
    CREATE OR REPLACE FUNCTION audit_anonymise_actor(p_tenant uuid, p_actor uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, @SCHEMA@
    AS $b$
    DECLARE
      v_mode text;
      v_refs text[];
      v_rows integer;
    BEGIN
      IF p_tenant IS NULL OR p_actor IS NULL THEN
        RAISE EXCEPTION 'audit_anonymise_actor: tenant and actor are required' USING ERRCODE = '22023';
      END IF;
      IF NOT (SELECT app_rls_bypass()) AND p_tenant IS DISTINCT FROM (SELECT app_current_tenant()) THEN
        RAISE EXCEPTION 'audit_anonymise_actor: the caller is not inside tenant %', p_tenant USING ERRCODE = '42501';
      END IF;
      SELECT p."mode" INTO v_mode FROM audit_chain_policy p WHERE p."tenantId" = p_tenant;
      IF v_mode = 'legacy' THEN
        RAISE EXCEPTION 'audit_anonymise_actor: tenant % is on the legacy chain', p_tenant USING ERRCODE = '23514';
      END IF;

      WITH erased AS (
        UPDATE audit_actor_identities m
           SET "actorId" = NULL, "erasedAt" = now()
         WHERE m."tenantId" = p_tenant AND m."actorId" = p_actor
        RETURNING m."actorRef"
      )
      SELECT array_agg(e."actorRef" ORDER BY e."actorRef") INTO v_refs FROM erased e;

      -- Nothing mapped (never written, or already erased): no row is appended, so erasing twice leaves one record of it.
      IF v_refs IS NULL THEN
        RETURN 0;
      END IF;

      SELECT count(*)::integer INTO v_rows
        FROM audit_logs a
       WHERE a."tenantId" = p_tenant AND (a."actorRef" = ANY (v_refs) OR a."onBehalfOfRef" = ANY (v_refs));

      -- Chained by the trigger like every sealed write (no rowHash, no bare actor id).
      INSERT INTO audit_logs ("tenantId", "actorType", "action", "severity", "resourceType", "resourceId", "metadata")
      VALUES (p_tenant, 'SYSTEM', 'audit.anonymised', 'high', 'audit_actor', v_refs[1],
              jsonb_build_object('mappings', cardinality(v_refs), 'rows', v_rows));
      RETURN v_rows;
    END
    $b$
  $f$;
  EXECUTE replace(ddl, '@SCHEMA@', sch);

  REVOKE ALL ON FUNCTION audit_anonymise_actor(uuid, uuid) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION audit_anonymise_actor(uuid, uuid) TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    GRANT EXECUTE ON FUNCTION audit_anonymise_actor(uuid, uuid) TO app_admin;
  END IF;
END
$mig$;
