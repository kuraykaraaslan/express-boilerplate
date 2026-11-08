-- kind: expand; reversible: true
-- db 002: tenant_keys, the per-tenant data keys of field-encryption v2 (P7-TDEK; docs/phases/02-fleet/04 section 3 level L3, decision F16).
--
-- One row per tenant data key (TDEK): kid `tdek-<tenantId>-<generation>`, its state (ACTIVE encrypts, RETIRED only decrypts, DESTROYED is gone), the
-- provider that wrapped it, the WRAPPED key (never a raw one) and, under a legal hold, an escrow copy wrapped under the hold slot. Node-local and
-- cross-tenant by design: it lives in the node's control database only, only the key service reads it, in system context; RLS-exempt like
-- tenant_databases (modules/db/scripts/gen-rls-policies.mts gives the reason), excluded from the migration bundle and the tenant export.
--
-- Purely additive: the previous release neither reads nor writes it, and nothing writes it until a module encrypts a declared column under a tenant
-- key. Every CHECK and index is mirrored on the entity (same names), so TypeORM synchronize on single-role deployments builds the same table; this
-- file does it for databases that run in migrate mode, and adds the guard trigger synchronize cannot express. Idempotent.

CREATE TABLE IF NOT EXISTS "tenant_keys" (
  "kid" character varying(80) NOT NULL,
  "tenantId" uuid NOT NULL,
  "generation" integer NOT NULL,
  "state" character varying(16) NOT NULL DEFAULT 'ACTIVE',
  "provider" character varying(16) NOT NULL,
  "wrappedDek" text,
  "escrowWrappedDek" text,
  "escrowUntil" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "retiredAt" TIMESTAMP WITH TIME ZONE,
  "destroyedAt" TIMESTAMP WITH TIME ZONE,
  "destroyReason" character varying(32),
  CONSTRAINT "ck_tenant_keys_kid" CHECK ("generation" >= 1 AND "kid" = 'tdek-' || "tenantId"::text || '-' || "generation"::text),
  CONSTRAINT "ck_tenant_keys_state" CHECK ("state" IN ('ACTIVE', 'RETIRED', 'DESTROYED') AND ("state" = 'DESTROYED') = ("wrappedDek" IS NULL) AND ("state" = 'DESTROYED') = ("destroyedAt" IS NOT NULL) AND ("destroyedAt" IS NULL) = ("destroyReason" IS NULL) AND ("state" <> 'RETIRED' OR "retiredAt" IS NOT NULL)),
  CONSTRAINT "ck_tenant_keys_provider" CHECK ("provider" IN ('node-key', 'file', 'kms', 'vault')),
  CONSTRAINT "ck_tenant_keys_escrow" CHECK (("escrowWrappedDek" IS NULL) = ("escrowUntil" IS NULL)),
  CONSTRAINT "PK_tenant_keys" PRIMARY KEY ("kid")
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tenant_keys_active" ON "tenant_keys" ("tenantId") WHERE "state" = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tenant_keys_generation" ON "tenant_keys" ("tenantId", "generation");

-- ─── guard ───────────────────────────────────────────────────────────────────
-- What an entity cannot express. The identity of a key (kid, tenant, generation, provider, creation) never changes, a key never moves back to ACTIVE
-- once retired, and a destroyed key stays destroyed: no wrapped key can be written into a DESTROYED row again (only its escrow may still be released).

CREATE OR REPLACE FUNCTION tenant_keys_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."kid" IS DISTINCT FROM OLD."kid"
     OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
     OR NEW."generation" IS DISTINCT FROM OLD."generation"
     OR NEW."provider" IS DISTINCT FROM OLD."provider"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'tenant_keys: the identity of a key is never changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."state" <> 'ACTIVE' AND NEW."state" = 'ACTIVE' THEN
    RAISE EXCEPTION 'tenant_keys: a retired or destroyed key is never active again' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."state" = 'DESTROYED'
     AND (NEW."state" <> 'DESTROYED' OR NEW."wrappedDek" IS NOT NULL OR NEW."destroyedAt" IS DISTINCT FROM OLD."destroyedAt"
          OR (NEW."escrowWrappedDek" IS NOT NULL AND NEW."escrowWrappedDek" IS DISTINCT FROM OLD."escrowWrappedDek")) THEN
    RAISE EXCEPTION 'tenant_keys: a destroyed key stays destroyed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_keys_guard ON "tenant_keys";
CREATE TRIGGER tenant_keys_guard BEFORE UPDATE ON "tenant_keys" FOR EACH ROW EXECUTE FUNCTION tenant_keys_guard();
