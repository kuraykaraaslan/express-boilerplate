-- kind: expand
-- repeatable: true
-- audit_log 002: hardened audit chain, step 2 of 3 - the functions (docs/phases/02-fleet/10-roadmap/02-phases-5-to-9.md, Phase 5).
--
-- REPEATABLE on purpose: only function bodies live here, so a defect found after release is corrected by editing this
-- file (the runner re-applies it when its checksum changes) instead of burning a migration number. The one thing that
-- must NEVER change is the output of audit_row_hash() for an existing input: every v2 row ever written is verified
-- against it. A different algorithm is a new version: audit_row_hash_v3(), a new tag, a new hashVersion value.
-- (CREATE OR REPLACE cannot change a signature or a return type; such a change needs an explicit DROP FUNCTION here.)
--
-- Objects:
--   audit_hash_field(text)            length-prefixed encoding of one value ('~' for NULL), so no value can be confused
--                                     with its neighbour (a delimiter-based text could not promise that)
--   audit_hash_covered_columns()      the audit_logs columns the hash covers, in the order they are hashed: the declared
--                                     column set. A test fails when audit_logs gains a column that is in neither this list
--                                     nor the explicit "excluded" list, so a new column cannot silently go unhashed
--   audit_row_hash(...)               hex sha256 over 'audit.row.v2' + the chain link + the covered columns
--   audit_chain_before_insert()       the BEFORE INSERT trigger function (the trigger itself is migration 003)
--   audit_verify_chain(...)           verifies a run of v2 rows in the database (stops at a v1 row, which only JavaScript
--                                     can recompute), keyset-paged, soft-deleted rows included
--   audit_chain_import_marks          (table) the transactions allowed to restore one tenant's chain verbatim; only the
--                                     function below writes it. It lives here, beside the trigger that reads it, so the two
--                                     never exist one without the other
--   audit_chain_import_begin(uuid)    opens ONE tenant's restore for the current transaction (a tenant migration, docs/
--                                     phases/02-fleet/05 section 6.4): only in the system context (app_rls_bypass), only
--                                     for a tenant with no chain on this node yet; SECURITY DEFINER, executable by app_admin
--
-- Why these choices (each one is a failure that was found, not a preference):
--   * The advisory lock key is EXACTLY the one the JavaScript writer takes, 'audit_log:chain:' || tenantId. A different
--     key would not exclude an N-1 writer during a rolling deploy and the two would fork the chain.
--   * v2 rows are hashed from the stored columns only. createdAt is `timestamp without time zone`, which node-postgres
--     parses in the PROCESS time zone, so a JavaScript recomputation of a v2 hash would be wrong in any zone but UTC.
--     v2 is therefore verified in SQL, never re-derived in JavaScript. The trigger writes createdAt in UTC, truncated to
--     the millisecond and strictly after the chain head, so the createdAt-ordered verifiers keep working.
--   * metadata is hashed as jsonb::text, which PostgreSQL normalises (key order, number format) independently of the
--     client. The format is stable across releases; a change in a future major version would need a new hashVersion.
--   * sha256(bytea) is built in (PostgreSQL 11+): no pgcrypto.
--   * Every function pins its search_path (pg_catalog first, then the schema this file is applied to): names are
--     resolved at run time inside plpgsql, so a caller's search_path could otherwise substitute them. The schema is
--     only known at apply time (scratch and dedicated tenant schemas differ), hence the EXECUTE format below.
--   * EXECUTE is withdrawn from PUBLIC and granted to the two runtime roles only. Nothing here is SECURITY DEFINER:
--     the trigger runs as the writer, so row level security keeps scoping what it reads to the writer's tenant.

DO $mig$
DECLARE
  sch text := quote_ident(current_schema());
  ddl text;
BEGIN
  ------------------------------------------------------------------------------------------------------------------
  ddl := $f$
    CREATE OR REPLACE FUNCTION audit_hash_field(p_value text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path = pg_catalog, @SCHEMA@
    AS $b$
      SELECT CASE WHEN p_value IS NULL THEN '~'
                  ELSE octet_length(convert_to(p_value, 'UTF8'))::text || ':' || p_value END
    $b$
  $f$;
  EXECUTE replace(ddl, '@SCHEMA@', sch);

  ------------------------------------------------------------------------------------------------------------------
  ddl := $f$
    CREATE OR REPLACE FUNCTION audit_hash_covered_columns() RETURNS text[]
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path = pg_catalog, @SCHEMA@
    AS $b$
      SELECT ARRAY['tenantId', 'actorId', 'actorRef', 'onBehalfOfActorId', 'onBehalfOfRef', 'actorType', 'action',
                   'severity', 'resourceType', 'resourceId', 'metadata', 'ipAddress', 'userAgent', 'createdAt',
                   'actorTenantId', 'commandJti', 'nodeId']
    $b$
  $f$;
  EXECUTE replace(ddl, '@SCHEMA@', sch);

  ------------------------------------------------------------------------------------------------------------------
  -- Covers the chain link (p_prev) and every column of audit_hash_covered_columns(), in that order.
  -- STABLE, not IMMUTABLE: to_char() on a timestamp is declared stable by PostgreSQL. The format string is fixed and
  -- numeric, so the result does not depend on any setting.
  ddl := $f$
    CREATE OR REPLACE FUNCTION audit_row_hash(
      p_prev text,
      p_tenant uuid, p_actor_id uuid, p_actor_ref text, p_on_behalf_of_actor_id uuid, p_on_behalf_of_ref text,
      p_actor_type text, p_action text, p_severity text, p_resource_type text, p_resource_id text,
      p_metadata jsonb, p_ip text, p_user_agent text, p_created_at timestamp,
      p_actor_tenant uuid, p_command_jti uuid, p_node uuid
    ) RETURNS text
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path = pg_catalog, @SCHEMA@
    AS $b$
      SELECT encode(sha256(convert_to(
        'audit.row.v2' || E'\n'
        || audit_hash_field(p_prev) || E'\n'
        || audit_hash_field(p_tenant::text) || E'\n'
        || audit_hash_field(p_actor_id::text) || E'\n'
        || audit_hash_field(p_actor_ref) || E'\n'
        || audit_hash_field(p_on_behalf_of_actor_id::text) || E'\n'
        || audit_hash_field(p_on_behalf_of_ref) || E'\n'
        || audit_hash_field(p_actor_type) || E'\n'
        || audit_hash_field(p_action) || E'\n'
        || audit_hash_field(p_severity) || E'\n'
        || audit_hash_field(p_resource_type) || E'\n'
        || audit_hash_field(p_resource_id) || E'\n'
        || audit_hash_field(p_metadata::text) || E'\n'
        || audit_hash_field(p_ip) || E'\n'
        || audit_hash_field(p_user_agent) || E'\n'
        || audit_hash_field(to_char(p_created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US')) || E'\n'
        || audit_hash_field(p_actor_tenant::text) || E'\n'
        || audit_hash_field(p_command_jti::text) || E'\n'
        || audit_hash_field(p_node::text),
        'UTF8')), 'hex')
    $b$
  $f$;
  EXECUTE replace(ddl, '@SCHEMA@', sch);

  -- The restore marks: written only by audit_chain_import_begin() (as the owner), read by the trigger in the session that inserts
  -- an audit row, which is the owner or one of the two runtime roles. Not PUBLIC: a login of no app role (the IoT gateway's,
  -- IN ROLE iot_gateway) holds nothing on any table, and its start-up check refuses one that does.
  EXECUTE format($t$
    CREATE TABLE IF NOT EXISTS %s.audit_chain_import_marks (
      "txid" bigint NOT NULL,
      "tenantId" uuid NOT NULL,
      "markedAt" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "PK_audit_chain_import_marks" PRIMARY KEY ("txid", "tenantId")
    )$t$, sch);
  EXECUTE format('REVOKE ALL ON %s.audit_chain_import_marks FROM PUBLIC', sch);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %s.audit_chain_import_marks FROM app_runtime', sch);
    EXECUTE format('GRANT SELECT ON %s.audit_chain_import_marks TO app_runtime', sch);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %s.audit_chain_import_marks FROM app_admin', sch);
    EXECUTE format('GRANT SELECT ON %s.audit_chain_import_marks TO app_admin', sch);
  END IF;

  ------------------------------------------------------------------------------------------------------------------
  -- The BEFORE INSERT trigger function. A writer that supplies rowHash is a v1 writer (the JavaScript path, an N-1
  -- node, a seed): the row passes through untouched and is marked v1, unless the tenant is sealed, which refuses it.
  -- A writer that supplies no rowHash gets the row chained here: lock, head, link, UTC millisecond createdAt strictly
  -- after the head, v2 hash.
  ddl := $f$
    CREATE OR REPLACE FUNCTION audit_chain_before_insert() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, @SCHEMA@
    AS $b$
    DECLARE
      v_mode text;
      v_head_hash text;
      v_head_at timestamp;
      v_now timestamp;
    BEGIN
      -- A tenant migration restores rows verbatim, hash and hash version included (docs/phases/02-fleet/05 section 6.4): the
      -- import transaction was marked for this tenant by audit_chain_import_begin(), which only the system context may call
      -- and only for a tenant with no chain here yet; the rows are byte-compared with the source's manifest afterwards. Only
      -- that tenant, only that transaction, only rows that bring their own hash (a v2 write never reads the marks).
      IF NEW."rowHash" IS NOT NULL AND EXISTS (
        SELECT 1 FROM audit_chain_import_marks m WHERE m."txid" = txid_current() AND m."tenantId" = NEW."tenantId"
      ) THEN
        RETURN NEW;
      END IF;

      SELECT p."mode" INTO v_mode FROM audit_chain_policy p WHERE p."tenantId" = NEW."tenantId";

      IF NEW."rowHash" IS NOT NULL THEN
        IF v_mode = 'sealed' THEN
          RAISE EXCEPTION 'audit chain is sealed for tenant %: a caller-supplied rowHash is refused', NEW."tenantId"
            USING ERRCODE = '23514', HINT = 'sealed tenants are hashed by the database trigger only';
        END IF;
        NEW."hashVersion" := NULL;
        RETURN NEW;
      END IF;

      IF v_mode = 'sealed' AND (NEW."actorId" IS NOT NULL OR NEW."onBehalfOfActorId" IS NOT NULL) THEN
        RAISE EXCEPTION 'audit chain is sealed for tenant %: a row carries a bare actor id instead of an actorRef', NEW."tenantId"
          USING ERRCODE = '23514', HINT = 'write actorRef / onBehalfOfRef and the audit_actor_identities mapping';
      END IF;

      PERFORM pg_advisory_xact_lock(hashtext('audit_log:chain:' || NEW."tenantId"::text));

      SELECT a."rowHash", a."createdAt" INTO v_head_hash, v_head_at
        FROM audit_logs a
       WHERE a."tenantId" = NEW."tenantId"
       ORDER BY a."createdAt" DESC, a."auditLogId" DESC
       LIMIT 1;

      v_now := date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC');
      IF v_head_at IS NOT NULL THEN
        v_now := GREATEST(v_now, v_head_at + interval '1 millisecond');
      END IF;

      NEW."prevHash" := v_head_hash;
      NEW."createdAt" := v_now;
      NEW."hashVersion" := 2;
      NEW."rowHash" := audit_row_hash(
        v_head_hash,
        NEW."tenantId", NEW."actorId", NEW."actorRef", NEW."onBehalfOfActorId", NEW."onBehalfOfRef",
        NEW."actorType", NEW."action", NEW."severity", NEW."resourceType", NEW."resourceId",
        NEW."metadata", NEW."ipAddress", NEW."userAgent", NEW."createdAt",
        NEW."actorTenantId", NEW."commandJti", NEW."nodeId");
      RETURN NEW;
    END
    $b$
  $f$;
  EXECUTE replace(ddl, '@SCHEMA@', sch);

  ddl := $f$
    CREATE OR REPLACE FUNCTION audit_chain_import_begin(p_tenant uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, @SCHEMA@
    AS $b$
    BEGIN
      IF p_tenant IS NULL THEN
        RAISE EXCEPTION 'audit_chain_import_begin: tenant is required' USING ERRCODE = '22023';
      END IF;
      IF NOT (SELECT app_rls_bypass()) THEN
        RAISE EXCEPTION 'audit_chain_import_begin: only the system context restores a chain' USING ERRCODE = '42501';
      END IF;
      PERFORM pg_advisory_xact_lock(hashtext('audit_log:chain:' || p_tenant::text));
      IF EXISTS (SELECT 1 FROM audit_logs a WHERE a."tenantId" = p_tenant) THEN
        RAISE EXCEPTION 'audit_chain_import_begin: tenant % already has an audit chain on this node', p_tenant
          USING ERRCODE = '23514', HINT = 'a restore may only start an empty chain';
      END IF;
      DELETE FROM audit_chain_import_marks WHERE "markedAt" < now() - interval '1 day';
      INSERT INTO audit_chain_import_marks ("txid", "tenantId") VALUES (txid_current(), p_tenant) ON CONFLICT DO NOTHING;
    END
    $b$
  $f$;
  EXECUTE replace(ddl, '@SCHEMA@', sch);

  ------------------------------------------------------------------------------------------------------------------
  -- Verifies the v2 rows that follow a cursor, up to p_limit rows. Rows are walked in (createdAt, auditLogId) order,
  -- soft-deleted rows INCLUDED (a soft delete must not hide a row from the check).
  --   p_expected_prev   the hash the first row must link to (NULL for the start of the chain; the hash of the last
  --                     verified row when resuming; the checkpoint head after a purge)
  --   p_after_at/_id    the cursor: only rows strictly after (createdAt, auditLogId) are read; NULL = from the start.
  --                     createdAt travels as text 'YYYY-MM-DD HH24:MI:SS.US' so no client time zone can touch it.
  -- Result (always one row):
  --   checked           rows verified (a broken row is not counted)
  --   broken_id         the first row whose link or hash does not match, or whose hashVersion is unknown; else NULL
  --   last_at/_id/_hash the cursor and the hash of the last verified row, to resume from
  --   stopped_at_v1     true when the walk stopped in front of a v1 row (hashVersion NULL), which JavaScript verifies
  ddl := $f$
    CREATE OR REPLACE FUNCTION audit_verify_chain(
      p_tenant uuid, p_after_at text, p_after_id uuid, p_expected_prev text, p_limit integer
    ) RETURNS TABLE (checked integer, broken_id uuid, last_at text, last_id uuid, last_hash text, stopped_at_v1 boolean)
    LANGUAGE plpgsql STABLE
    SET search_path = pg_catalog, @SCHEMA@
    AS $b$
    DECLARE
      r audit_logs%ROWTYPE;
      v_prev text := p_expected_prev;
      v_checked integer := 0;
      v_broken uuid := NULL;
      v_last_at text := p_after_at;
      v_last_id uuid := p_after_id;
      v_stopped boolean := false;
    BEGIN
      IF p_limit IS NULL OR p_limit < 1 THEN
        RAISE EXCEPTION 'audit_verify_chain: p_limit must be a positive integer';
      END IF;
      FOR r IN
        SELECT a.* FROM audit_logs a
         WHERE a."tenantId" = p_tenant
           AND (p_after_id IS NULL OR (a."createdAt", a."auditLogId") > (p_after_at::timestamp, p_after_id))
         ORDER BY a."createdAt", a."auditLogId"
         LIMIT p_limit
      LOOP
        IF r."hashVersion" IS NULL THEN
          v_stopped := true;
          EXIT;
        END IF;
        IF r."hashVersion" <> 2
           OR r."prevHash" IS DISTINCT FROM v_prev
           OR r."rowHash" IS DISTINCT FROM audit_row_hash(
                r."prevHash",
                r."tenantId", r."actorId", r."actorRef", r."onBehalfOfActorId", r."onBehalfOfRef",
                r."actorType", r."action", r."severity", r."resourceType", r."resourceId",
                r."metadata", r."ipAddress", r."userAgent", r."createdAt",
                r."actorTenantId", r."commandJti", r."nodeId") THEN
          v_broken := r."auditLogId";
          EXIT;
        END IF;
        v_checked := v_checked + 1;
        v_prev := r."rowHash";
        v_last_at := to_char(r."createdAt", 'YYYY-MM-DD HH24:MI:SS.US');
        v_last_id := r."auditLogId";
      END LOOP;
      RETURN QUERY SELECT v_checked, v_broken, v_last_at, v_last_id, v_prev, v_stopped;
    END
    $b$
  $f$;
  EXECUTE replace(ddl, '@SCHEMA@', sch);

  ------------------------------------------------------------------------------------------------------------------
  -- Not callable by PUBLIC. The trigger runs as the writer, so the writing roles need EXECUTE on what it calls.
  REVOKE ALL ON FUNCTION audit_hash_field(text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION audit_hash_covered_columns() FROM PUBLIC;
  REVOKE ALL ON FUNCTION audit_row_hash(text, uuid, uuid, text, uuid, text, text, text, text, text, text, jsonb, text, text, timestamp, uuid, uuid, uuid) FROM PUBLIC;
  REVOKE ALL ON FUNCTION audit_chain_before_insert() FROM PUBLIC;
  REVOKE ALL ON FUNCTION audit_verify_chain(uuid, text, uuid, text, integer) FROM PUBLIC;
  REVOKE ALL ON FUNCTION audit_chain_import_begin(uuid) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION audit_hash_field(text) TO app_runtime;
    GRANT EXECUTE ON FUNCTION audit_hash_covered_columns() TO app_runtime;
    GRANT EXECUTE ON FUNCTION audit_row_hash(text, uuid, uuid, text, uuid, text, text, text, text, text, text, jsonb, text, text, timestamp, uuid, uuid, uuid) TO app_runtime;
    GRANT EXECUTE ON FUNCTION audit_chain_before_insert() TO app_runtime;
    GRANT EXECUTE ON FUNCTION audit_verify_chain(uuid, text, uuid, text, integer) TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    GRANT EXECUTE ON FUNCTION audit_hash_field(text) TO app_admin;
    GRANT EXECUTE ON FUNCTION audit_hash_covered_columns() TO app_admin;
    GRANT EXECUTE ON FUNCTION audit_row_hash(text, uuid, uuid, text, uuid, text, text, text, text, text, text, jsonb, text, text, timestamp, uuid, uuid, uuid) TO app_admin;
    GRANT EXECUTE ON FUNCTION audit_chain_before_insert() TO app_admin;
    GRANT EXECUTE ON FUNCTION audit_verify_chain(uuid, text, uuid, text, integer) TO app_admin;
    GRANT EXECUTE ON FUNCTION audit_chain_import_begin(uuid) TO app_admin;
  END IF;
END
$mig$;
