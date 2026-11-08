-- kind: expand; reversible: true
-- supersedes: 6638df71a5c71b187f7b05af91d80de1e73e9cfbfc4c86fca9faf3ef0804f045,c267830291f229e894813d88b04db6f6a348ece783c8ba21e5c37086aa7a8ce6,e2e6670cfe5497b89b8dee447b41d385f5cad1c01caa02c615ff384b3556ee15,e4340114d3524458a9f085f482ba8e2954e95f04e69fd387d123a4ed9f5576d7
-- notification_log 002: the index of the ledger retention sweep (P7-SWEEPERS, docs/phases/02-fleet roadmap Phase 7 "indexes for sweepers").
--
-- `notification-log-retention` runs daily per tenant: anonymise rows older than 90 days, delete rows older than two years
-- (`pruneAndAnonymize`), both `WHERE "tenantId" = $1 AND "sentAt" < $2`. The baseline indexes tenantId alone, so every run read the tenant's
-- whole ledger; this composite answers the range directly.
--
-- Purely additive. The entity declares the same index by name, so a synchronize-mode deploy builds the same shape. No CONCURRENTLY: the deploy
-- runner wraps each migration in a transaction. RLS is unchanged. Guarded on to_regclass. Idempotent.
--
-- Down (exact reverse):
--   DROP INDEX IF EXISTS "idx_notification_logs_tenant_sent";

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.notification_logs') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "idx_notification_logs_tenant_sent" ON "notification_logs" ("tenantId", "sentAt");
  END IF;
END $$;
