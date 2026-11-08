-- webhook 001: one composite index for the per-endpoint delivery log.
--
-- `WebhookMetricsService.listDeliveries` filters by tenant and endpoint and sorts by newest first. With only the
-- single-column indexes the planner picks one of them and then filters and sorts every delivery of that endpoint (or of
-- the whole tenant) before it can return a page. (tenantId, webhookId, createdAt DESC) serves the filter and the sort
-- from one index range.
--
-- The entity declares the same index by name (`idx_webhook_deliveries_tenant_webhook_created`), so a synchronize-mode
-- deploy does not drop it as unknown; synchronize may create it first, in ascending order, and then this file is a
-- no-op, which is fine: Postgres scans a btree backwards for ORDER BY ... DESC. This file is what creates it in migrate
-- mode, where synchronize never runs. The existing single-column indexes stay: other queries still use them.
--
-- No CONCURRENTLY: the deploy runner wraps each migration in a transaction. Guarded on to_regclass so a deployment
-- without the table skips it. Idempotent.
-- supersedes: 04f019eb58c364499493192dd9752ce98cd06111f70415f6dea3cf5df2bd431e,562140d4b034c8ceb276d37c40a16d0110ff9ec1e4315049ce94713a96540683,6d63e824b3aa9eeaae7e1c4e7db854b023115094ffa148193921acb0122ac059,a21d3295dc246dacbcb3cb8107dbdd6c49d2585fa2bac437c658905ae975e4cf

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.webhook_deliveries') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_tenant_webhook_created"
      ON "webhook_deliveries" ("tenantId", "webhookId", "createdAt" DESC);
  END IF;
END $$;
