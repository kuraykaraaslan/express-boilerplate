-- tenant_usage 001: open period metrics (phases/feature_gate/02).
--
-- The table `tenant_usage_metrics` itself (and its unique key on
-- (tenantId, period, metric)) is created by db:deploy's schema-sync phase from
-- `entities/tenant_usage_metric.entity.ts`; RLS comes from the generated
-- coverage migration (`npm run gen:rls-policies`). This file adds what decorators
-- cannot express: the lookup index for platform-wide period reads, and a one-shot
-- backfill of the six legacy metrics for the CURRENT month from the legacy
-- `tenant_usage` columns, so `getMetricUsage` reads the same number from either
-- store the moment it ships.
--
-- Idempotent: the index is IF NOT EXISTS and the backfill is ON CONFLICT DO NOTHING
-- (a row the flush job already wrote wins). Guarded on both tables existing, so a
-- deployment that has not synced the new entity yet skips it.
-- supersedes: 0b4b8997d0e88d6c0d227b72a6b522653cdcf4824d714c284ac526b9cc55b1f0,1cd017190bf52acabeda2fcb26c1090c294330b17782bdbfd84e42e151a82c74,879e8132e4017f7a386af44d73fed6ee8068f689d15b359d0479810b4d0d6246,f5ca697d559b71f26dcafadeceb7463d76af6ff7fb6163ff8749a95d0f2b2ebd

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenant_usage_metrics') IS NOT NULL
     AND to_regclass(quote_ident(current_schema()) || '.tenant_usage') IS NOT NULL THEN

    CREATE INDEX IF NOT EXISTS "idx_tenant_usage_metrics_metric_period"
      ON "tenant_usage_metrics" ("metric", "period");

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
    WHERE u."month" = to_char(now(), 'YYYY-MM')
    ON CONFLICT ("tenantId", "period", "metric") DO NOTHING;
  END IF;
END $$;
