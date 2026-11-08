import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { IsNull, LessThanOrEqual } from 'typeorm';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { isReservedTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { Tenant as TenantEntity } from './entities/tenant.entity';
import { clearCache } from './tenant.helpers';
import { recordLifecycle } from './tenant.extension-points';

/**
 * How a legal hold is set and lifted on the node (docs/phases/02-fleet/decisions-2026-10-18.md F19). The node is the source of truth: a hold
 * originates with in-region legal authority, and the fleet directory only mirrors the receipts this file reports.
 *
 * Who may act ("authority"):
 *  - `CONTROL_PLANE`: the directory's signed commands. `tenant.hold.set` (class 2) places or extends a hold; `tenant.hold.clear` (class 3, co-signed)
 *    lifts any hold;
 *  - `REGIONAL_OPERATOR`: a node-local order by the region's operator (an admin of the node's root tenant, step-up, audited);
 *  - `TENANT_DPO`: a node-local order by the tenant's own data protection officer (step-up, audited).
 *
 * Tighten-only: anyone with authority may place a hold or move its end LATER; nobody shortens one. Lifting early needs the control plane's class 3,
 * or the same node-local authority that set the hold. When a second authority extends a hold another one set, the hold becomes `MIXED` and only
 * class 3 lifts it, so extending a hold can never be a way to take it over and then lift it. A hold that simply runs out is cleared by the sweep
 * (`expireLegalHolds`), which reports it like a lift. Every change is reported to the lifecycle sinks (`LEGAL_HOLD_SET` / `LEGAL_HOLD_CLEARED`,
 * the fleet agent's receipts) with G-class payload only: the end as unix seconds and the sha256 of the reason, never the reason itself.
 */
export const LEGAL_HOLD_AUTHORITIES = ['CONTROL_PLANE', 'REGIONAL_OPERATOR', 'TENANT_DPO'] as const;
export type LegalHoldAuthority = (typeof LEGAL_HOLD_AUTHORITIES)[number];
/** What `tenants.legalHoldOrigin` may hold: an authority, or MIXED once two of them stand behind the same hold. */
export const LEGAL_HOLD_ORIGINS = [...LEGAL_HOLD_AUTHORITIES, 'MIXED'] as const;
export type LegalHoldOrigin = (typeof LEGAL_HOLD_ORIGINS)[number];

/** The latest end a hold may be given (a longer one is a new order when this one runs out). */
export const MAX_LEGAL_HOLD_DAYS = 3660;
export const LEGAL_HOLD_REASON_MAX = 500;

export interface LegalHoldState {
  legalHoldUntil?: Date | null;
  legalHoldReason?: string | null;
  legalHoldOrigin?: string | null;
}

export type HoldSetDecision =
  | { ok: true; noop: false; origin: LegalHoldOrigin; extended: boolean }
  | { ok: true; noop: true }
  | { ok: false; reason: 'IN_PAST' | 'TOO_FAR' | 'SHORTER' };

export type HoldClearDecision = { ok: true; noop: boolean } | { ok: false; reason: 'NOT_AUTHORITY' };

const isActive = (s: LegalHoldState, now: Date): s is LegalHoldState & { legalHoldUntil: Date } =>
  !!s.legalHoldUntil && s.legalHoldUntil.getTime() > now.getTime();

/** Whether `by` may hold the tenant until `until` (pure). An equal end, from any authority, is a repeat: nothing to write. */
export function decideHoldSet(cur: LegalHoldState, i: { by: LegalHoldAuthority; until: Date; now: Date }): HoldSetDecision {
  if (!(i.until.getTime() > i.now.getTime())) return { ok: false, reason: 'IN_PAST' };
  if (i.until.getTime() > i.now.getTime() + MAX_LEGAL_HOLD_DAYS * 86_400_000) return { ok: false, reason: 'TOO_FAR' };
  if (!isActive(cur, i.now)) return { ok: true, noop: false, origin: i.by, extended: false };
  if (i.until.getTime() < cur.legalHoldUntil.getTime()) return { ok: false, reason: 'SHORTER' };
  // an equal end extends nothing, whoever sends it: the hold, its origin and its reason stay, so a repeat by another authority can neither turn it
  // MIXED (and take the lift away from the authority that set it) nor replace its reference
  if (i.until.getTime() === cur.legalHoldUntil.getTime()) return { ok: true, noop: true };
  const origin: LegalHoldOrigin = cur.legalHoldOrigin === i.by ? i.by : 'MIXED';
  return { ok: true, noop: false, origin, extended: true };
}

/**
 * Whether `by` may lift the hold now (pure). The control plane's class 3 lifts any hold; a node-local authority only the hold it set alone. A hold
 * with no recorded origin (placed before origins existed) is the control plane's to lift. No hold in force: nothing to do.
 */
export function decideHoldClear(cur: LegalHoldState, i: { by: LegalHoldAuthority; now: Date }): HoldClearDecision {
  if (!isActive(cur, i.now)) return { ok: true, noop: true };
  if (i.by === 'CONTROL_PLANE' || cur.legalHoldOrigin === i.by) return { ok: true, noop: false };
  return { ok: false, reason: 'NOT_AUTHORITY' };
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** The receipt payload of a placed hold: G only (its end as unix seconds, the hash of its reason). */
export function holdSetPayload(until: Date, reason: string): { counts: { UNTIL: number }; hashes: { REASON: string } } {
  return { counts: { UNTIL: Math.floor(until.getTime() / 1000) }, hashes: { REASON: sha256(reason) } };
}

export type SetLegalHoldResult =
  | { ok: true; outcome: 'SET' | 'EXTENDED' | 'UNCHANGED'; until: Date; origin: LegalHoldOrigin }
  | { ok: false; reason: 'NOT_FOUND' | 'RESERVED' | 'BAD_REASON' | 'IN_PAST' | 'TOO_FAR' | 'SHORTER' };

export type ClearLegalHoldResult =
  | { ok: true; outcome: 'CLEARED' | 'NO_HOLD' }
  | { ok: false; reason: 'NOT_FOUND' | 'RESERVED' | 'BAD_REASON' | 'NOT_AUTHORITY' };

export interface LegalHoldActor {
  by: LegalHoldAuthority;
  /** The acting user of a node-local order; null for a control-plane command. */
  actorId?: string | null;
  /** The command that carried a control-plane order (its jti). */
  commandJti?: string;
}

/** The audit row of a hold change in the tenant's own chain (best-effort: an audit outage never undoes a hold). `actor` null: the sweep. */
function audit(tenantId: string, actor: LegalHoldActor | null, action: string, metadata: Record<string, unknown>): void {
  AuditLogService.log({
    tenantId,
    actorId: actor?.actorId ?? null,
    actorType: actor?.actorId ? 'USER' : 'SYSTEM',
    action,
    resourceType: 'Tenant',
    resourceId: tenantId,
    metadata: { ...(actor ? { authority: actor.by } : {}), ...(actor?.commandJti ? { commandJti: actor.commandJti } : {}), ...metadata },
  }).catch(() => { /* audit failure must not undo the hold */ });
}

const cleanReason = (r: string): string | null => {
  const t = r.trim();
  return t.length >= 2 && t.length <= LEGAL_HOLD_REASON_MAX ? t : null;
};

/**
 * Places or extends a hold, under the tenant row's lock (two orders at once are decided one after the other). Reports `LEGAL_HOLD_SET` and audits
 * when something changed; a repeat (same end, any authority) changes nothing and reports nothing.
 */
export async function setLegalHold(tenantId: string, i: LegalHoldActor & { until: Date; reason: string; now?: Date }): Promise<SetLegalHoldResult> {
  if (isReservedTenant(tenantId)) return { ok: false, reason: 'RESERVED' };
  const reason = cleanReason(i.reason);
  if (!reason) return { ok: false, reason: 'BAD_REASON' };
  const now = i.now ?? new Date();
  // the end is kept to the second: the receipt states it in unix seconds, and a repeat must compare equal
  const until = new Date(Math.floor(i.until.getTime() / 1000) * 1000);
  const r = await withSystemRLS(async (qr): Promise<SetLegalHoldResult> => {
    const repo = qr.manager.getRepository(TenantEntity);
    const t = await repo.findOne({ where: { tenantId, deletedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
    if (!t) return { ok: false, reason: 'NOT_FOUND' };
    const d = decideHoldSet(t, { by: i.by, until, now });
    if (!d.ok) return d;
    if (d.noop) return { ok: true, outcome: 'UNCHANGED', until, origin: t.legalHoldOrigin as LegalHoldOrigin };
    await repo.update({ tenantId }, { legalHoldUntil: until, legalHoldReason: reason, legalHoldOrigin: d.origin });
    return { ok: true, outcome: d.extended ? 'EXTENDED' : 'SET', until, origin: d.origin };
  });
  if (!r.ok || r.outcome === 'UNCHANGED') return r;
  await clearCache(tenantId);
  audit(tenantId, i, 'tenant.legal_hold.set', { until: until.toISOString(), origin: r.origin, outcome: r.outcome, reason });
  await recordLifecycle({ tenantId, type: 'LEGAL_HOLD_SET', occurredAt: now, payload: { ...(i.commandJti ? { commandJti: i.commandJti } : {}), ...holdSetPayload(until, reason) } });
  return r;
}

/** Lifts a hold early, under the row lock, when `by` may (see `decideHoldClear`). Reports `LEGAL_HOLD_CLEARED` and audits. */
export async function clearLegalHold(tenantId: string, i: LegalHoldActor & { reason: string; now?: Date }): Promise<ClearLegalHoldResult> {
  if (isReservedTenant(tenantId)) return { ok: false, reason: 'RESERVED' };
  const reason = cleanReason(i.reason);
  if (!reason) return { ok: false, reason: 'BAD_REASON' };
  const now = i.now ?? new Date();
  const r = await withSystemRLS(async (qr): Promise<ClearLegalHoldResult & { prior?: LegalHoldState }> => {
    const repo = qr.manager.getRepository(TenantEntity);
    const t = await repo.findOne({ where: { tenantId, deletedAt: IsNull() }, lock: { mode: 'pessimistic_write' } });
    if (!t) return { ok: false, reason: 'NOT_FOUND' };
    const d = decideHoldClear(t, { by: i.by, now });
    if (!d.ok) return d;
    if (d.noop) return { ok: true, outcome: 'NO_HOLD' };
    await repo.update({ tenantId }, { legalHoldUntil: null, legalHoldReason: null, legalHoldOrigin: null });
    return { ok: true, outcome: 'CLEARED', prior: { legalHoldUntil: t.legalHoldUntil, legalHoldOrigin: t.legalHoldOrigin } };
  });
  if (!r.ok || r.outcome !== 'CLEARED') return r.ok ? { ok: true, outcome: r.outcome } : r;
  await clearCache(tenantId);
  audit(tenantId, i, 'tenant.legal_hold.cleared', { priorUntil: r.prior?.legalHoldUntil?.toISOString() ?? null, priorOrigin: r.prior?.legalHoldOrigin ?? null, reason });
  await recordLifecycle({ tenantId, type: 'LEGAL_HOLD_CLEARED', occurredAt: now, payload: { ...(i.commandJti ? { commandJti: i.commandJti } : {}), hashes: { REASON: sha256(reason) } } });
  return { ok: true, outcome: 'CLEARED' };
}

/** The hold columns of one tenant, for the node-local page (null when there is no such tenant). An expired hold reads as none. */
export async function getLegalHold(tenantId: string, now: Date = new Date()): Promise<{ until: Date | null; reason: string | null; origin: LegalHoldOrigin | null } | null> {
  const t = await withSystemRLS((qr) => qr.manager.getRepository(TenantEntity).findOne({
    where: { tenantId, deletedAt: IsNull() }, select: { tenantId: true, legalHoldUntil: true, legalHoldReason: true, legalHoldOrigin: true },
  }));
  if (!t) return null;
  if (!isActive(t, now)) return { until: null, reason: null, origin: null };
  return { until: t.legalHoldUntil, reason: t.legalHoldReason ?? null, origin: (t.legalHoldOrigin as LegalHoldOrigin | null) ?? null };
}

/**
 * The sweep's step: clears every hold whose end has passed and reports each as `LEGAL_HOLD_CLEARED` (payload `counts.EXPIRED = 1`), so the directory's
 * mirror follows a hold that ran out exactly like one that was lifted. Each row is re-read under its lock, so a hold extended meanwhile stays.
 * Answers how many it cleared.
 */
export async function expireLegalHolds(now: Date = new Date(), limit = 200): Promise<number> {
  const due = await withSystemRLS((qr) => qr.manager.getRepository(TenantEntity).find({
    where: { legalHoldUntil: LessThanOrEqual(now), deletedAt: IsNull() }, select: { tenantId: true }, take: limit,
  }));
  let cleared = 0;
  for (const { tenantId } of due) {
    const done = await withSystemRLS(async (qr) => {
      const repo = qr.manager.getRepository(TenantEntity);
      const t = await repo.findOne({ where: { tenantId }, lock: { mode: 'pessimistic_write' } });
      if (!t?.legalHoldUntil || t.legalHoldUntil.getTime() > now.getTime()) return false;
      await repo.update({ tenantId }, { legalHoldUntil: null, legalHoldReason: null, legalHoldOrigin: null });
      return true;
    });
    if (!done) continue;
    cleared++;
    await clearCache(tenantId);
    audit(tenantId, null, 'tenant.legal_hold.expired', {});
    if (!isReservedTenant(tenantId)) await recordLifecycle({ tenantId, type: 'LEGAL_HOLD_CLEARED', occurredAt: now, payload: { counts: { EXPIRED: 1 } } });
  }
  return cleared;
}
