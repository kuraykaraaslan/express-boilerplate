-- kind: expand; reversible: true
-- tenant 135: "tenants"."countryCode" and "tenants"."countrySource", the tenant's country (docs/phases/49-country-pricing, stage 49.1).
--
-- The price lists and payment options of phase 49 are looked up by the tenant's country (then its bloc, then '*'). The country is set silently at
-- sign-up (the request's geo-IP, else the browser language's region, else TR) and changed only by the platform operator; "region" (the six-way bloc, a
-- locale and presentation hint) stays and is derived from it. Data residency ("homeRegionId", "residencyRequirement") is a separate question and is
-- not touched.
--
--   "countryCode"    ISO 3166-1 alpha-2, upper case. NULL on a tenant from before this release: its pricing then starts from "region", as it did.
--   "countrySource"  operator | geoip | locale | default. NULL exactly when the country is NULL (the CHECK says so).
--
-- Purely additive: nullable columns without a default and a CHECK every existing row passes (both columns NULL), so the previous release still reads and
-- writes "tenants". No backfill: guessing a country for an existing tenant from its region would price it silently; the operator sets it. Type, name and
-- CHECK are the entity's. Idempotent, and a no-op while the table does not exist yet.
--
-- Rollback: the previous release neither reads nor writes the columns. To remove them (only after nothing reads them):
--   ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "ck_tenants_country";
--   ALTER TABLE "tenants" DROP COLUMN IF EXISTS "countrySource", DROP COLUMN IF EXISTS "countryCode";

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenants') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "countryCode" character varying(2);
  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "countrySource" character varying(16);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenants_country' AND conrelid = '"tenants"'::regclass) THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "ck_tenants_country"
      CHECK (("countryCode" IS NULL AND "countrySource" IS NULL) OR ("countryCode" IS NOT NULL AND "countryCode" ~ '^[A-Z]{2}$' AND "countrySource" IS NOT NULL AND "countrySource" IN ('operator', 'geoip', 'locale', 'default')));
  END IF;
END $$;
