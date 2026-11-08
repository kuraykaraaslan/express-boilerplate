-- kind: expand
-- telemetry 003: the `otel` lane's bookkeeping tables (docs/phases/42-telemetry/00 ED-9, 04 §4.2).
--
-- The lane's class tables (telemetry_otel_msg_r{d}, telemetry_otel_1m_r{d}) in the post-002 shape (kindId, no default: a new row must
-- carry its kind); db's time-series deploy turns them into hypertables behind their access views and derives the hour and day rollups
-- from this module's declaration (telemetry.timeseries.ts, TELEMETRY_LANES) — it converts tables that exist, so they are created here as
-- 001 created the default lane's. The three plain tables of a lane are the writer's and the minute job's: the latest value per entity
-- and key, the minute job's watermarks and its dirty-minute hints. Same columns, keys and RLS pair as the default lane's; idempotent.

-- ── the class tables of the lane ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "telemetry_otel_msg_r7" (
  "tenantId"  uuid               NOT NULL,
  "entityId"  uuid               NOT NULL,
  "ts"        timestamptz        NOT NULL,
  "msgHash"   bigint             NOT NULL,
  "kindId"    smallint           NOT NULL,
  "numKeyIds" integer[]          NOT NULL DEFAULT '{}',
  "numVals"   double precision[] NOT NULL DEFAULT '{}',
  "other"     jsonb,
  CONSTRAINT "telemetry_otel_msg_r7_pkey" PRIMARY KEY ("tenantId", "entityId", "ts", "msgHash"),
  CONSTRAINT "ck_telemetry_otel_msg_r7_arrays" CHECK (cardinality("numKeyIds") = cardinality("numVals"))
);

CREATE TABLE IF NOT EXISTS "telemetry_otel_1m_r7" (
  "tenantId" uuid             NOT NULL,
  "entityId" uuid             NOT NULL,
  "keyId"    integer          NOT NULL,
  "ts"       timestamptz      NOT NULL,
  "kindId"   smallint         NOT NULL,
  "sum"      double precision NOT NULL,
  "count"    bigint           NOT NULL,
  "min"      double precision NOT NULL,
  "max"      double precision NOT NULL,
  "last"     double precision NOT NULL,
  CONSTRAINT "telemetry_otel_1m_r7_pkey" PRIMARY KEY ("tenantId", "entityId", "keyId", "ts")
);

CREATE TABLE IF NOT EXISTS "telemetry_otel_msg_r30" (
  "tenantId"  uuid               NOT NULL,
  "entityId"  uuid               NOT NULL,
  "ts"        timestamptz        NOT NULL,
  "msgHash"   bigint             NOT NULL,
  "kindId"    smallint           NOT NULL,
  "numKeyIds" integer[]          NOT NULL DEFAULT '{}',
  "numVals"   double precision[] NOT NULL DEFAULT '{}',
  "other"     jsonb,
  CONSTRAINT "telemetry_otel_msg_r30_pkey" PRIMARY KEY ("tenantId", "entityId", "ts", "msgHash"),
  CONSTRAINT "ck_telemetry_otel_msg_r30_arrays" CHECK (cardinality("numKeyIds") = cardinality("numVals"))
);

CREATE TABLE IF NOT EXISTS "telemetry_otel_1m_r30" (
  "tenantId" uuid             NOT NULL,
  "entityId" uuid             NOT NULL,
  "keyId"    integer          NOT NULL,
  "ts"       timestamptz      NOT NULL,
  "kindId"   smallint         NOT NULL,
  "sum"      double precision NOT NULL,
  "count"    bigint           NOT NULL,
  "min"      double precision NOT NULL,
  "max"      double precision NOT NULL,
  "last"     double precision NOT NULL,
  CONSTRAINT "telemetry_otel_1m_r30_pkey" PRIMARY KEY ("tenantId", "entityId", "keyId", "ts")
);

CREATE TABLE IF NOT EXISTS "telemetry_otel_msg_r90" (
  "tenantId"  uuid               NOT NULL,
  "entityId"  uuid               NOT NULL,
  "ts"        timestamptz        NOT NULL,
  "msgHash"   bigint             NOT NULL,
  "kindId"    smallint           NOT NULL,
  "numKeyIds" integer[]          NOT NULL DEFAULT '{}',
  "numVals"   double precision[] NOT NULL DEFAULT '{}',
  "other"     jsonb,
  CONSTRAINT "telemetry_otel_msg_r90_pkey" PRIMARY KEY ("tenantId", "entityId", "ts", "msgHash"),
  CONSTRAINT "ck_telemetry_otel_msg_r90_arrays" CHECK (cardinality("numKeyIds") = cardinality("numVals"))
);

CREATE TABLE IF NOT EXISTS "telemetry_otel_1m_r90" (
  "tenantId" uuid             NOT NULL,
  "entityId" uuid             NOT NULL,
  "keyId"    integer          NOT NULL,
  "ts"       timestamptz      NOT NULL,
  "kindId"   smallint         NOT NULL,
  "sum"      double precision NOT NULL,
  "count"    bigint           NOT NULL,
  "min"      double precision NOT NULL,
  "max"      double precision NOT NULL,
  "last"     double precision NOT NULL,
  CONSTRAINT "telemetry_otel_1m_r90_pkey" PRIMARY KEY ("tenantId", "entityId", "keyId", "ts")
);

CREATE TABLE IF NOT EXISTS "telemetry_otel_msg_r365" (
  "tenantId"  uuid               NOT NULL,
  "entityId"  uuid               NOT NULL,
  "ts"        timestamptz        NOT NULL,
  "msgHash"   bigint             NOT NULL,
  "kindId"    smallint           NOT NULL,
  "numKeyIds" integer[]          NOT NULL DEFAULT '{}',
  "numVals"   double precision[] NOT NULL DEFAULT '{}',
  "other"     jsonb,
  CONSTRAINT "telemetry_otel_msg_r365_pkey" PRIMARY KEY ("tenantId", "entityId", "ts", "msgHash"),
  CONSTRAINT "ck_telemetry_otel_msg_r365_arrays" CHECK (cardinality("numKeyIds") = cardinality("numVals"))
);

CREATE TABLE IF NOT EXISTS "telemetry_otel_1m_r365" (
  "tenantId" uuid             NOT NULL,
  "entityId" uuid             NOT NULL,
  "keyId"    integer          NOT NULL,
  "ts"       timestamptz      NOT NULL,
  "kindId"   smallint         NOT NULL,
  "sum"      double precision NOT NULL,
  "count"    bigint           NOT NULL,
  "min"      double precision NOT NULL,
  "max"      double precision NOT NULL,
  "last"     double precision NOT NULL,
  CONSTRAINT "telemetry_otel_1m_r365_pkey" PRIMARY KEY ("tenantId", "entityId", "keyId", "ts")
);

CREATE TABLE IF NOT EXISTS "telemetry_otel_msg_r1095" (
  "tenantId"  uuid               NOT NULL,
  "entityId"  uuid               NOT NULL,
  "ts"        timestamptz        NOT NULL,
  "msgHash"   bigint             NOT NULL,
  "kindId"    smallint           NOT NULL,
  "numKeyIds" integer[]          NOT NULL DEFAULT '{}',
  "numVals"   double precision[] NOT NULL DEFAULT '{}',
  "other"     jsonb,
  CONSTRAINT "telemetry_otel_msg_r1095_pkey" PRIMARY KEY ("tenantId", "entityId", "ts", "msgHash"),
  CONSTRAINT "ck_telemetry_otel_msg_r1095_arrays" CHECK (cardinality("numKeyIds") = cardinality("numVals"))
);

CREATE TABLE IF NOT EXISTS "telemetry_otel_1m_r1095" (
  "tenantId" uuid             NOT NULL,
  "entityId" uuid             NOT NULL,
  "keyId"    integer          NOT NULL,
  "ts"       timestamptz      NOT NULL,
  "kindId"   smallint         NOT NULL,
  "sum"      double precision NOT NULL,
  "count"    bigint           NOT NULL,
  "min"      double precision NOT NULL,
  "max"      double precision NOT NULL,
  "last"     double precision NOT NULL,
  CONSTRAINT "telemetry_otel_1m_r1095_pkey" PRIMARY KEY ("tenantId", "entityId", "keyId", "ts")
);

-- ── the lane's bookkeeping ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "telemetry_otel_latest" (
  "tenantId"   uuid             NOT NULL,
  "entityId"   uuid             NOT NULL,
  "keyId"      integer          NOT NULL,
  "kindId"     smallint         NOT NULL,
  "ts"         timestamptz      NOT NULL,
  "numVal"     double precision,
  "other"      jsonb,
  "updatedAt"  timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT "telemetry_otel_latest_pkey" PRIMARY KEY ("tenantId", "entityId", "keyId"),
  CONSTRAINT "ck_telemetry_otel_latest_one_value" CHECK (num_nonnulls("numVal", "other") = 1)
);
CREATE INDEX IF NOT EXISTS "idx_telemetry_otel_latest_tenant_key" ON "telemetry_otel_latest" ("tenantId", "keyId");

CREATE TABLE IF NOT EXISTS "telemetry_otel_1m_state" (
  "tenantId"  uuid        NOT NULL,
  "classDays" integer     NOT NULL,
  "watermark" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "telemetry_otel_1m_state_pkey" PRIMARY KEY ("tenantId", "classDays")
);

CREATE TABLE IF NOT EXISTS "telemetry_otel_1m_dirty" (
  "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
  "tenantId"  uuid        NOT NULL,
  "classDays" integer     NOT NULL,
  "dirtyFrom" timestamptz NOT NULL,
  "dirtyTo"   timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "telemetry_otel_1m_dirty_pkey" PRIMARY KEY ("tenantId", "id"),
  CONSTRAINT "ck_telemetry_otel_1m_dirty_range" CHECK ("dirtyFrom" < "dirtyTo")
);
CREATE INDEX IF NOT EXISTS "idx_telemetry_otel_1m_dirty_tenant_class" ON "telemetry_otel_1m_dirty" ("tenantId", "classDays", "dirtyFrom");

-- ── RLS: the policy pair of db.rls-policy.ts (tenantPolicyStatements), then FORCE ─────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'telemetry_otel_msg_r7', 'telemetry_otel_msg_r30', 'telemetry_otel_msg_r90', 'telemetry_otel_msg_r365', 'telemetry_otel_msg_r1095',
    'telemetry_otel_1m_r7', 'telemetry_otel_1m_r30', 'telemetry_otel_1m_r90', 'telemetry_otel_1m_r365', 'telemetry_otel_1m_r1095',
    'telemetry_otel_latest', 'telemetry_otel_1m_state', 'telemetry_otel_1m_dirty'
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
