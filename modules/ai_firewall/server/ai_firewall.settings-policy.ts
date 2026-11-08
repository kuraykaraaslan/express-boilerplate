import { FIREWALL_MODES, type FirewallActionContribution, type FirewallMode } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { AI_FIREWALL_SETTING_KEYS, aiFirewallModeKey } from './ai_firewall.setting.keys';
import { EVENTS_MAX_RETENTION_DAYS } from './store/ai_firewall.store';

/**
 * The tenant's AI firewall settings (docs/phases/55-ai-firewall/01 §1.1, §1.7). Unset, junk or a failed read keeps the defaults, and the
 * defaults are the safe side: the longest evidence, and no action of the firewall's own.
 *
 * - `aiFirewallRetentionDays`: a whole number of days, 7..365, default 90. Below 7 reads as 7 (a week of evidence is the least an
 *   incident review needs, and a compromised admin must not be able to wipe yesterday's trail with one setting); above 365 reads as
 *   365 (the platform's chunk-drop backstop on the events table, `ai_firewall.timeseries.ts`, keeps no longer anyway).
 * - The kill switches: on only for exactly `true`. The platform's is read from ROOT (platform-only key); the tenant's is the tenant's own
 *   row (never inherited from ROOT, tenant_setting.read.service.ts TENANT_OWN_KEYS, so ROOT's own switch stops ROOT's actions only).
 * - `aiFirewallDefaultMode`: `observe` (install) or `suggest`; anything else, `auto` included, reads as `observe`.
 * - The retention and the default mode are the tenant's own rows too (TENANT_OWN_KEYS): ROOT's values are the platform's rows' and runs',
 *   never another tenant's (a tenant that set none keeps the module's defaults, 90 days and Observe).
 * - `aiFirewallMode:<actionId>`: `observe`, `suggest` or `auto`; anything else is no choice (the default applies). Never inherited from
 *   ROOT (NO_INHERIT_PREFIXES): a tenant's Auto is only ever its own confirmed choice.
 */
export const DEFAULT_RETENTION_DAYS = 90;
export const MIN_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = EVENTS_MAX_RETENTION_DAYS;

export function sanitizeRetentionDays(raw: string | null | undefined): number {
  const v = (raw ?? '').trim();
  if (!/^\d{1,9}$/.test(v)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Number(v)));
}

export interface AiFirewallPolicy {
  retentionDays: number;
}

export const DEFAULT_AI_FIREWALL_POLICY: AiFirewallPolicy = { retentionDays: DEFAULT_RETENTION_DAYS };

async function settingService() {
  // Loaded on use: a settings store that is down keeps the defaults.
  return (await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service')).default;
}

export async function getAiFirewallPolicy(tenantId: string): Promise<AiFirewallPolicy> {
  let s: Record<string, string | null> = {};
  try {
    // A failed read keeps 90 days, never less.
    s = (await (await settingService()).getByKeys(tenantId, [AI_FIREWALL_SETTING_KEYS.RETENTION_DAYS])) ?? {};
  } catch { /* defaults */ }
  return { retentionDays: sanitizeRetentionDays(s[AI_FIREWALL_SETTING_KEYS.RETENTION_DAYS]) };
}

/* ───────────────────────────── The kill switches and the modes (01 §1.1) ───────────────────────────── */

/** The mode an action has before anyone chose one: Observe, on every install (FWA-1, 01 §1.8). */
export const INSTALL_MODE: FirewallMode = 'observe';
/** What `aiFirewallDefaultMode` may be. Auto is never a default: it is switched on per action. */
export const DEFAULT_MODE_CHOICES = ['observe', 'suggest'] as const satisfies readonly FirewallMode[];
export type DefaultModeChoice = (typeof DEFAULT_MODE_CHOICES)[number];

export const sanitizeSwitch = (raw: string | null | undefined): boolean => (raw ?? '').trim() === 'true';

export function sanitizeDefaultMode(raw: string | null | undefined): DefaultModeChoice {
  const v = (raw ?? '').trim();
  return (DEFAULT_MODE_CHOICES as readonly string[]).includes(v) ? (v as DefaultModeChoice) : 'observe';
}

export function sanitizeActionMode(raw: string | null | undefined): FirewallMode | null {
  const v = (raw ?? '').trim();
  return (FIREWALL_MODES as readonly string[]).includes(v) ? (v as FirewallMode) : null;
}

export interface FirewallActionPolicy {
  /**
   * Why every action is observed only right now, or null: `platform` (the platform's switch), `tenant` (the tenant's own),
   * `unreadable` (the settings could not be read: a firewall that cannot read its own policy acts on nothing, FWA-7).
   */
  killed: 'platform' | 'tenant' | 'unreadable' | null;
  defaultMode: DefaultModeChoice;
  /** The tenant's own choice per action id (only the ids asked for, only valid choices). */
  modes: Readonly<Record<string, FirewallMode>>;
}

/**
 * The mode an action runs under for a tenant: observe while a kill switch holds; else the tenant's choice for the action, else the
 * tenant's default mode (Observe on install). The action's `minimumMode` is a floor of oversight: a `suggest` action chosen as Auto runs as
 * Suggest (a person approves every run), and so does an action whose run cannot be undone (`reversible: false`).
 */
export function effectiveActionMode(policy: FirewallActionPolicy, action: Pick<FirewallActionContribution, 'id' | 'minimumMode' | 'reversible'>): FirewallMode {
  if (policy.killed) return 'observe';
  const chosen = policy.modes[action.id] ?? policy.defaultMode;
  // An irreversible action (`reversible: false`, FWA-4, D55-9) is held at Suggest too, whatever it declared or a stale row says.
  if (chosen === 'auto' && (action.minimumMode === 'suggest' || action.reversible === false)) return 'suggest';
  return chosen;
}

/**
 * The tenant's kill switches and modes for `actionIds` (null tenant = the platform, read as ROOT's). Two reads: the platform's switch
 * from ROOT and the tenant's keys. Never throws; a read that fails answers `killed: 'unreadable'`.
 */
export async function getFirewallActionPolicy(tenantId: string | null, actionIds: readonly string[] = []): Promise<FirewallActionPolicy> {
  const tenant = tenantId ?? ROOT_TENANT_ID;
  const modeKeys = actionIds.map((id) => [id, aiFirewallModeKey(id)] as const);
  try {
    const svc = await settingService();
    const [platform, own] = await Promise.all([
      svc.getByKeys(ROOT_TENANT_ID, [AI_FIREWALL_SETTING_KEYS.PLATFORM_KILL_SWITCH]),
      svc.getByKeys(tenant, [AI_FIREWALL_SETTING_KEYS.KILL_SWITCH, AI_FIREWALL_SETTING_KEYS.DEFAULT_MODE, ...modeKeys.map(([, key]) => key)]),
    ]);
    const p = (platform ?? {}) as Record<string, string | null>;
    const s = (own ?? {}) as Record<string, string | null>;
    const modes: Record<string, FirewallMode> = {};
    for (const [id, key] of modeKeys) {
      const m = sanitizeActionMode(s[key]);
      if (m) modes[id] = m;
    }
    const killed = sanitizeSwitch(p[AI_FIREWALL_SETTING_KEYS.PLATFORM_KILL_SWITCH])
      ? 'platform'
      : sanitizeSwitch(s[AI_FIREWALL_SETTING_KEYS.KILL_SWITCH]) ? 'tenant' : null;
    return { killed, defaultMode: sanitizeDefaultMode(s[AI_FIREWALL_SETTING_KEYS.DEFAULT_MODE]), modes };
  } catch {
    return { killed: 'unreadable', defaultMode: 'observe', modes: {} };
  }
}
