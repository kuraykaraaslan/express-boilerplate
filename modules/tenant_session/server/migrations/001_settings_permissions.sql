-- kind: expand; reversible: true
-- tenant_session 001: the settings guard (MS-39, 2026-10-27). tenant_session's keys (twoFactorRequired, the IP allow / deny lists,
-- maxConcurrentSessions, sessionTimeout) were writable through the generic settings API with "tenant_setting.config.update" alone; they
-- are now owned by this module (tenant_setting.key-owners.ts) and edited on Settings → Sign-in Policy, guarded by
-- "tenant_session.settings.read" and "tenant_session.settings.update" beside the generic setting permission.
--
-- Every stored role that held the generic setting permission gets the new id beside it, so nobody loses what the move alone
-- took away (the same rule as notification_mail 001):
--  - a custom group (tenant_roles, not builtin) lifts an ADMIN-floor permission over the floor only when it lists it
--    (auth_abac.guard.group-floor.next.ts), so its USER members would lose it without the new id;
--  - a stored builtin role is given it too: once any role of the tenant lists an id, a role without it is an explicit
--    removal (tenant_role.service hasPermission), so granting it to a group alone would close it for every ADMIN.
-- A role that never held the generic permission gets nothing. Four of the keys stay OWNER-only whatever the role holds
-- (tenant_setting.key-policy.ts). An installation's config/access.ts is not data: a grant there of tenant_setting.config.* to a
-- role below ADMIN needs the new ids added by hand (docs/guides/install-config.md).
--
-- Additive (an expand step), idempotent (a role already holding the id is skipped) and a no-op while the table does not exist.
-- It is reversible: the previous release does not know the ids and ignores them. The cached role sets pick the change up when they expire.

-- The updates run across tenants: they opt into the RLS bypass for this file's own transaction (db.deploy wraps each file in one).
SELECT set_config('app.bypass_rls', 'on', true);

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenant_roles') IS NULL THEN
    RETURN;
  END IF;

  UPDATE "tenant_roles" SET "permissions" = "permissions" || '["tenant_session.settings.read"]'::jsonb, "updatedAt" = now()
   WHERE jsonb_typeof("permissions") = 'array' AND "permissions" ? 'tenant_setting.config.read' AND NOT "permissions" ? 'tenant_session.settings.read';

  UPDATE "tenant_roles" SET "permissions" = "permissions" || '["tenant_session.settings.update"]'::jsonb, "updatedAt" = now()
   WHERE jsonb_typeof("permissions") = 'array' AND "permissions" ? 'tenant_setting.config.update' AND NOT "permissions" ? 'tenant_session.settings.update';
END $$;
