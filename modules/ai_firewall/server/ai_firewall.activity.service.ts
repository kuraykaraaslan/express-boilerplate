/**
 * The AI firewall's activity page in one response (Platform -> AI firewall, root super-admin; docs/phases/55-ai-firewall): the two
 * shipped models and the cascade's mode, security activity across every tenant from the audit log, and the active address bans.
 *
 * Each store is read on its own: an audit log or Redis that is down turns only its own section into `unavailable`, the rest of the
 * page still shows (the firewall's own screens fail open too, FWA-7); one tenant database that is down is only counted
 * (`skippedTenants`). Only safe fields leave this file: no audit metadata, user agents or hashes; no model text.
 *
 * The view is the same for every caller (ROOT only, installation-wide), so one read serves all of them for ACTIVITY_CACHE_MS
 * (in-process, single-flight): N open tabs polling cost one read of every tenant's audit log, not N.
 */
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import { SECURITY_ALERT_RULES } from '@kuraykaraaslan-labs/audit_log/server/audit_log.security-alerts';
import IpStrikeService, { type IpBan } from '@kuraykaraaslan-labs/limiter/server/limiter.ip-strikes';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import Logger from '@kuraykaraaslan-labs/logger';
import { loadShippedModel, STAGE_LIBRARY, type ModelLoadResult } from './models/shipped-models';
import type { ShippedModelName } from './models/shipped-models.types';
import { cascadeMode } from './ai_firewall.cascade-mode';
import { getFirewallActionPolicy } from './ai_firewall.settings-policy';
import { promotedStages } from './promotion/ai_firewall.promotion-model';
import { readPromotionStates } from './promotion/ai_firewall.promotion.service';
import { modelPromotionView } from './promotion/ai_firewall.promotion-view';
import {
  ACTIVITY_CACHE_MS, ACTIVITY_WINDOWS, IP_BANS_LIMIT, SECURITY_EVENTS_LIMIT,
  type AiFirewallActivity, type IpBanView, type ModelStatusView, type SecurityActionCount, type SecurityEventView,
} from './ai_firewall.activity.types';

/**
 * Audit actions that other modules write as literals: the tenant session policy's geo anomaly (tenant_session.policy.ts) and the API
 * key verifier's failure and anomaly rows (api_key.verify.helpers.ts). Since phase 55 00.4 audit_log names them too (their severities
 * are reviewed there), so they are taken from AuditActions; this Core module still depends on neither writer.
 */
export const EXTERNAL_SECURITY_ACTIONS = [
  AuditActions.TENANT_SESSION_GEO_ANOMALY, AuditActions.API_KEY_VERIFY_FAILED, AuditActions.API_KEY_ANOMALY_DETECTED,
] as const;

/** The security actions the page counts and lists: every default alert rule's actions, then the refusals and anomalies, deduplicated. */
export const SECURITY_ACTIONS: readonly string[] = [...new Set<string>([
  ...SECURITY_ALERT_RULES.flatMap((r) => r.actions),
  AuditActions.PERMISSION_DENIED,
  AuditActions.AUTH_LOGIN_ANOMALY,
  AuditActions.GLOBAL_ADMIN_ACCESS,
  ...EXTERNAL_SECURITY_ACTIONS,
])];

const MODEL_NAMES: readonly ShippedModelName[] = ['behaviour', 'attack'];
const TARGET_MAX = 80;

export function modelStatus(name: ShippedModelName, result: ModelLoadResult): ModelStatusView {
  if (!result.ok) return { name, state: 'off', library: STAGE_LIBRARY[name], reason: result.reason, detail: result.detail };
  const { meta } = result;
  return {
    name, state: 'loaded', library: meta.library, libraryVersion: meta.libraryVersion, trainedAt: meta.trainedAt,
    catalogue: meta.catalogue, featureCount: result.ensemble.featureNames.length, classes: [...meta.classes],
  };
}

/** `resourceType:resourceId`, or the one that is set, cut to TARGET_MAX characters; null when neither is. */
export function shortTarget(resourceType: string | null | undefined, resourceId: string | null | undefined): string | null {
  const text = [resourceType, resourceId].filter((p): p is string => typeof p === 'string' && p.length > 0).join(':');
  if (!text) return null;
  return text.length > TARGET_MAX ? `${text.slice(0, TARGET_MAX - 1)}…` : text;
}

const iso = (value: Date | string | number): string => new Date(value).toISOString();

export function banView(ban: IpBan): IpBanView {
  return { bucket: ban.bucket, reason: ban.reason, offense: ban.offense, bannedAt: iso(ban.bannedAt), until: iso(ban.until), manual: ban.manual };
}

type LatestRow = Awaited<ReturnType<typeof AuditLogService.actionActivityCrossTenant>>['latest'][number];

export function eventView(row: LatestRow): SecurityEventView {
  return {
    id: row.auditLogId,
    createdAt: iso(row.createdAt),
    tenantId: row.tenantId,
    tenantName: row.tenant?.name ?? row.tenantId,
    action: row.action,
    severity: row.severity,
    actorType: row.actorType,
    actorId: row.actorId ?? null,
    ip: row.ipAddress ?? null,
    target: shortTarget(row.resourceType, row.resourceId),
  };
}

async function securitySection(now: Date): Promise<AiFirewallActivity['security']> {
  try {
    const actions = [...SECURITY_ACTIONS];
    const { counts, latest, skippedTenants } = await AuditLogService.actionActivityCrossTenant(ROOT_TENANT_ID, {
      actions,
      since: ACTIVITY_WINDOWS.map((w) => new Date(now.getTime() - w.ms)),
      latest: SECURITY_EVENTS_LIMIT,
      now,
    });
    const rows: SecurityActionCount[] = actions.map((action) => {
      const c = counts[action] ?? [];
      return { action, '15m': c[0] ?? 0, '1h': c[1] ?? 0, '24h': c[2] ?? 0 };
    });
    return {
      ok: true,
      data: { actions, counts: rows, events: latest.slice(0, SECURITY_EVENTS_LIMIT).map(eventView), skippedTenants },
    };
  } catch (err) {
    Logger.warn(`[ai_firewall] security activity unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: 'unavailable' };
  }
}

async function bansSection(): Promise<AiFirewallActivity['bans']> {
  try {
    const { items, truncated } = await IpStrikeService.listBans(IP_BANS_LIMIT);
    return { ok: true, data: { items: items.map(banView), limit: IP_BANS_LIMIT, truncated } };
  } catch (err) {
    Logger.warn(`[ai_firewall] ban list unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: 'unavailable' };
  }
}

async function readActivity(now: Date): Promise<AiFirewallActivity> {
  const loads = Object.fromEntries(MODEL_NAMES.map((name) => [name, loadShippedModel(name)])) as Record<ShippedModelName, ModelLoadResult>;
  const models = MODEL_NAMES.map((name) => modelStatus(name, loads[name]));
  const [states, policy, security, bans] = await Promise.all([
    readPromotionStates(),
    getFirewallActionPolicy(null),
    securitySection(now),
    bansSection(),
  ]);
  // 4.7 (FWD-12): promoted by the gate for the model file this process loaded, not held, re-checked lately (D55-128), the pair the
  // independence was measured on (D55-130); an unreadable store promotes nothing (FWA-7).
  const promoted = promotedStages(states, loads, now.getTime());
  const stage = (name: ShippedModelName) => ({ loaded: loads[name].ok, promoted: promoted[name] });
  const cascade = cascadeMode({ behaviour: stage('behaviour'), attack: stage('attack') }, { killSwitch: policy.killed !== null });
  const promotion: AiFirewallActivity['promotion'] = states
    ? { ok: true, data: { models: MODEL_NAMES.flatMap((name) => { const r = states.get(name); return r ? [modelPromotionView(r, now.getTime())] : []; }) } }
    : { ok: false, error: 'unavailable' };
  return { generatedAt: now.toISOString(), models, cascade, promotion, security, bans };
}

/** The shared read: its promise, and when it stops being served (set once it settles; a read still running is always shared). */
let cached: { read: Promise<AiFirewallActivity>; expiresAt: number } | null = null;

/** Forgets the shared read (tests; nothing in the application needs it). */
export function resetActivityCache(): void {
  cached = null;
}

export default class AiFirewallActivityService {
  /**
   * Everything the activity page shows. Never throws for a store that is down; the caller has already been authorised (GLOBAL).
   * Served from the shared read while it is younger than ACTIVITY_CACHE_MS (`now` is used only when a new read starts, and
   * `generatedAt` says when the served read was made). Expiry runs on the monotonic clock, so a wall-clock step neither keeps a read
   * forever nor drops it early.
   */
  static activity(now: Date = new Date()): Promise<AiFirewallActivity> {
    if (cached && performance.now() < cached.expiresAt) return cached.read;
    const entry: { read: Promise<AiFirewallActivity>; expiresAt: number } = { read: readActivity(now), expiresAt: Number.POSITIVE_INFINITY };
    cached = entry;
    entry.read.then(
      () => { entry.expiresAt = performance.now() + ACTIVITY_CACHE_MS; },
      () => { if (cached === entry) cached = null; },
    );
    return entry.read;
  }
}
