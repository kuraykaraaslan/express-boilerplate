import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { SETTING_KEYS_BY_MODULE, SETTING_KEY_PREFIXES_BY_MODULE } from '@kuraykaraaslan-labs/common/server/setting-keys.catalog';
import { isLedgerProjectionKey, isPluginConfigKey } from './tenant_setting.write.maker-checker';
import { levelFollowOf, type SettingLevel } from './tenant_setting.levels';
import { SETTING_LEVEL_KEY_PREFIX } from './tenant_setting.level.setting.keys';

// ── Who may CHANGE which key through the generic settings API (F.tsetting.01, S3) ─────────────────────────────────────
// The generic API (settings / admin-settings routes -> updateManyGated) used to write any key for any holder of
// `tenant_setting.config.update`, so a tenant ADMIN could switch off the guard (`abacShadowMode`), hide the evidence of its
// denies (`abacDecisionLogMode=off`), shorten the audit trail (`auditLogRetentionDays=1`) or plant platform signing keys.
// The low-level writers (`create`, `update`, `updateMany`) used by the platform's own services are not affected.

/**
 * Keys that only the platform operator sets, in the ROOT tenant. A tenant's own row would either void a control the OWNER or
 * the platform relies on (the ABAC runtime ignores a tenant's shadow mode and never lets a tenant switch deny logging off) or
 * pose as a platform credential. Refused (403) in every other tenant.
 */
export const PLATFORM_ONLY_SETTING_KEYS: ReadonlySet<string> = new Set([
  'abacShadowMode',
  'abacDecisionLogMode',
  'globalIpBlacklist',
  'accessTokenSecret',
  'refreshTokenSecret',
  'settingsEncryptionKey',
  // iot_rpc: the per-tenant command cap protects the shared gateway; a tenant ADMIN could otherwise raise its own cap.
  'iotRpcTenantPerMinute',
  // tenant_domain (phase 56, D346): whether tenants may choose their platform base domain; read from ROOT only.
  'baseDomainChoice',
  // iot_device: the per-tenant cap of device.* webhooks protects the shared webhook queue (iot-webhook 01 volume guard).
  'iotWebhookDeviceEventsPerMinute',
  // fx: the rate table's cache, staleness and fallback provider (read from ROOT, fx.settings-policy.ts); tenant_subscription:
  // the cushion before a lapsed module entitlement is switched off (read from ROOT).
  'fxCacheTtlHours',
  'fxStaleAfterHours',
  'fxFallbackProviderEnabled',
  'entitlementExpiryGraceDays',
  // fleet_license: when the deployment renews its lease; plugin_runtime: the broker's lower-only caps (all read from ROOT).
  'fleetLicenseRenewBelowDays',
  'pluginPresignMaxSeconds',
  'pluginUploadMaxMb',
  'pluginKvMaxValueKb',
  // marketplace: the community review moderation (read from ROOT) and the upstream feed; marketplace_developer: the
  // platform commission and the payout hold (read from ROOT).
  'marketplaceCommunityReviewModeration',
  'marketplaceUpstreamFeedUrl',
  'marketplaceRevenueSharePct',
  'marketplacePayoutHoldDays',
  // tenant: the maintenance cache and pre-notice (read from ROOT).
  'maintenanceCacheTtlSeconds',
  'maintenancePreNotifyHours',
  // module_lifecycle: the restore window of an uninstalled module; telemetry: the minute rollup's tuning (read from ROOT).
  'moduleRestoreWindowDays',
  'telemetryRollupDbSharePercent',
  'telemetryRollupMaxSteps',
  'telemetryRollupFullSweepEvery',
  // limiter: the installation's request limits and bans; redis_idempotency: the replay and pending windows (read from ROOT).
  'limiterAuthPerMinute',
  'limiterLoginPerMinute',
  'limiterStrikeThreshold',
  'limiterBanBaseMinutes',
  'limiterApiPerMinute',
  'idempotencyReplayHours',
  'idempotencyPendingMinutes',
  // user_session: the installation's geo-IP provider (read from ROOT; the lookup cache is shared by every tenant);
  // user_security: the trusted device lifetime (read from ROOT, can only shorten).
  'geoIpProvider',
  'geoIpApiKey',
  'trustedDeviceTtlDays',
  // storage (local disk, plugin @local/storage): the directory of the on-premise disk store and its free-space floor (read from ROOT); a tenant must not choose a path on the server.
  'storageLocalDir',
  'storageLocalMinFreeMb',
  // ai_firewall: the platform's kill switch (read from ROOT): stops the firewall's own actions in every tenant at once (phase 55 01 §1.1).
  'aiFirewallPlatformKillSwitch',
]);

/**
 * Keys that weaken the tenant's own evidence or its control over who becomes an admin: only its OWNER changes them (403 for
 * an ADMIN). The maker-checker toggle is not here: under the gate its change is parked for a reviewer like any other key
 * (tenant_setting.02). 05-tenant-member 3.1: `tenantMemberDualControl` is the check on admin grants (an admin must not switch
 * it off), and `defaultMemberRole` decides the role of a member an admin adds without naming one (POST /members; it can be
 * ADMIN). Self-registration ignores it and always creates a USER; an invitation that names no role takes it, under the
 * inviter's rank rules and dual control.
 */
export const OWNER_ONLY_SETTING_KEYS: ReadonlySet<string> = new Set([
  'auditLogRetentionDays',
  'tenantMemberDualControl',
  'defaultMemberRole',
  // The module settings pages of 2026-10-27: the till's cash and price controls (pos), and the history of alarms and
  // device commands (iot_alarm, iot_rpc), which an ADMIN could otherwise cut to a day.
  'posManagerPriceOverride',
  'posCloseVarianceNoteAboveMinor',
  'iotAlarmHistoryDays',
  'iotRpcHistoryDays',
  // wallet: the cap on one member transfer (an ADMIN could otherwise raise it).
  'walletMaxTransferAmount',
  // contact: the one-to-one e-mail quota per hour (a security fix, contact.16; an ADMIN could otherwise raise it).
  'contactOutboundHourlyQuota',
  // consent_registry_iys: the İYS account and endpoint (an ADMIN switching production to the sandbox voids the legal check).
  'iysBaseUrl',
  'iysCode',
  'iysBrandCode',
  // activity: how long a recorded activity may still be deleted; marketplace: third-party script on the public pages;
  // marketplace_developer: the money controls (in ROOT, its OWNER).
  'activityAllowDeleteAfterHours',
  'marketplaceAllowBlockScripts',
  'marketplaceRevenueSharePct',
  'marketplacePayoutHoldDays',
  // tenant_invitation: the roles an invitation may grant (who can become ADMIN that way); terms_consent: the checkout's
  // legal gate (emptying it lets a checkout through without the agreements).
  'invitationAllowedRoles',
  'checkoutRequiredAgreements',
  // tenant_session (MS-39): who may reach the workspace at all. Requiring two-step verification (switched on only from a
  // session that proved a second factor, tenant_setting.two-factor.ts), the IP allow / deny lists (never one that shuts
  // out the writer, tenant_setting.ip-lists.ts) and the concurrent-session cap: an ADMIN could otherwise switch the
  // requirement off, open the lists or lock the OWNER out.
  'twoFactorRequired',
  'ipWhitelist',
  'ipBlacklist',
  'maxConcurrentSessions',
  // ai_firewall (phase 55 D55-10): the platform's kill switch, in ROOT (platform-only above). Switching it off lets every tenant's Auto
  // actions run again: ROOT's OWNER or a platform administrator, never any ROOT ADMIN holding the firewall's permissions.
  'aiFirewallPlatformKillSwitch',
]);

/**
 * Keys an ADMIN changes in its own tenant but that only the OWNER (or a platform administrator) changes in the ROOT tenant, where
 * the ROOT row is the platform's policy rather than one workspace's. ai_firewall (phase 55 D55-17): a platform run (`tenantId` null)
 * reads ROOT's kill switch and default mode, so switching ROOT's switch off resumes the platform's Auto actions (installation-wide
 * address bans, throttles, account locks), the reason the platform switch is OWNER-only (D55-10). In any other tenant they are the
 * tenant's own and stay as they are.
 */
export const ROOT_OWNER_ONLY_SETTING_KEYS: ReadonlySet<string> = new Set([
  'aiFirewallKillSwitch',
  'aiFirewallDefaultMode',
  // 02.6: ROOT's opt-in lets the platform's runs hard-block sign-ups (on the tenants that opted in themselves).
  'aiFirewallSignupHardBlock',
]);

// ── Keys the generic settings API never serves or writes (MS-09, MS-21) ─────────────────────────────────────────────

/**
 * MS-09: prefixes of a module's internal rows, which are no setting a person configures: the generic read routes
 * (`GET /api/admin-settings`, `GET` / `PUT /api/settings`) never answer them and the generic writes refuse them. Start:
 * `fleet_license.` — the deployment's installed license document, its lease, the deployment id and the deployment's
 * signing key (`LICENSE_SETTING_KEYS`, fleet_license.deployment.service.ts, written by its own service on ROOT). The key is
 * sealed by fleet_license itself, so it is NOT in SENSITIVE_KEYS (that list also means "encrypt at rest", and the settings
 * service would then decrypt fleet_license's own ciphertext); it is simply never shown. fleet_license's own setting
 * `fleetLicenseRenewBelowDays` has no dot and stays an ordinary owned key.
 */
export const INTERNAL_KEY_PREFIXES: readonly string[] = ['fleet_license.'];

/** Is `key` an internal row the generic settings API neither returns nor writes (MS-09)? */
export function isInternalSettingKey(key: string): boolean {
  return INTERNAL_KEY_PREFIXES.some((p) => key.startsWith(p));
}

/** `record` without its internal rows (MS-09). */
export function withoutInternalKeys(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !isInternalSettingKey(key)));
}

/**
 * MS-21: keys written only through their own validating route, refused on the generic settings API like the ledger
 * projections and the plugin_local trust keys: `marketplaceInstallPolicy` (one JSON document, written only by
 * `/api/marketplace/community/policy`, which parses it; an invalid document read as the open policy) and
 * `marketplaceUpstreamFeedUrl` (ROOT, written only by `/api/marketplace/upstream`, which checks the URL). Both routes write
 * through the low-level `updateMany` and are unaffected; the keys stay readable here (marketplace's permission still gates them).
 */
export const ROUTE_ONLY_SETTING_KEYS: ReadonlySet<string> = new Set([
  'marketplaceInstallPolicy',
  'marketplaceUpstreamFeedUrl',
  // iot_gateway (OD-78, D309): cloud SNMPv2c, written only by PUT /api/iot/snmp/cloud-v2c (admin, confirmed warning, audit, disables v2c endpoints)
  'iotSnmpCloudV2cEnabled',
]);

/**
 * MS-21, key families: the AI firewall's per-action modes (`aiFirewallMode:<actionId>`, phase 55 01 §1.8) are written only by
 * `PUT /api/ai-firewall/actions`, which checks that the action is registered, that the tenant may choose its mode (a platform action is the
 * root tenant's) and that a switch to Auto was confirmed. The generic API could store an Auto for any well-formed id without any of that.
 * The route writes through the low-level `updateMany` / `delete`; the keys stay readable here (ai_firewall's permission gates them).
 */
export const ROUTE_ONLY_SETTING_PREFIXES: readonly string[] = ['aiFirewallMode:'];

/** Phase 53: ROOT's choice of a module's setting level (`settingLevel.<moduleId>[:<tenantId>]`), written only by `/api/setting-levels`. */
export function isSettingLevelKey(key: string): boolean {
  return key.startsWith(SETTING_LEVEL_KEY_PREFIX);
}

/**
 * Keys the generic settings API refuses to write or delete (403): a ledger projection or a plugin's config (see
 * isLedgerProjectionKey / isPluginConfigKey), an internal row (MS-09), a key with its own validating route (MS-21), or a
 * setting level (phase 53, written only by the operator's route).
 */
export function isGenericWriteRefusedKey(key: string): boolean {
  return isLedgerProjectionKey(key) || isPluginConfigKey(key) || isInternalSettingKey(key) || ROUTE_ONLY_SETTING_KEYS.has(key)
    || ROUTE_ONLY_SETTING_PREFIXES.some((p) => key.startsWith(p)) || isSettingLevelKey(key);
}

export interface SettingWriter {
  /** The writer's role in the URL tenant (`tenantMember.memberRole`); missing = not an OWNER (fail closed). */
  role?: string | null;
  /** A platform (ROOT) admin acting in the tenant counts as an OWNER for these rules. */
  isGlobalAdmin?: boolean;
}

const same = (a: string | null | undefined, b: string | null | undefined): boolean => (a ?? '') === (b ?? '');

/**
 * Drops the protected keys whose submitted value equals the stored one (a settings page saves every field it shows; an
 * unchanged value is not a change) and throws 403 for any protected key the writer may not change. `current` reads the
 * tenant's effective value of a key. Returns the batch to write.
 *
 * Phase 53.3: `levelOf` answers the tenant's setting level for a module. At `platform` the module's provider keys are ROOT's
 * (the tenant's own rows are kept but not used), so a tenant cannot change them: 403, "provided by the platform". The platform
 * operator still may, and the tenant may still lower a cap (at `platform` the lower of the two values applies). An empty
 * value is dropped like an unchanged one: a page does not show ROOT's account names, so it saves those fields back empty.
 */
export async function enforceSettingKeyPolicy(
  tenantId: string,
  settings: Record<string, string>,
  writer: SettingWriter | undefined,
  current: (key: string) => Promise<string | null>,
  levelOf?: (moduleId: string) => Promise<SettingLevel | null>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const refused: string[] = [];
  const providedByPlatform: string[] = [];
  const owner = writer?.role === 'OWNER' || writer?.isGlobalAdmin === true;
  const levels = new Map<string, Promise<SettingLevel | null>>();
  const checkLevels = !!levelOf && !isRootTenant(tenantId) && writer?.isGlobalAdmin !== true;
  for (const [key, value] of Object.entries(settings)) {
    const follow = checkLevels ? levelFollowOf(key) : null;
    if (follow && !follow.cap) {
      if (!levels.has(follow.moduleId)) levels.set(follow.moduleId, levelOf!(follow.moduleId).catch(() => null));
      if ((await levels.get(follow.moduleId)) === 'platform') {
        if (value === '' || same(await current(key).catch(() => null), value)) continue;
        providedByPlatform.push(key);
        continue;
      }
    }
    const platformOnly = PLATFORM_ONLY_SETTING_KEYS.has(key) && !isRootTenant(tenantId);
    const ownerOnly = (OWNER_ONLY_SETTING_KEYS.has(key) || (ROOT_OWNER_ONLY_SETTING_KEYS.has(key) && isRootTenant(tenantId))) && !owner;
    if (platformOnly || ownerOnly) {
      if (same(await current(key).catch(() => null), value)) continue;
      refused.push(key);
      continue;
    }
    out[key] = value;
  }
  if (refused.length > 0) {
    throw new AppError(
      `These settings can only be changed by the platform operator or the workspace owner: ${refused.join(', ')}.`,
      403,
      ErrorCode.FORBIDDEN,
    );
  }
  if (providedByPlatform.length > 0) {
    throw new AppError(
      `These settings are provided by the platform for this workspace and cannot be changed here: ${providedByPlatform.join(', ')}.`,
      403,
      ErrorCode.FORBIDDEN,
    );
  }
  return out;
}

// ── Declared keys only (F.tsetting.01) ──────────────────────────────────────────────────────────────────────────────
// The catalog is generated from what every module declares or uses (scripts/registry/setting-keys.mjs): its
// `*.setting.keys.ts` / `*.fields.ts` files, the keys its code reads or writes through the settings service, and the keys
// its settings UI shows. A key nobody declares is meaningless to the platform and is refused, so the settings table can no
// longer be used as free storage by a tenant admin.

const DECLARED_KEYS: ReadonlySet<string> = new Set(Object.values(SETTING_KEYS_BY_MODULE).flat());
const DECLARED_PREFIXES: readonly string[] = Object.values(SETTING_KEY_PREFIXES_BY_MODULE).flat();

/** Is `key` declared by some module (a listed key, or a member of a declared run-time family such as `ssoClientId:<provider>`)? */
export function isDeclaredSettingKey(key: string): boolean {
  // Ledger projections and plugin config keys are known families; the generic API refuses them with its own 403.
  if (isLedgerProjectionKey(key) || isPluginConfigKey(key)) return true;
  return DECLARED_KEYS.has(key) || DECLARED_PREFIXES.some((p) => key.length > p.length && key.startsWith(p));
}

/** Throws 400 naming every key of `keys` that no module declares. */
export function assertDeclaredSettingKeys(keys: Iterable<string>): void {
  const unknown = [...keys].filter((k) => !isDeclaredSettingKey(k));
  if (unknown.length > 0) {
    throw new AppError(
      `Unknown setting key(s): ${unknown.slice(0, 20).join(', ')}. Only keys a module declares can be written.`,
      400,
      ErrorCode.VALIDATION_ERROR,
    );
  }
}
