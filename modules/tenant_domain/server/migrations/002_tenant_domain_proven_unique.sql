-- kind: expand; reversible: false
-- supersedes: 4e966efb10044e0e29ff911f915f15b8c88c161928bf1229cfd3fbac724f5fbb,60b9269abf3843abc2071e93609a66e1ac99953b9724fd43104cabc3e14ab66b,7827d56e132069dd3d05a500385cc0c8e60dcb9ccd446c9b254c7469efb7396a,d057eca4b24a6d1ae084c5284eae1a29b6c28563462e6f9712f3d23815381af1
-- tenant_domain 002: a domain name is unique per tenant, and globally only among PROVEN rows (tenant_domain.02,
-- docs/phases/33-tests/29-open-defects; decided 2026-10-21: "the partial-unique-index migration on the serving path").
--
-- Before: one global UNIQUE on "domain", taken at creation, before any DNS proof: a tenant could register a competitor's real
-- domain and hold it, PENDING and unverified, against its owner. After: any number of tenants may hold an unproven claim; the
-- first to prove DNS takes the name ("verifiedAt" set), and the partial unique index refuses a second proof (a 409 at verify).
-- The host lookup, the TLS ask and create() read the proven row. A platform subdomain (no DNS proof) stays first-come in create().
--
-- Order: the new indexes are built first (the old global UNIQUE guarantees the data already satisfies both), then the old
-- single-column UNIQUE (constraint or index, whatever name TypeORM gave it) is dropped. Idempotent.
--
-- Not reversible as an exact reverse once two tenants hold the same unproven name (the global UNIQUE cannot be rebuilt over
-- them). Down, while no duplicate exists:
--   CREATE UNIQUE INDEX "UQ_tenant_domains_domain_global" ON "tenant_domains" ("domain");
--   DROP INDEX IF EXISTS "UQ_tenant_domains_proven_domain"; DROP INDEX IF EXISTS "UQ_tenant_domains_tenant_domain";

DO $$
DECLARE c record;
BEGIN
  -- a no-op while the table does not exist yet (synchronize builds it with the entity's indexes)
  IF to_regclass(quote_ident(current_schema()) || '.tenant_domains') IS NULL THEN RETURN; END IF;

  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_domains_tenant_domain" ON "tenant_domains" ("tenantId", "domain")';
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_domains_proven_domain" ON "tenant_domains" ("domain") WHERE "verifiedAt" IS NOT NULL';
  EXECUTE 'CREATE INDEX IF NOT EXISTS "IDX_tenant_domains_domain" ON "tenant_domains" ("domain")';

  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.conrelid = 'tenant_domains'::regclass AND con.contype = 'u'
       AND array_length(con.conkey, 1) = 1 AND a.attname = 'domain'
  LOOP
    EXECUTE format('ALTER TABLE "tenant_domains" DROP CONSTRAINT %I', c.conname);
  END LOOP;
  FOR c IN
    SELECT i.relname
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
     WHERE x.indrelid = 'tenant_domains'::regclass AND x.indisunique AND NOT x.indisprimary
       AND x.indnatts = 1 AND x.indpred IS NULL AND a.attname = 'domain'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', c.relname);
  END LOOP;
END $$;
