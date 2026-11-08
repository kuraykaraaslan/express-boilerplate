-- kind: expand; reversible: true
-- auth 002: auth owns its setting keys (MS-44, 2026-10-27). The generic settings API now writes auth's keys (password,
-- lockout, session, MFA, registration and SSO policy) only for a caller who also holds "auth.settings.update", as every other
-- owner's keys (tenant_setting.key-owners.ts); reading them needs "auth.settings.read", which auth 001 already granted.
--
-- Every stored role that held "tenant_setting.config.update" gets "auth.settings.update" beside it, so nobody who could change
-- these settings today (Settings → Authentication & SSO, Authentication Settings) loses it (the rule of auth 001 and
-- notification_mail 001, docs/audits/2026-10-27-settings-guard.md SG-13). A role that never held the generic update id gets
-- nothing. An installation's config/access.ts grant of tenant_setting.config.update below ADMIN needs the new id by hand.
--
-- Additive (an expand step), idempotent (a role already holding the id is skipped) and a no-op while the table does not exist.
-- It is reversible: the previous release does not know the id and ignores it. The cached role sets pick the change up when they expire.

-- The updates run across tenants: they opt into the RLS bypass for this file's own transaction (db.deploy wraps each file in one).
SELECT set_config('app.bypass_rls', 'on', true);

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenant_roles') IS NULL THEN
    RETURN;
  END IF;

  UPDATE "tenant_roles" SET "permissions" = "permissions" || '["auth.settings.update"]'::jsonb, "updatedAt" = now()
   WHERE jsonb_typeof("permissions") = 'array' AND "permissions" ? 'tenant_setting.config.update' AND NOT "permissions" ? 'auth.settings.update';
END $$;
