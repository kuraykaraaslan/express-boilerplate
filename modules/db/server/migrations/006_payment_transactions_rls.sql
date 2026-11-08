-- kind: expand; reversible: true
-- supersedes: 4b9b1af2c206cadfe5f67d84e79d6fbf6c79bcdb7f651e59c280fa24ace52713,75bcf185e72b6ac487f041d1dbf37ec70445f5621c5839c432dbcf7ab46e1cbf,7fed16067f8cdeb6d93bed0b66de059a94ac8556ea65fe2f22eb4e1ec9806f39,b190d0323968f59ae2df5e98db33011c1cd6a32f4234b17d35b811e4e4587fc4
-- db 006: tenant RLS on payment_transactions, scoped through its parent payment (payment.24, docs/phases/33-tests/29-open-defects).
--
-- `payment_transactions` has no tenantId column of its own (it hangs off `payments` by "paymentId"), so the generated policy pair of migration 127
-- (`"tenantId" = (SELECT app_current_tenant())`) could not be placed on it, and an unfiltered read inside one tenant's transaction returned every
-- tenant's transactions. The same pair, with the tenant predicate taken from the parent row:
--
--   tenant_isolation     USING / WITH CHECK  EXISTS (the parent payment belongs to the current tenant)   -- everybody
--   tenant_admin_bypass  TO app_admin        (SELECT app_rls_bypass())                                    -- app_admin only
--
-- The parent lookup reads `payments`, which carries its own tenant policy, and compares the tenant explicitly as well, so the child policy does not
-- depend on the parent's RLS being enforced. Same enforcement state as every other tenant table: the policies are installed now and take effect
-- when RLS is enabled on the table (the Faz 4 cutover, migrations/manual/rls-force-enable.sql in the tenant module); ENABLE here makes this one
-- table's policy live for non-owner roles. Idempotent; a no-op while the table does not exist.

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.payment_transactions') IS NULL OR to_regclass(quote_ident(current_schema()) || '.payments') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "payment_transactions" ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON "payment_transactions";
  DROP POLICY IF EXISTS tenant_self ON "payment_transactions";
  DROP POLICY IF EXISTS tenant_admin_bypass ON "payment_transactions";
  CREATE POLICY tenant_isolation ON "payment_transactions"
         USING (EXISTS (SELECT 1 FROM "payments" p WHERE p."paymentId" = "payment_transactions"."paymentId" AND p."tenantId" = (SELECT app_current_tenant())))
         WITH CHECK (EXISTS (SELECT 1 FROM "payments" p WHERE p."paymentId" = "payment_transactions"."paymentId" AND p."tenantId" = (SELECT app_current_tenant())));
  CREATE POLICY tenant_admin_bypass ON "payment_transactions" TO app_admin
         USING ((SELECT app_rls_bypass()))
         WITH CHECK ((SELECT app_rls_bypass()));
END $$;
