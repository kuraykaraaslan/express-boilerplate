import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import Logger from '@kuraykaraaslan-labs/logger';
import { env } from '@kuraykaraaslan-labs/env';
import { isShadowModeRefusedRole } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.abac-shadow';
import { settingsGenerationKey } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.generation';
import {
  noDropPending, openEntry, readGuarded, stampForWrite, stampOf, writeGuarded,
} from '@kuraykaraaslan-labs/session_end/server/session_end.cache-guard';
import {
  AUTH_ABAC_KEYS,
  AUTH_ABAC_SETTING_KEYS as KEY,
  ABAC_DECISION_LOG_MODES,
  ABAC_SETTINGS_DEFAULTS,
  type AbacDecisionLogMode,
} from './auth_abac.setting.keys';

export interface AbacRuntimeSettings {
  /** Shadow mode: evaluate + log, but never throw 403 on deny. */
  shadowMode: boolean;
  /** Which decisions reach the audit log. */
  decisionLogMode: AbacDecisionLogMode;
  /** ReDoS budget for user-defined regex operators (ms). */
  regexTimeoutMs: number;
  /** Percentage (0-100) of permit decisions written to the audit log; denies are always logged. */
  decisionLogSampleRate: number;
}

function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === '') return undefined;
  return raw === 'true' || raw === '1';
}

function parseInt32(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function parsePercent(raw: string | undefined): number | undefined {
  const n = parseInt32(raw);
  return n === undefined ? undefined : Math.min(100, Math.max(0, n));
}

function parseLogMode(raw: string | undefined): AbacDecisionLogMode | undefined {
  return (ABAC_DECISION_LOG_MODES as readonly string[]).includes(raw ?? '')
    ? (raw as AbacDecisionLogMode)
    : undefined;
}

// Platform (ROOT) value wins, then tenant value, mirroring the auth policy
// loader's system→tenant precedence so a platform operator can pin a posture.
function resolve(
  key: string,
  system: Record<string, string>,
  tenant: Record<string, string>,
): string | undefined {
  const sys = system[key];
  if (sys !== undefined && sys !== '') return sys;
  const ten = tenant[key];
  if (ten !== undefined && ten !== '') return ten;
  return undefined;
}

/**
 * Shadow mode as the guard applies it (docs/phases/02-fleet P9-10): a fleet node or the fleet instance always enforces, whatever a settings row says.
 * The write path refuses turning it on there (`assertAbacShadowWriteAllowed`); this covers a row written another way (a direct database write, a row
 * from before the role, an import), and the node's `abac.shadow_off` check reports such a row.
 */
export function effectiveShadowMode(stored: boolean, role: string | undefined = env.FLEET_ROLE): boolean {
  return stored && !isShadowModeRefusedRole(role);
}

/**
 * S3: a deny must leave evidence the tenant cannot switch off. `off` is honoured only when the platform (ROOT) set it; a
 * tenant's `off` is read as `deny_only` (permits unlogged, denies still logged).
 */
function tenantSafeLogMode(resolved: AbacDecisionLogMode, platform: AbacDecisionLogMode | undefined): AbacDecisionLogMode {
  return resolved === 'off' && platform !== 'off' ? 'deny_only' : resolved;
}

/** The guarded entry of a tenant's resolved runtime settings (D270). */
export function abacRuntimeSettingsKey(tenantId: string): string {
  return `abac_settings:${tenantId}`;
}
/** How long the entry lives; the guard, not the TTL, is what makes a change apply at once. */
export const ABAC_RUNTIME_SETTINGS_TTL = 5 * 60;

/** The generations a tenant's entry is sealed with: ROOT's (its values and its shadow switch are every tenant's), and the tenant's own. */
function generationKeys(tenantId: string): string[] {
  return tenantId === ROOT_TENANT_ID ? [settingsGenerationKey(ROOT_TENANT_ID)] : [settingsGenerationKey(ROOT_TENANT_ID), settingsGenerationKey(tenantId)];
}

/** No cache drop pending for the tenant nor for ROOT (a ROOT write changes every tenant's settings). */
async function noSettingsDropPending(tenantId: string): Promise<boolean> {
  return (await noDropPending(tenantId)) && (tenantId === ROOT_TENANT_ID || (await noDropPending(ROOT_TENANT_ID)));
}

function isRuntimeSettings(v: unknown): v is AbacRuntimeSettings {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.shadowMode === 'boolean' && (ABAC_DECISION_LOG_MODES as readonly unknown[]).includes(o.decisionLogMode)
    && typeof o.regexTimeoutMs === 'number' && typeof o.decisionLogSampleRate === 'number';
}

/**
 * Resolve the auth_abac runtime knobs for a tenant. Best-effort: a settings
 * read failure falls back to the fail-safe defaults (enforce, log-all) rather
 * than silently disabling enforcement.
 *
 * D270 (docs/audits/2026-11-03-redis-outage.md §6.10): a change of shadow mode or the decision log applies at once, also during and
 * after a Redis outage. The resolved settings are one guarded entry (`session_end.cache-guard.ts`), read with ROOT's and the tenant's
 * settings generations in one round trip and believed only when sealed with the stamp of this read (the same Redis instance, neither
 * generation bumped since the fill) and no cache drop is pending for the tenant or ROOT. Every setting write records its drop (the
 * generation bump) in its own transaction (`tenant_setting.cache-drop.ts`). Otherwise the rows are read from the database
 * (`getByKeys` with `fromDatabase`, never the plain settings map, whose invalidation is best effort), and cached again only when both reads
 * answered, Redis is trusted and no drop is pending.
 */
export default class AbacSettingsService {
  static async getRuntimeSettings(tenantId: string): Promise<AbacRuntimeSettings> {
    const key = abacRuntimeSettingsKey(tenantId);
    const read = await readGuarded([key], generationKeys(tenantId));
    const sealed = openEntry(read?.values[0], stampOf(read));
    // the process role applies on every read: an entry is never a fleet node's way around enforcement
    if (isRuntimeSettings(sealed) && (await noSettingsDropPending(tenantId))) return { ...sealed, shadowMode: effectiveShadowMode(sealed.shadowMode) };

    const { settings, complete } = await AbacSettingsService.readFromDatabase(tenantId);
    if (complete) {
      // sealed with the generations read BEFORE the database read: a write that commits in between bumps one, so this is never believed
      const stamp = await stampForWrite(read);
      if (stamp && (await noSettingsDropPending(tenantId))) await writeGuarded(key, stamp, settings, ABAC_RUNTIME_SETTINGS_TTL);
    }
    return { ...settings, shadowMode: effectiveShadowMode(settings.shadowMode) };
  }

  /** The settings as stored (shadow mode before the process role), and whether both reads answered (only then is it cached). */
  private static async readFromDatabase(tenantId: string): Promise<{ settings: AbacRuntimeSettings; complete: boolean }> {
    let complete = true;
    // A read that resolves nothing (a missing row set) reads as "no settings", like a failed read: the defaults apply.
    const [systemRead, tenantRead] = await Promise.all([
      SettingService.getByKeys(ROOT_TENANT_ID, [...AUTH_ABAC_KEYS], { fromDatabase: true }).catch((err: unknown) => {
        complete = false;
        Logger.warn(
          `AbacSettings: failed to load platform settings: ${err instanceof Error ? err.message : String(err)}`,
        );
        return {} as Record<string, string>;
      }),
      SettingService.getByKeys(tenantId, [...AUTH_ABAC_KEYS], { fromDatabase: true }).catch((err: unknown) => {
        complete = false;
        Logger.warn(
          `AbacSettings: failed to load tenant settings (${tenantId}): ${err instanceof Error ? err.message : String(err)}`,
        );
        return {} as Record<string, string>;
      }),
    ]);
    const system: Record<string, string> = systemRead ?? {};
    const tenant: Record<string, string> = tenantRead ?? {};

    return {
      complete,
      settings: {
        // S3: shadow mode is the platform's switch only. A tenant's own row (an ADMIN could write it) would void every deny
        // the OWNER authored, so it is ignored; the settings API refuses writing it outside ROOT.
        shadowMode: parseBool(resolve(KEY.SHADOW_MODE, system, {})) ?? ABAC_SETTINGS_DEFAULTS.shadowMode,
        decisionLogMode: tenantSafeLogMode(
          parseLogMode(resolve(KEY.DECISION_LOG_MODE, system, tenant)) ?? ABAC_SETTINGS_DEFAULTS.decisionLogMode,
          parseLogMode(system[KEY.DECISION_LOG_MODE]),
        ),
        regexTimeoutMs:
          parseInt32(resolve(KEY.REGEX_TIMEOUT_MS, system, tenant)) ??
          ABAC_SETTINGS_DEFAULTS.regexTimeoutMs,
        decisionLogSampleRate:
          parsePercent(resolve(KEY.DECISION_LOG_SAMPLE_RATE, system, tenant)) ??
          ABAC_SETTINGS_DEFAULTS.decisionLogSampleRate,
      },
    };
  }
}
