/**
 * Hard denylist (code, not policy): keys config.set can never touch, whatever any bundle says
 * (docs/phases/02-fleet/04-security-model.md section 4.4). fleet_protocol is a leaf, so the app-owned lists
 * (SENSITIVE_KEYS, PROTECTED module ids) are passed in by the caller.
 */
export const DENIED_KEYS = [
  'storageProvider', 'adminPanelIpAllowlist', 'adminRequireMfa', 'abacShadowMode', 'tenantSettingMakerChecker',
] as const;

export const DENIED_PATTERNS: readonly RegExp[] = [
  /^s3/i,
  /^observability.*Dsn$/i,
  /^otel/i,
  /^module\.[^.]+\.enabled$/, // narrowed to PROTECTED ids in isConfigKeyDenied when ids are supplied
];

export interface DenylistContext {
  /** Required: the app-owned SENSITIVE_KEYS list. Omitting it throws (fail closed) instead of silently skipping the list. */
  sensitiveKeys: Iterable<string>;
  protectedModuleIds?: Iterable<string>;
}

export function isConfigKeyDenied(key: string, ctx: DenylistContext): boolean {
  if (!ctx || ctx.sensitiveKeys == null) throw new Error('isConfigKeyDenied: sensitiveKeys is required (fail closed)');
  // Case-insensitive: a case variant ("StorageProvider") must not slip past an exact-match list.
  const lower = key.toLowerCase();
  if (DENIED_KEYS.some((d) => d.toLowerCase() === lower)) return true;
  if ([...ctx.sensitiveKeys].some((k) => k.toLowerCase() === lower)) return true;
  const mod = /^module\.([^.]+)\.enabled$/i.exec(key);
  if (mod) {
    return ctx.protectedModuleIds ? [...ctx.protectedModuleIds].some((m) => m.toLowerCase() === mod[1].toLowerCase()) : true; // fail closed
  }
  // Any other module.*.enabled shape (dotted ids) is denied rather than guessed at.
  if (/^module\..*\.enabled$/i.test(key)) return true;
  return DENIED_PATTERNS.some((p) => p.test(key));
}

/**
 * A tenant setting that is NODE configuration, not tenant data (05 section 6.4 "Settings"): the hard denylist above minus what a tenant owns. A
 * migration never carries one (the source leaves it out, the target refuses a bundle that has one), so the tenant takes the target's value: its
 * storage, telemetry and admin gates are the target's. A tenant's own secrets (the sensitive keys) and its module choices (`module.*.enabled`) do
 * migrate: they are the tenant's, and the target re-checks protected modules where it reads them.
 */
export function isNodeOwnedSetting(key: string): boolean {
  if (/^module\./i.test(key)) return false;
  return isConfigKeyDenied(key, { sensitiveKeys: [] });
}
