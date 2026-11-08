/**
 * ROOT settings this module reads (the operator's trust policy for local plugins). They are written only through
 * plugin_local's ROOT trust route, which validates and audits them; the generic settings API refuses them
 * (tenant_setting.write.maker-checker `isLedgerProjectionKey`).
 */
export const PLUGIN_LOCAL_SETTING_KEYS = {
  /** JSON `[{ kid, publicKey }]`: Ed25519 SPKI (base64) keys a bundle signature may verify against. */
  TRUSTED_KEYS: 'pluginLocalTrustedKeys',
  /** `'true'` refuses an unsigned version at upload and at install. Default false. */
  REQUIRE_SIGNED: 'pluginLocalRequireSigned',
  /**
   * JSON `{ memoryMb?, timeoutMs?, httpTimeoutMs?, httpMaxBytes? }`: a LOWER ceiling than the runtime's
   * (`loadRuntimeConfig().defaultLimits`) for every approved grant. A value above the runtime's is ignored.
   */
  MAX_LIMITS: 'pluginLocalMaxLimits',
} as const;

export const PLUGIN_LOCAL_SETTING_DEFAULTS = {
  [PLUGIN_LOCAL_SETTING_KEYS.TRUSTED_KEYS]: '[]',
  [PLUGIN_LOCAL_SETTING_KEYS.REQUIRE_SIGNED]: 'false',
  [PLUGIN_LOCAL_SETTING_KEYS.MAX_LIMITS]: '{}',
} as const;
