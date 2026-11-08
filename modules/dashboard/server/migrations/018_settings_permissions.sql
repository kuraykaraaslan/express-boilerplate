-- kind: expand; reversible: true
-- dashboard 018: the settings guard (SG-04, 2026-10-27). Dashboard Settings (/admin/dashboards/settings, the sites a card may
-- frame) was guarded by "tenant_setting.config.update" alone; it now also needs "dashboard.settings.read", and the generic settings
-- API writes dashboardEmbedHosts only with "dashboard.settings.update" too (tenant_setting.key-owners.ts). The page opened with the
-- update permission, so its holders get both new ids; a holder of the read permission alone could not open it and gets nothing.
--
-- Every stored role that held the generic setting permission the page opened with gets the new id beside it, so nobody who
-- can open the page today loses it (the rule of notification_mail 001, docs/audits/2026-10-27-settings-guard.md SG-13):
--  - a custom group (tenant_roles, not builtin) lifts an ADMIN-floor permission over the floor only when it lists it
--    (auth_abac.guard.group-floor.next.ts), so its USER members would lose the page without the new id;
--  - a stored builtin role is given it too: once any role of the tenant lists an id, a role without it is an explicit
--    removal (tenant_role.service hasPermission), so granting it to a group alone would close the page for every ADMIN.
-- A role that never held the generic permission gets nothing. An installation's config/access.ts is not data: a grant there of
-- tenant_setting.config.* to a role below ADMIN needs the new ids added by hand (docs/guides/install-config.md).
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

  UPDATE "tenant_roles" SET "permissions" = "permissions" || '["dashboard.settings.read"]'::jsonb, "updatedAt" = now()
   WHERE jsonb_typeof("permissions") = 'array' AND "permissions" ? 'tenant_setting.config.update' AND NOT "permissions" ? 'dashboard.settings.read';

  UPDATE "tenant_roles" SET "permissions" = "permissions" || '["dashboard.settings.update"]'::jsonb, "updatedAt" = now()
   WHERE jsonb_typeof("permissions") = 'array' AND "permissions" ? 'tenant_setting.config.update' AND NOT "permissions" ? 'dashboard.settings.update';
END $$;
