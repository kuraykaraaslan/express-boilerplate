import { z } from 'zod';

/**
 * The AI firewall's per-tenant setting keys (ai_firewall.settings-policy.ts). Owned by ai_firewall and closed by its permissions on the
 * settings page and in the generic settings API (tenant_setting.key-owners.ts): read with `ai_firewall.settings.manage`, written with it
 * and `ai_firewall.actions.manage` (the switches below decide what the firewall may do on its own).
 *
 * - `aiFirewallRetentionDays`: how long the tenant's stored security events, closed incidents and ended action proposals are kept
 *   (docs/phases/55-ai-firewall/01 §1.7). Read by the retention job (`ai_firewall.retention.job.ts`). The ROOT tenant's value governs
 *   the platform's own rows.
 * - `aiFirewallKillSwitch`: the tenant's kill switch (01 §1.1, §1.8). While on, every action of the tenant is observed only: nothing is
 *   proposed and nothing runs on its own. Signals are still stored; the deterministic controls are untouched.
 * - `aiFirewallPlatformKillSwitch`: the same for every tenant at once. Platform-only (tenant_setting.key-policy.ts), read from ROOT.
 * - `aiFirewallDefaultMode`: the mode of an action the tenant has not chosen one for: `observe` (the install default) or `suggest`.
 *   Never `auto`: an automatic action is switched on one action at a time (the actions catalogue, 01 §1.8, behind a ConfirmDialog).
 * - `aiFirewallMode:<actionId>`: the tenant's mode for one registered action (`observe` / `suggest` / `auto`), a key family.
 * - `aiFirewallSignupHardBlock` (02 §2.6): the tenant's opt-in for the hard block of sign-ups (auth's `auth.signup_block`: refuse new
 *   sign-ups from an address for a while). Off on install: without it the action is refused and a standing block has no effect. Read by
 *   auth by its key (auth.signup-protection.keys.ts), never imported. The tenant's own (never inherited from ROOT); ROOT's is the
 *   platform's runs' and only ROOT's OWNER changes it (D55-17).
 */
export const AiFirewallSettingKeySchema = z.enum([
  'aiFirewallRetentionDays',
  'aiFirewallKillSwitch',
  'aiFirewallPlatformKillSwitch',
  'aiFirewallDefaultMode',
  'aiFirewallSignupHardBlock',
]);
export type AiFirewallSettingKey = z.infer<typeof AiFirewallSettingKeySchema>;
/** The manifest's `settings` entry points here. */
export const AI_FIREWALL_KEYS = AiFirewallSettingKeySchema.options;

export const AI_FIREWALL_SETTING_KEYS = {
  RETENTION_DAYS: 'aiFirewallRetentionDays',
  KILL_SWITCH: 'aiFirewallKillSwitch',
  PLATFORM_KILL_SWITCH: 'aiFirewallPlatformKillSwitch',
  DEFAULT_MODE: 'aiFirewallDefaultMode',
  SIGNUP_HARD_BLOCK: 'aiFirewallSignupHardBlock',
} as const satisfies Record<string, AiFirewallSettingKey>;

/** The key family of the per-action modes. */
export const AI_FIREWALL_MODE_KEY_PREFIX = 'aiFirewallMode:';

/** The setting key of one action's mode for a tenant. */
export const aiFirewallModeKey = (actionId: string): string => `aiFirewallMode:${actionId}`;
