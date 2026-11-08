import { z } from 'zod';

/**
 * The user_session module's setting keys (2026-10-27).
 *
 * - `geoIpProvider`, `geoIpApiKey`: INSTALLATION settings, read only from the ROOT tenant by the geo-IP lookup
 *   (common/server/user_agent/user_agent.geo.service.ts) that the login-risk check (user_session.login-risk.service.ts)
 *   and the session geo annotation use. One provider for the whole installation, matching the one shared per-IP cache;
 *   a copy in any other tenant is never read. Edited on the ROOT page /admin/settings/geo-ip.
 * - `loginAnomalyResponse`, `loginAnomalyVelocityKmh`: the tenant's login-risk response (`step_up` default, or `deny`) and
 *   the speed that counts as impossible travel (900 km/h default and ceiling), read per tenant by `loginRiskPolicy`
 *   (user_session.login-risk.service.ts). Declared so they are owned (closed by user_session's permissions in the generic
 *   settings API); on no page. MS-35: neither can weaken the check any more: a stored `alert_only` reads as `step_up`
 *   and a speed above 900 reads as 900.
 */
export const UserSessionSettingKeySchema = z.enum([
  'geoIpProvider',
  'geoIpApiKey',
  'loginAnomalyResponse',
  'loginAnomalyVelocityKmh',
]);
export type UserSessionSettingKey = z.infer<typeof UserSessionSettingKeySchema>;
export const USER_SESSION_SETTING_KEYS = UserSessionSettingKeySchema.options;

/** The installation (ROOT) keys of the geo-IP lookup, the ones on the settings page. */
export const USER_SESSION_GEO_KEYS: readonly UserSessionSettingKey[] = ['geoIpProvider', 'geoIpApiKey'] as const;
