-- kind: expand
-- supersedes: 8fa0d84af575a278c8a5b9ad8179044e54322e278a32940e5d171def34ccbc66
-- telemetry 001: the Core telemetry store (docs/phases/42-telemetry/00 §0.2–§0.5, 01 T01-5; the IoT history: iot_telemetry 001).
--
--   telemetry_msg_r{d}          one row per message and retention class d (7/30/90/365/1095 days): numeric values by key id in
--                               numKeyIds/numVals (same order, same length), every other value under its key name in other (jsonb).
--                               Key (tenantId, entityId, ts, msgHash): tenant first, the time column in it, idempotent per message.
--   telemetry_1m_r{d}           the 1-minute aggregates of the numeric keys, filled by this module's own job (minute rollup).
--   telemetry_keys              the per-tenant key dictionary (global int4 identity, unique (tenantId, key)), shared by every kind.
--   telemetry_latest            the latest value per entity and key (strict > on ts), entityType = the kind beside the key.
--   telemetry_class_bindings    the retention class history of a tenant PER KIND (the current row has validTo NULL).
--   telemetry_1m_state          the minute job's watermark per tenant and class.
--   telemetry_1m_dirty          dirty-minute hints the writer leaves for late rows, in the same transaction as the rows.
--
-- Two paths, one file:
--   A. a database that ran iot_telemetry 001 before this module existed: the iot_ts_* objects are RENAMED in place, in this
--      transaction, together with everything db resolves BY NAME at runtime (reference/2026-10-24-perf-verification.md F1–F3):
--      the (tenantId, ts DESC) indexes `ensureTenantTimeIndex` creates with CREATE INDEX IF NOT EXISTS "<table>_tenantId_ts_idx"
--      (an un-renamed one would leave a duplicate index on every raw hypertable), the <table>_v access views the writer resolves
--      per transaction (an un-renamed one is a write outage until the deploy), and the rows of time_series_rollup_state /
--      time_series_rollup_dirty keyed by the rollup table name (an un-renamed one restarts every hour/day rollup from scratch).
--      Chunks, RLS policies, the owner role and the retention policies follow the table OID and need nothing.
--   B. a fresh database: the tables are created under the new names (idempotent).
-- Then the RLS policy pair and FORCE on every table, both paths.
--
-- The class tables are plain tables here. db's time-series deploy phase (`db:time_series`, this module's telemetry.timeseries.ts)
-- gives them to the owner role, turns them into hypertables (chunk interval sized by the install, ED-15), creates the <table>_v
-- access views, the hour and day rollups of the 1-minute tables and the retention. No compression: an RLS hypertable cannot be
-- compressed. TimescaleDB is not required by this module (plain tables with a BRIN index otherwise); the IoT package's boot check
-- (OD-30) is the one that refuses a database without it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    RAISE WARNING 'telemetry: timescaledb is not installed: the telemetry tables stay plain tables (the IoT package refuses to start without it, OD-30)';
  END IF;
END $$;

-- ── A. rename an install that holds the IoT-era tables ────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  d int;
  old_t text;
  new_t text;
  suffix text;
BEGIN
  IF to_regclass('"iot_ts_msg_r7"') IS NULL THEN
    RETURN;
  END IF;
  -- the bookkeeping tables carry FORCE RLS: a deploy login that is not a superuser needs the admin bypass for the UPDATEs below
  PERFORM set_config('app.bypass_rls', 'on', true);

  FOREACH d IN ARRAY ARRAY[7, 30, 90, 365, 1095] LOOP
    -- raw, minute, and the hour/day rollups db created (which exist only on a deployed database)
    FOREACH suffix IN ARRAY ARRAY['msg_r', '1m_r', '1h_r', '1d_r'] LOOP
      old_t := 'iot_ts_' || suffix || d;
      new_t := 'telemetry_' || suffix || d;
      IF to_regclass(format('%I', old_t)) IS NULL THEN CONTINUE; END IF;
      EXECUTE format('ALTER TABLE %I RENAME TO %I', old_t, new_t);
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = old_t || '_pkey' AND conrelid = to_regclass(format('%I', new_t))) THEN
        EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', new_t, old_t || '_pkey', new_t || '_pkey');
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_' || old_t || '_arrays' AND conrelid = to_regclass(format('%I', new_t))) THEN
        EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', new_t, 'ck_' || old_t || '_arrays', 'ck_' || new_t || '_arrays');
      END IF;
      -- the indexes db names after the table: (tenantId, time DESC) and the plain-mode BRIN
      IF to_regclass(format('%I', old_t || '_tenantId_ts_idx')) IS NOT NULL THEN
        EXECUTE format('ALTER INDEX %I RENAME TO %I', old_t || '_tenantId_ts_idx', new_t || '_tenantId_ts_idx');
      END IF;
      IF to_regclass(format('%I', old_t || '_tenantId_bucket_idx')) IS NOT NULL THEN
        EXECUTE format('ALTER INDEX %I RENAME TO %I', old_t || '_tenantId_bucket_idx', new_t || '_tenantId_bucket_idx');
      END IF;
      IF to_regclass(format('%I', old_t || '_ts_brin')) IS NOT NULL THEN
        EXECUTE format('ALTER INDEX %I RENAME TO %I', old_t || '_ts_brin', new_t || '_ts_brin');
      END IF;
      IF to_regclass(format('%I', old_t || '_bucket_brin')) IS NOT NULL THEN
        EXECUTE format('ALTER INDEX %I RENAME TO %I', old_t || '_bucket_brin', new_t || '_bucket_brin');
      END IF;
      -- the access view the writer resolves by name
      IF to_regclass(format('%I', old_t || '_v')) IS NOT NULL THEN
        EXECUTE format('ALTER VIEW %I RENAME TO %I', old_t || '_v', new_t || '_v');
      END IF;
    END LOOP;
  END LOOP;

  -- the key dictionary
  ALTER TABLE "iot_ts_keys" RENAME TO "telemetry_keys";
  ALTER TABLE "telemetry_keys" RENAME CONSTRAINT "iot_ts_keys_pkey" TO "telemetry_keys_pkey";
  ALTER TABLE "telemetry_keys" RENAME CONSTRAINT "uq_iot_ts_keys_tenant_key" TO "uq_telemetry_keys_tenant_key";
  -- the identity column's sequence keeps its name through a table rename
  IF to_regclass('"iot_ts_keys_keyId_seq"') IS NOT NULL THEN
    ALTER SEQUENCE "iot_ts_keys_keyId_seq" RENAME TO "telemetry_keys_keyId_seq";
  END IF;

  -- the latest values: entityType becomes the kind name
  ALTER TABLE "iot_ts_latest" RENAME TO "telemetry_latest";
  ALTER TABLE "telemetry_latest" RENAME CONSTRAINT "iot_ts_latest_pkey" TO "telemetry_latest_pkey";
  ALTER TABLE "telemetry_latest" RENAME CONSTRAINT "ck_iot_ts_latest_one_value" TO "ck_telemetry_latest_one_value";
  ALTER TABLE "telemetry_latest" DROP CONSTRAINT IF EXISTS "ck_iot_ts_latest_entity_type";
  ALTER TABLE "telemetry_latest" ALTER COLUMN "entityType" TYPE varchar(64);
  ALTER TABLE "telemetry_latest" ALTER COLUMN "entityType" DROP DEFAULT;
  UPDATE "telemetry_latest" SET "entityType" = 'iot_device' WHERE "entityType" = 'DEVICE';
  IF to_regclass('"idx_iot_ts_latest_tenant_key"') IS NOT NULL THEN
    ALTER INDEX "idx_iot_ts_latest_tenant_key" RENAME TO "idx_telemetry_latest_tenant_key";
  END IF;

  -- the class bindings: per tenant AND kind
  ALTER TABLE "iot_ts_tenant_classes" RENAME TO "telemetry_class_bindings";
  ALTER TABLE "telemetry_class_bindings" ADD COLUMN IF NOT EXISTS "entityType" varchar(64) NOT NULL DEFAULT 'iot_device';
  ALTER TABLE "telemetry_class_bindings" ALTER COLUMN "entityType" DROP DEFAULT;
  ALTER TABLE "telemetry_class_bindings" DROP CONSTRAINT IF EXISTS "iot_ts_tenant_classes_pkey";
  ALTER TABLE "telemetry_class_bindings" ADD CONSTRAINT "telemetry_class_bindings_pkey" PRIMARY KEY ("tenantId", "entityType", "validFrom");
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_iot_ts_tenant_classes_days' AND conrelid = to_regclass(quote_ident(current_schema()) || '.telemetry_class_bindings')) THEN
    ALTER TABLE "telemetry_class_bindings" RENAME CONSTRAINT "ck_iot_ts_tenant_classes_days" TO "ck_telemetry_class_bindings_days";
  END IF;
  DROP INDEX IF EXISTS "uq_iot_ts_tenant_class_current";

  -- the minute job's state and hints
  ALTER TABLE "iot_ts_1m_state" RENAME TO "telemetry_1m_state";
  ALTER TABLE "telemetry_1m_state" RENAME CONSTRAINT "iot_ts_1m_state_pkey" TO "telemetry_1m_state_pkey";
  ALTER TABLE "iot_ts_1m_dirty" RENAME TO "telemetry_1m_dirty";
  ALTER TABLE "telemetry_1m_dirty" RENAME CONSTRAINT "iot_ts_1m_dirty_pkey" TO "telemetry_1m_dirty_pkey";
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_iot_ts_1m_dirty_range' AND conrelid = to_regclass(quote_ident(current_schema()) || '.telemetry_1m_dirty')) THEN
    ALTER TABLE "telemetry_1m_dirty" RENAME CONSTRAINT "ck_iot_ts_1m_dirty_range" TO "ck_telemetry_1m_dirty_range";
  END IF;
  IF to_regclass('"idx_iot_ts_1m_dirty_tenant_class"') IS NOT NULL THEN
    ALTER INDEX "idx_iot_ts_1m_dirty_tenant_class" RENAME TO "idx_telemetry_1m_dirty_tenant_class";
  END IF;

  -- db's rollup bookkeeping, keyed by the rollup table name ('iot_ts_' is seven characters)
  IF to_regclass('"time_series_rollup_state"') IS NOT NULL THEN
    UPDATE "time_series_rollup_state" SET "rollup" = 'telemetry_' || substring("rollup" FROM 8) WHERE "rollup" LIKE 'iot\_ts\_%';
  END IF;
  IF to_regclass('"time_series_rollup_dirty"') IS NOT NULL THEN
    UPDATE "time_series_rollup_dirty" SET "rollup" = 'telemetry_' || substring("rollup" FROM 8) WHERE "rollup" LIKE 'iot\_ts\_%';
  END IF;
END $$;

-- ── B. a fresh database (every statement is a no-op after A) ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "telemetry_msg_r7" (
  "tenantId"  uuid               NOT NULL,
  "entityId"  uuid               NOT NULL,
  "ts"        timestamptz        NOT NULL,
  "msgHash"   bigint             NOT NULL,
  "numKeyIds" integer[]          NOT NULL DEFAULT '{}',
  "numVals"   double precision[] NOT NULL DEFAULT '{}',
  "other"     jsonb,
  CONSTRAINT "telemetry_msg_r7_pkey" PRIMARY KEY ("tenantId", "entityId", "ts", "msgHash"),
  CONSTRAINT "ck_telemetry_msg_r7_arrays" CHECK (cardinality("numKeyIds") = cardinality("numVals"))
);

CREATE TABLE IF NOT EXISTS "telemetry_1m_r7" (
  "tenantId" uuid             NOT NULL,
  "entityId" uuid             NOT NULL,
  "keyId"    integer          NOT NULL,
  "ts"       timestamptz      NOT NULL,
  "sum"      double precision NOT NULL,
  "count"    bigint           NOT NULL,
  "min"      double precision NOT NULL,
  "max"      double precision NOT NULL,
  "last"     double precision NOT NULL,
  CONSTRAINT "telemetry_1m_r7_pkey" PRIMARY KEY ("tenantId", "entityId", "keyId", "ts")
);

CREATE TABLE IF NOT EXISTS "telemetry_msg_r30" (
  "tenantId"  uuid               NOT NULL,
  "entityId"  uuid               NOT NULL,
  "ts"        timestamptz        NOT NULL,
  "msgHash"   bigint             NOT NULL,
  "numKeyIds" integer[]          NOT NULL DEFAULT '{}',
  "numVals"   double precision[] NOT NULL DEFAULT '{}',
  "other"     jsonb,
  CONSTRAINT "telemetry_msg_r30_pkey" PRIMARY KEY ("tenantId", "entityId", "ts", "msgHash"),
  CONSTRAINT "ck_telemetry_msg_r30_arrays" CHECK (cardinality("numKeyIds") = cardinality("numVals"))
);

CREATE TABLE IF NOT EXISTS "telemetry_1m_r30" (
  "tenantId" uuid             NOT NULL,
  "entityId" uuid             NOT NULL,
  "keyId"    integer          NOT NULL,
  "ts"       timestamptz      NOT NULL,
  "sum"      double precision NOT NULL,
  "count"    bigint           NOT NULL,
  "min"      double precision NOT NULL,
  "max"      double precision NOT NULL,
  "last"     double precision NOT NULL,
  CONSTRAINT "telemetry_1m_r30_pkey" PRIMARY KEY ("tenantId", "entityId", "keyId", "ts")
);

CREATE TABLE IF NOT EXISTS "telemetry_msg_r90" (
  "tenantId"  uuid               NOT NULL,
  "entityId"  uuid               NOT NULL,
  "ts"        timestamptz        NOT NULL,
  "msgHash"   bigint             NOT NULL,
  "numKeyIds" integer[]          NOT NULL DEFAULT '{}',
  "numVals"   double precision[] NOT NULL DEFAULT '{}',
  "other"     jsonb,
  CONSTRAINT "telemetry_msg_r90_pkey" PRIMARY KEY ("tenantId", "entityId", "ts", "msgHash"),
  CONSTRAINT "ck_telemetry_msg_r90_arrays" CHECK (cardinality("numKeyIds") = cardinality("numVals"))
);

CREATE TABLE IF NOT EXISTS "telemetry_1m_r90" (
  "tenantId" uuid             NOT NULL,
  "entityId" uuid             NOT NULL,
  "keyId"    integer          NOT NULL,
  "ts"       timestamptz      NOT NULL,
  "sum"      double precision NOT NULL,
  "count"    bigint           NOT NULL,
  "min"      double precision NOT NULL,
  "max"      double precision NOT NULL,
  "last"     double precision NOT NULL,
  CONSTRAINT "telemetry_1m_r90_pkey" PRIMARY KEY ("tenantId", "entityId", "keyId", "ts")
);

CREATE TABLE IF NOT EXISTS "telemetry_msg_r365" (
  "tenantId"  uuid               NOT NULL,
  "entityId"  uuid               NOT NULL,
  "ts"        timestamptz        NOT NULL,
  "msgHash"   bigint             NOT NULL,
  "numKeyIds" integer[]          NOT NULL DEFAULT '{}',
  "numVals"   double precision[] NOT NULL DEFAULT '{}',
  "other"     jsonb,
  CONSTRAINT "telemetry_msg_r365_pkey" PRIMARY KEY ("tenantId", "entityId", "ts", "msgHash"),
  CONSTRAINT "ck_telemetry_msg_r365_arrays" CHECK (cardinality("numKeyIds") = cardinality("numVals"))
);

CREATE TABLE IF NOT EXISTS "telemetry_1m_r365" (
  "tenantId" uuid             NOT NULL,
  "entityId" uuid             NOT NULL,
  "keyId"    integer          NOT NULL,
  "ts"       timestamptz      NOT NULL,
  "sum"      double precision NOT NULL,
  "count"    bigint           NOT NULL,
  "min"      double precision NOT NULL,
  "max"      double precision NOT NULL,
  "last"     double precision NOT NULL,
  CONSTRAINT "telemetry_1m_r365_pkey" PRIMARY KEY ("tenantId", "entityId", "keyId", "ts")
);

CREATE TABLE IF NOT EXISTS "telemetry_msg_r1095" (
  "tenantId"  uuid               NOT NULL,
  "entityId"  uuid               NOT NULL,
  "ts"        timestamptz        NOT NULL,
  "msgHash"   bigint             NOT NULL,
  "numKeyIds" integer[]          NOT NULL DEFAULT '{}',
  "numVals"   double precision[] NOT NULL DEFAULT '{}',
  "other"     jsonb,
  CONSTRAINT "telemetry_msg_r1095_pkey" PRIMARY KEY ("tenantId", "entityId", "ts", "msgHash"),
  CONSTRAINT "ck_telemetry_msg_r1095_arrays" CHECK (cardinality("numKeyIds") = cardinality("numVals"))
);

CREATE TABLE IF NOT EXISTS "telemetry_1m_r1095" (
  "tenantId" uuid             NOT NULL,
  "entityId" uuid             NOT NULL,
  "keyId"    integer          NOT NULL,
  "ts"       timestamptz      NOT NULL,
  "sum"      double precision NOT NULL,
  "count"    bigint           NOT NULL,
  "min"      double precision NOT NULL,
  "max"      double precision NOT NULL,
  "last"     double precision NOT NULL,
  CONSTRAINT "telemetry_1m_r1095_pkey" PRIMARY KEY ("tenantId", "entityId", "keyId", "ts")
);

CREATE TABLE IF NOT EXISTS "telemetry_keys" (
  "keyId"       integer GENERATED ALWAYS AS IDENTITY,
  "tenantId"    uuid         NOT NULL,
  "key"         varchar(255) NOT NULL,
  "firstSeenAt" timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT "telemetry_keys_pkey" PRIMARY KEY ("keyId"),
  CONSTRAINT "uq_telemetry_keys_tenant_key" UNIQUE ("tenantId", "key")
);

CREATE TABLE IF NOT EXISTS "telemetry_latest" (
  "tenantId"   uuid             NOT NULL,
  "entityType" varchar(64)      NOT NULL,
  "entityId"   uuid             NOT NULL,
  "keyId"      integer          NOT NULL,
  "ts"         timestamptz      NOT NULL,
  "numVal"     double precision,
  "other"      jsonb,
  "updatedAt"  timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT "telemetry_latest_pkey" PRIMARY KEY ("tenantId", "entityId", "keyId"),
  CONSTRAINT "ck_telemetry_latest_one_value" CHECK (num_nonnulls("numVal", "other") = 1)
);
CREATE INDEX IF NOT EXISTS "idx_telemetry_latest_tenant_key" ON "telemetry_latest" ("tenantId", "keyId");

CREATE TABLE IF NOT EXISTS "telemetry_class_bindings" (
  "tenantId"   uuid        NOT NULL,
  "entityType" varchar(64) NOT NULL,
  "classDays"  integer     NOT NULL,
  "validFrom"  timestamptz NOT NULL DEFAULT now(),
  "validTo"    timestamptz,
  CONSTRAINT "telemetry_class_bindings_pkey" PRIMARY KEY ("tenantId", "entityType", "validFrom"),
  CONSTRAINT "ck_telemetry_class_bindings_days" CHECK ("classDays" IN (7, 30, 90, 365, 1095))
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_telemetry_class_binding_current" ON "telemetry_class_bindings" ("tenantId", "entityType") WHERE "validTo" IS NULL;

CREATE TABLE IF NOT EXISTS "telemetry_1m_state" (
  "tenantId"  uuid        NOT NULL,
  "classDays" integer     NOT NULL,
  "watermark" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "telemetry_1m_state_pkey" PRIMARY KEY ("tenantId", "classDays")
);

CREATE TABLE IF NOT EXISTS "telemetry_1m_dirty" (
  "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"  uuid        NOT NULL,
  "classDays" integer     NOT NULL,
  "dirtyFrom" timestamptz NOT NULL,
  "dirtyTo"   timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "telemetry_1m_dirty_pkey" PRIMARY KEY ("tenantId", "id"),
  CONSTRAINT "ck_telemetry_1m_dirty_range" CHECK ("dirtyFrom" < "dirtyTo")
);
CREATE INDEX IF NOT EXISTS "idx_telemetry_1m_dirty_tenant_class" ON "telemetry_1m_dirty" ("tenantId", "classDays", "dirtyFrom");

-- ── RLS: the policy pair of db.rls-policy.ts (tenantPolicyStatements), then FORCE; both paths ─────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'telemetry_msg_r7', 'telemetry_msg_r30', 'telemetry_msg_r90', 'telemetry_msg_r365', 'telemetry_msg_r1095',
    'telemetry_1m_r7', 'telemetry_1m_r30', 'telemetry_1m_r90', 'telemetry_1m_r365', 'telemetry_1m_r1095',
    'telemetry_keys', 'telemetry_latest', 'telemetry_class_bindings', 'telemetry_1m_state', 'telemetry_1m_dirty'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_self ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_admin_bypass ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId" = (SELECT app_current_tenant())) WITH CHECK ("tenantId" = (SELECT app_current_tenant()))', t);
    EXECUTE format('CREATE POLICY tenant_admin_bypass ON %I TO app_admin USING ((SELECT app_rls_bypass())) WITH CHECK ((SELECT app_rls_bypass()))', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
