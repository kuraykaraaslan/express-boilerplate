-- kind: expand
-- 100 — observability on the Core telemetry store (docs/phases/42-telemetry/04).
--
-- Two additive changes, safe to run ahead of the code:
--   monitor_check_details.locationKey   where a browser sample was taken: with the sample's own time it names the sample once `monitor_checks`
--                                       and its `checkId` are gone (release N+1, §4.1); null for older rows and the in-process probe.
--   otel_series                          the series catalogue of the OTel metrics adapter (§4.2): one row per metric series a tenant wrote to
--                                       the Core store's `otel` lane (metric, kind, unit, labels, histogram bounds, first and last seen).
--                                       Tenant-scoped like every other row (RLS from the generated 127).
--
-- down: ALTER TABLE "monitor_check_details" DROP COLUMN IF EXISTS "locationKey"; DROP TABLE IF EXISTS "otel_series";
--
-- The CREATE statements are the DDL TypeORM renders for the entities, idempotent; names are TypeORM's own, so `db:schema:drift` stays quiet.

ALTER TABLE "monitor_check_details" ADD COLUMN IF NOT EXISTS "locationKey" character varying(64);
CREATE INDEX IF NOT EXISTS "idx_monitor_check_details_location" ON "monitor_check_details" ("tenantId", "monitorId", "locationKey", "checkedAt");

CREATE TABLE IF NOT EXISTS "otel_series" (
  "tenantId"    uuid NOT NULL,
  "seriesId"    uuid NOT NULL,
  "metric"      character varying(128) NOT NULL,
  "kind"        character varying(16) NOT NULL,
  "unit"        character varying(64),
  "labels"      jsonb NOT NULL,
  "bounds"      jsonb,
  "firstSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "lastSeenAt"  TIMESTAMP WITH TIME ZONE NOT NULL,
  CONSTRAINT "PK_otel_series" PRIMARY KEY ("tenantId", "seriesId")
);
CREATE INDEX IF NOT EXISTS "idx_otel_series_tenant_metric" ON "otel_series" ("tenantId", "metric");
CREATE INDEX IF NOT EXISTS "idx_otel_series_tenant_seen" ON "otel_series" ("tenantId", "lastSeenAt");
