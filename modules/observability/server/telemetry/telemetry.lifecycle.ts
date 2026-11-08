/**
 * Per-tenant retention and erasure (phase 17.5) on top of the port's capability flags. What a backend cannot do is an explicit 501 from the
 * adapter, never a silent success. Erasure is irreversible, so it needs the workspace id typed back (`confirm`), and every erasure and
 * retention change is written to the audit log.
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { TelemetryUnsupportedError, type TelemetryBackend } from './telemetry.backend';
import { OBSERVABILITY_LIMIT_KEYS } from '../observability.limit-keys';
import { limitOf } from '../observability.limits';
import { refusalDetails, refusalForLimit } from '../observability.refusals';
import { EraseInputSchema, RetentionInputSchema } from './telemetry.dto';
import { TELEMETRY_SETTING_KEYS } from './telemetry.setting.keys';
import { publishTailEnd } from './telemetry.tail.realtime';
import type { BackendCapabilities, DeleteResult, RetentionPolicy, Signal } from './telemetry.types';

/** The limit key that caps each signal's retention (its own key; the general key is the fallback). */
const SIGNAL_RETENTION_KEYS: Record<Signal, string> = {
  logs: OBSERVABILITY_LIMIT_KEYS.TELEMETRY_RETENTION_DAYS_LOGS,
  traces: OBSERVABILITY_LIMIT_KEYS.TELEMETRY_RETENTION_DAYS_TRACES,
  metrics: OBSERVABILITY_LIMIT_KEYS.TELEMETRY_RETENTION_DAYS_METRICS,
};

/**
 * What the plan lets this tenant keep, per signal: the smaller of the signal's own cap and the general cap, and the key that is responsible for the
 * answer (so a refusal names the number the tenant can actually ask the operator to raise). `Infinity` = no plan declared one.
 */
export async function retentionCaps(tenantId: string): Promise<Record<Signal, { limit: number; key: string }>> {
  const general = await limitOf(tenantId, OBSERVABILITY_LIMIT_KEYS.TELEMETRY_RETENTION_DAYS);
  const out = {} as Record<Signal, { limit: number; key: string }>;
  for (const signal of ['logs', 'traces', 'metrics'] as const) {
    const own = await limitOf(tenantId, SIGNAL_RETENTION_KEYS[signal]);
    out[signal] = own <= general ? { limit: own, key: SIGNAL_RETENTION_KEYS[signal] } : { limit: general, key: OBSERVABILITY_LIMIT_KEYS.TELEMETRY_RETENTION_DAYS };
  }
  return out;
}

/**
 * The days a stored retention must be cut to when the plan's caps are lower than what was set before (a downgrade). Pure: the retention job applies the
 * result to the backend. `null` = nothing to change.
 */
export function clampRetentionDays(stored: RetentionPolicy['days'], caps: Record<Signal, { limit: number }>): RetentionPolicy['days'] | null {
  let changed = false;
  const next: RetentionPolicy['days'] = {};
  for (const signal of ['logs', 'traces', 'metrics'] as const) {
    const d = stored[signal];
    if (typeof d !== 'number') continue;
    const cap = caps[signal].limit;
    if (Number.isFinite(cap) && d > cap) { next[signal] = Math.max(1, Math.floor(cap)); changed = true; } else next[signal] = d;
  }
  return changed ? next : null;
}

/**
 * Daily, from the retention sweep: a tenant whose plan was lowered keeps what it set, but the backend must not keep more than the plan allows. The
 * stored setting is rewritten to the clamped numbers and the backend is told. A backend that cannot hold a per-tenant retention is left alone (501 is
 * the backend's own answer at set time; here it is simply "nothing to enforce").
 */
export async function reconcileRetentionWithPlan(backend: TelemetryBackend | null, tenantId: string): Promise<{ changed: boolean }> {
  if (!backend || !backend.capabilities.perTenantRetention || !backend.setRetention) return { changed: false };
  const view = await getLifecycle(backend, tenantId);
  if (!view.retention) return { changed: false };
  const next = clampRetentionDays(view.retention.days, await retentionCaps(tenantId));
  if (!next) return { changed: false };
  await backend.setRetention(tenantId, { days: next });
  await SettingService.create(tenantId, TELEMETRY_SETTING_KEYS.RETENTION, JSON.stringify({ days: next, updatedAt: new Date().toISOString() }), 'observability', 'json');
  await audit(tenantId, undefined, 'observability.telemetry.retention_clamped', { from: view.retention.days, to: next });
  return { changed: true };
}

export interface LifecycleView {
  backend: string;
  capabilities: BackendCapabilities;
  retention: (RetentionPolicy & { updatedAt: string }) | null;
}

async function audit(tenantId: string, actorId: string | undefined, action: string, metadata: Record<string, unknown>): Promise<void> {
  const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
  // Best effort like every other operator action: the change has already happened.
  await AuditLogService.log({ tenantId, ...(actorId ? { actorId } : {}), actorType: 'USER', action, resourceType: 'telemetry', resourceId: tenantId, metadata }).catch(() => {});
}

export async function getLifecycle(backend: TelemetryBackend, tenantId: string): Promise<LifecycleView> {
  let retention: LifecycleView['retention'] = null;
  try {
    const raw = await SettingService.getValue(tenantId, TELEMETRY_SETTING_KEYS.RETENTION);
    const doc = raw ? (JSON.parse(raw) as { days?: RetentionPolicy['days']; updatedAt?: string }) : null;
    if (doc?.days && typeof doc.updatedAt === 'string') retention = { days: doc.days, updatedAt: doc.updatedAt };
  } catch { /* a malformed stored value reads as "none set" */ }
  return { backend: backend.id, capabilities: backend.capabilities, retention };
}

export async function setRetention(backend: TelemetryBackend, tenantId: string, actorId: string | undefined, input: unknown): Promise<LifecycleView> {
  const dto = RetentionInputSchema.parse(input);
  if (!backend.capabilities.perTenantRetention || !backend.setRetention) throw new TelemetryUnsupportedError('per-tenant retention', backend.id);
  // The plan bounds how long telemetry may be kept, per signal (a signal's own key, then the general one: the smaller declared number wins);
  // asking for more is refused with the number, not silently shortened.
  const caps = await retentionCaps(tenantId);
  const over = (Object.entries(dto.days) as Array<[Signal, number | undefined]>).find(([signal, d]) => typeof d === 'number' && d > caps[signal].limit);
  if (over) {
    const cap = caps[over[0]];
    throw new AppError(`Your plan keeps ${over[0]} for at most ${cap.limit} days.`, 403, ErrorCode.FORBIDDEN, {
      details: { key: cap.key, limit: cap.limit, signal: over[0], requested: over[1], ...refusalDetails(refusalForLimit(cap.key)) },
    });
  }
  await backend.setRetention(tenantId, { days: dto.days });
  const stored = { days: dto.days, updatedAt: new Date().toISOString() };
  await SettingService.create(tenantId, TELEMETRY_SETTING_KEYS.RETENTION, JSON.stringify(stored), 'observability', 'json', actorId ? { actorId } : undefined);
  await audit(tenantId, actorId, 'observability.telemetry.retention_set', { days: dto.days });
  return { backend: backend.id, capabilities: backend.capabilities, retention: stored };
}

export async function eraseTenantData(backend: TelemetryBackend, tenantId: string, actorId: string | undefined, input: unknown): Promise<DeleteResult> {
  const dto = EraseInputSchema.parse(input);
  // The confirmation must be THIS workspace's id: a stale tab or a copied request for another workspace cannot erase this one.
  if (dto.confirm !== tenantId) throw new AppError('The confirmation does not match this workspace', 400, ErrorCode.VALIDATION_ERROR);
  if (backend.capabilities.deletion === 'none' || !backend.deleteTenantData) throw new TelemetryUnsupportedError('erasing telemetry', backend.id);
  const result = await backend.deleteTenantData(tenantId, dto.signals);
  // A live tail of erased logs must not keep streaming what was just removed (best effort, the gateway is optional).
  if (!dto.signals || dto.signals.includes('logs')) void publishTailEnd(tenantId, 'erased');
  await audit(tenantId, actorId, 'observability.telemetry.erased', { signals: dto.signals ?? 'all', state: result.state, ...(result.removed !== undefined ? { removed: result.removed } : {}) });
  return result;
}

/** Erase everything of a purged tenant: no confirmation (the purge cascade is the authority), no audit row in the tenant being deleted. */
export async function purgeTenantTelemetry(backend: TelemetryBackend | null, tenantId: string): Promise<DeleteResult | null> {
  if (!backend || backend.capabilities.deletion === 'none' || !backend.deleteTenantData) return null;
  const result = await backend.deleteTenantData(tenantId, backend.capabilities.deletableSignals);
  void publishTailEnd(tenantId, 'erased');
  return result;
}
