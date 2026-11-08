-- kind: expand; reversible: true
-- db 005a: the two RLS helper functions, made available before db 006 needs them (integration lane 1, docs/phases/33-tests/29-open-defects).
--
-- Modules are applied in dependency order and `db` comes before `tenant` (tenant requires db), so on a schema built from nothing
-- `db:006_payment_transactions_rls.sql` ran before `tenant:001_tenant_rls.sql` had created `app_current_tenant()` / `app_rls_bypass()`
-- and failed with "function app_current_tenant() does not exist". This file sorts before 006 (`005_` < `005a` < `006_`) and creates both
-- functions with exactly the bodies of tenant 001, which later replaces them with identical ones, and tenant 127 then hardens them.
--
-- Created ONLY when missing: on a database that already ran tenant 001 and 127 (the demo, every existing install) a CREATE OR REPLACE here
-- would put the older 001 bodies back over the hardened 127 ones, and neither tenant file runs again to restore them. Idempotent.
-- DOWN: none needed (tenant 001 owns the functions from then on).

DO $rls$
BEGIN
  IF to_regprocedure('app_current_tenant()') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION app_current_tenant() RETURNS UUID AS $$
      DECLARE
        v TEXT;
      BEGIN
        v := current_setting('app.current_tenant', true);
        IF v IS NULL OR v = '' THEN
          RETURN NULL;
        END IF;
        RETURN v::uuid;
      EXCEPTION WHEN others THEN
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql STABLE
    $f$;
  END IF;

  IF to_regprocedure('app_rls_bypass()') IS NULL THEN
    EXECUTE $f$
      CREATE FUNCTION app_rls_bypass() RETURNS BOOLEAN AS $$
      BEGIN
        RETURN COALESCE(current_setting('app.bypass_rls', true), 'off') = 'on';
      END;
      $$ LANGUAGE plpgsql STABLE
    $f$;
  END IF;
END $rls$;
