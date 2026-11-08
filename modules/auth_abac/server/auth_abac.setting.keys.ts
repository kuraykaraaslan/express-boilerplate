import { z } from 'zod';

// Canonical per-tenant setting keys for the auth_abac module. Centralised so the
// runtime (guard/PDP enforcement) and the settings-fields file (admin UI) never
// drift apart — same pattern as auth.setting.keys / audit_log.setting.keys.
//
// abacShadowMode — when 'true', the PEP guard evaluates policies and logs the
//   decision but NEVER throws 403. Lets a tenant validate policies against real
//   traffic (decisions are logged with `enforced:false`) before flipping to
//   enforce. Default 'false' (enforce).
// abacDecisionLogMode — how much of the decision stream reaches the audit log:
//   'all' (every evaluation), 'deny_only' (only denies — cuts noise/cost), or
//   'off' (no decision logging). Default 'deny_only': every guarded request used to
//   write a hash-chained audit row for its permit (and the admin shell up to ~70 per
//   load), each under the tenant's advisory lock. Denies are the signal; a tenant or
//   the platform that needs permits too sets 'all' (optionally with the sample rate).
// abacRegexTimeoutMs — wall-clock budget for a user-defined `regex` operator
//   match, a ReDoS guard. Enforced by auth_abac.regex (vm watchdog for patterns
//   the static check does not clear) — see POSTURE.md risk surfaces.
// abacDecisionLogSampleRate — percentage (0-100) of PERMIT decisions that reach
//   the audit log, for high-traffic tenants where `all` is mostly noise. Denies
//   are never sampled — they are the signal. Sampled rows carry `sampleRate` in
//   their metadata so a reader can scale counts back up. Default 100 (log all).
export const AuthAbacSettingKeySchema = z.enum([
  'abacShadowMode',
  'abacDecisionLogMode',
  'abacRegexTimeoutMs',
  'abacDecisionLogSampleRate',
]);
export type AuthAbacSettingKey = z.infer<typeof AuthAbacSettingKeySchema>;
export const AUTH_ABAC_KEYS = AuthAbacSettingKeySchema.options;

// Ergonomic named accessors, kept in lockstep with the enum via `satisfies`.
export const AUTH_ABAC_SETTING_KEYS = {
  SHADOW_MODE: 'abacShadowMode',
  DECISION_LOG_MODE: 'abacDecisionLogMode',
  REGEX_TIMEOUT_MS: 'abacRegexTimeoutMs',
  DECISION_LOG_SAMPLE_RATE: 'abacDecisionLogSampleRate',
} as const satisfies Record<string, AuthAbacSettingKey>;

// Allowed values for the decision-log-mode select.
export const ABAC_DECISION_LOG_MODES = ['all', 'deny_only', 'off'] as const;
export type AbacDecisionLogMode = (typeof ABAC_DECISION_LOG_MODES)[number];

// Runtime defaults applied when a tenant (and the platform) leave a key unset.
// Fail-safe: enforce (no shadow), log every deny, a conservative regex budget.
export const ABAC_SETTINGS_DEFAULTS = {
  shadowMode: false,
  decisionLogMode: 'deny_only' as AbacDecisionLogMode,
  regexTimeoutMs: 250,
  decisionLogSampleRate: 100,
} as const;
