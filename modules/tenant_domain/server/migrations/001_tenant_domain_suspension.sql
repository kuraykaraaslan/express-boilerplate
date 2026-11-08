-- kind: expand; reversible: true
-- supersedes: 1639c2ecbaeddf64ad969521f8e0963eb46e5e4355462b33c5a54ef874f750cd,5d8c8f674f2e8331ca964fbf5b5717cfba5db5c1024456d84530806860e5c3a5,64d6d8a0890af2c4b63ecdfa2ade0886163dc31f594d00bbf7c75709d5d6fcf2,9b884484c97968579d57b4e9960484e727516e78a610ce2ae12154a34de984a9
-- tenant_domain 001: plan suspension of custom domains (modules/tenant_domain/README.md, "2026-10-17: every tenant keeps a
-- free subdomain; custom domains follow the plan").
--
-- A custom domain the plan no longer includes (custom_domain switched off, or more domains than max_domains) is set to
-- domainStatus 'SUSPENDED' by tenant_domain.reconcile instead of being deleted. "suspendedAt" records when, and
-- "statusBeforeSuspension" the status to restore when the plan includes the domain again. domainStatus is a varchar, so
-- the new value needs no type change.
--
-- Purely additive: both columns are nullable, so the previous release (which does not know them) keeps reading and
-- writing "tenant_domains" unchanged, and a rollback leaves columns it ignores. TypeORM synchronize builds the same
-- columns on single-role databases; this file does it for databases that run in migrate mode. Idempotent, and a no-op
-- while the table does not exist yet.

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenant_domains') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "tenant_domains" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP;
  ALTER TABLE "tenant_domains" ADD COLUMN IF NOT EXISTS "statusBeforeSuspension" character varying;
END $$;
