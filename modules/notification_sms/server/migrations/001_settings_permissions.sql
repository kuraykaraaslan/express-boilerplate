-- kind: expand; reversible: true
-- notification_sms 001: the settings guard (docs/phases/45-install-config, 2026-10-27). Settings → SMS moved from tenant_setting to this
-- module and are now guarded by "notification_sms.settings.read" and "notification_sms.settings.update" beside the generic setting permission; the generic settings API
-- judges this module's keys by the same ids (tenant_setting.key-owners.ts).
--
-- Every stored role that held the generic setting permission gets the new id beside it, so nobody loses a page the move
-- alone took away:
--  - a custom group (tenant_roles, not builtin) lifts an ADMIN-floor permission over the floor only when it lists it
--    (auth_abac.guard.group-floor.next.ts), so its USER members would lose the page without the new id;
--  - a stored builtin role is given it too: once any role of the tenant lists an id, a role without it is an explicit
--    removal (tenant_role.service hasPermission), so granting it to a group alone would close the page for every ADMIN.
-- A role that never held the generic permission gets nothing. A tenant with no stored roles keeps the synthesized
-- built-ins, which the new id postdates and the guard permits. An installation's config/access.ts is not data: a grant
-- there of tenant_setting.config.* to a role below ADMIN needs the new ids added by hand (docs/audits/2026-10-27-settings-guard.md).
--
-- Additive (an expand step, as the deploy plan orders data fixes: iot_device_profile 005), idempotent (a role already holding
-- the id is skipped) and a no-op while the table does not exist. Reversible: the previous
-- release does not know the ids and ignores them. The cached role sets pick the change up when they expire.

-- The updates run across tenants: they opt into the RLS bypass for this file's own transaction (db.deploy wraps each file in one).
SELECT set_config('app.bypass_rls', 'on', true);

DO $$
BEGIN
  IF to_regclass(quote_ident(current_schema()) || '.tenant_roles') IS NULL THEN
    RETURN;
  END IF;

  UPDATE "tenant_roles" SET "permissions" = "permissions" || '["notification_sms.settings.read"]'::jsonb, "updatedAt" = now()
   WHERE jsonb_typeof("permissions") = 'array' AND "permissions" ? 'tenant_setting.config.read' AND NOT "permissions" ? 'notification_sms.settings.read';

  UPDATE "tenant_roles" SET "permissions" = "permissions" || '["notification_sms.settings.update"]'::jsonb, "updatedAt" = now()
   WHERE jsonb_typeof("permissions") = 'array' AND "permissions" ? 'tenant_setting.config.update' AND NOT "permissions" ? 'notification_sms.settings.update';
END $$;
