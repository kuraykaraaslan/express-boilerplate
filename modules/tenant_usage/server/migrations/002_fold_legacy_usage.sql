-- tenant_usage 002: fold the wide monthly table into the open metrics table (docs/phases/42-telemetry/06 step 5).
--
-- `tenant_usage` kept one column per legacy metric (apiCalls, aiTokens, storageBytes, emailSends, smsSends, webhookCalls) per month;
-- `tenant_usage_metrics` holds every declared metric as (tenant, period, metric) -> value, and the flush job wrote both for one release.
-- From this release the flush writes the open table only and every reader (`getUsage` fallback, `getHistory`, the export collection)
-- reads it. This copies EVERY month of the six legacy columns across (001 copied the current month), so no history is lost; a row the
-- flush already wrote wins (ON CONFLICT DO NOTHING). The wide table stays for one more release (`getMetricUsage` still falls back to it)
-- and is dropped in the next one.
--
-- Idempotent; guarded on both tables existing.

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenant_usage_metrics') IS NOT NULL
     AND to_regclass(quote_ident(current_schema()) || '.tenant_usage') IS NOT NULL THEN

    INSERT INTO "tenant_usage_metrics" ("tenantId", "period", "metric", "value", "updatedAt")
    SELECT u."tenantId", u."month", m.metric, m.value, now()
    FROM "tenant_usage" u
    CROSS JOIN LATERAL (VALUES
      ('apiCalls',     u."apiCalls"::bigint),
      ('aiTokens',     u."aiTokens"::bigint),
      ('storageBytes', u."storageBytes"::bigint),
      ('emailSends',   u."emailSends"::bigint),
      ('smsSends',     u."smsSends"::bigint),
      ('webhookCalls', u."webhookCalls"::bigint)
    ) AS m(metric, value)
    WHERE m.value <> 0
    ON CONFLICT ("tenantId", "period", "metric") DO NOTHING;
  END IF;
END $$;
