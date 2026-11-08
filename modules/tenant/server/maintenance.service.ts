import 'reflect-metadata';
import { compactWhere, containsText, dayRange, inList, toOrder } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { LessThanOrEqual, Between, IsNull, In } from 'typeorm';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import type { Repository } from 'typeorm';
import redis, { jitter, singleFlight } from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { type MaintenanceStatus } from './maintenance.enums';
import {
  sanitizeMaintenanceAllowRoles, sanitizeMaintenanceCacheTtl, sanitizeMaintenancePreNotifyHours,
} from './tenant.settings-policy';
import { emitMaintenanceEvent, type MaintenanceEventKind, type MaintenanceEventMeta } from './maintenance.events';
import { MaintenanceWindow as MaintenanceWindowEntity } from './entities/maintenance_window.entity';
import {
  MaintenanceWindowSchema, ActiveWindowSchema,
  type MaintenanceWindowView, type ActiveWindow,
  type CreateMaintenanceWindowDTO, type UpdateMaintenanceWindowDTO, type GetMaintenanceWindowsQuery, MAINTENANCE_SORTABLE,
} from './maintenance.dto';
import TenantMessages from './tenant.messages';
import MaintenanceMessages from './maintenance.messages';
import { isTimezone } from '@kuraykaraaslan-labs/common/server/common.timezone';

/**
 * Maintenance-window model + the HOT-PATH resolver the proxy gate calls on
 * every request. Two rules rule this file:
 *
 *  1. The resolver may not hit the DB per request — candidate windows are
 *     cached in Redis under two keys (system-wide, per-tenant) with a short
 *     TTL, and every mutation purges the keys it touched so a cancelled
 *     window stops gating IMMEDIATELY (never "TTL will get it eventually").
 *  2. Being time-active is computed at RESOLVE time, not cached: a SCHEDULED
 *     window activates the second `scheduledStart` passes, without waiting
 *     for a purge or for the (phase-2) scheduler to flip its status. The
 *     scheduler's later job is to make `status`/`actualStart` reflect
 *     reality and to notify — not to be the thing that turns the gate on.
 */

const SYSTEM_CACHE_KEY = 'maintenance:sys';
const tenantCacheKey = (tenantId: string) => `maintenance:t:${tenantId}`;

/**
 * Phase-4 settings knobs (Maintenance → Settings). Every read is dynamic-import
 * + try/catch and falls back to the constants through the sanitizers of
 * tenant.settings-policy.ts: an unset or broken setting can never disable
 * the gate, spam notifications, or lock an operator out.
 */
async function maintenanceSetting(tenantId: string, key: string): Promise<string | null> {
  try {
    const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service');
    return await SettingService.getValue(tenantId, key);
  } catch {
    return null;
  }
}

// The TTL knob sits on the cache-miss path, so it memoizes for a minute —
// tuning it is an operator action, not something that changes per request.
let _ttlMemo: { value: number; at: number } | null = null;
async function cacheTtlSeconds(): Promise<number> {
  if (_ttlMemo && Date.now() - _ttlMemo.at < 60_000) return _ttlMemo.value;
  const value = sanitizeMaintenanceCacheTtl(await maintenanceSetting(ROOT_TENANT_ID, 'maintenanceCacheTtlSeconds'));
  _ttlMemo = { value, at: Date.now() };
  return value;
}

async function preNotifyLeadHours(): Promise<number> {
  return sanitizeMaintenancePreNotifyHours(await maintenanceSetting(ROOT_TENANT_ID, 'maintenancePreNotifyHours'));
}

/** Explicit > per-tenant setting (root for SYSTEM) > constant. Never empty. */
async function defaultAllowRoles(tenantId: string | null): Promise<string[]> {
  return sanitizeMaintenanceAllowRoles(await maintenanceSetting(tenantId ?? ROOT_TENANT_ID, 'maintenanceDefaultAllowRoles'));
}

/** Candidate = could gate now or in the future; COMPLETED/CANCELLED never come back. */
const CANDIDATE_STATUSES = ['SCHEDULED', 'IN_PROGRESS'];

/** Exported for the console's "active now" read (41-ui-fixes/09 B3.2): the same rule the gate resolves with. */
export function isTimeActive(w: Pick<ActiveWindow, 'status' | 'scheduledStart' | 'scheduledEnd'>, now: Date): boolean {
  // IN_PROGRESS stays active past scheduledEnd on purpose: an operator who
  // force-started a window ends it explicitly (or the phase-2 scheduler
  // auto-ends it) — the gate must not silently lift mid-maintenance.
  if (w.status === 'IN_PROGRESS') return true;
  const start = new Date(w.scheduledStart);
  if (start > now) return false;
  return !w.scheduledEnd || new Date(w.scheduledEnd) > now;
}

/**
 * `*` is the only wildcard; patterns match the app-relative path exactly otherwise.
 *
 * A glob walk, not a regex (tenant.02, fixed 2026-10-20): the pattern is tenant-controlled and was compiled to `^…$` with
 * one `.*` per star, so stacked stars backtracked exponentially on every request. This matcher remembers only the last
 * star and its resume point, so it is O(pattern × path) at worst and linear in practice.
 */
export function matchesRoutePattern(patterns: string[] | null | undefined, path: string): boolean {
  if (!patterns?.length) return false;
  return patterns.some((p) => globMatch(p, path));
}

function globMatch(pattern: string, text: string): boolean {
  let p = 0; let t = 0; let star = -1; let resume = 0;
  while (t < text.length) {
    if (p < pattern.length && pattern[p] !== '*' && pattern[p] === text[t]) { p += 1; t += 1; }
    else if (p < pattern.length && pattern[p] === '*') { star = p; resume = t; p += 1; }
    else if (star !== -1) { p = star + 1; resume += 1; t = resume; }
    else return false;
  }
  while (p < pattern.length && pattern[p] === '*') p += 1;
  return p === pattern.length;
}

/**
 * Case- and space-insensitive role membership: rows written before allowRoles became a member-role enum may hold "admin"
 * or " admin" (1.5; trimmed since 41-ui-fixes/09 B1.2).
 */
const normRole = (r: string) => r.trim().toUpperCase();
function hasRole(roles: readonly string[], role: string | null | undefined): boolean {
  if (!role) return false;
  const wanted = normRole(role);
  return roles.some((r) => normRole(r) === wanted);
}

/** Two allow-lists that let the same roles through (order, case and spaces aside). */
function sameRoles(a: readonly string[], b: readonly string[]): boolean {
  const set = (l: readonly string[]) => [...new Set(l.map(normRole))].sort().join(',');
  return set(a) === set(b);
}

const sameList = (a: readonly string[] | null | undefined, b: readonly string[] | null | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const timeOf = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : null);

/**
 * Who is saving a window, as the routes authorized them (41-ui-fixes/09 B1.2). `userRole` carries the platform-admin
 * bypass the gate applies (`isAllowed`), `memberRole` the caller's role in the window's tenant.
 */
export interface MaintenanceCaller { memberRole?: string | null; userRole?: string | null }

// The console's own paths: a window gating any of them gates the operator's way back (the page, the list, an edit,
// End now). `*` patterns covering /admin or /api reach them; a ROUTE window on /shop/* does not.
const CONSOLE_ID_PLACEHOLDER = '00000000-0000-4000-8000-000000000000';
const consolePaths = (windowId: string) => [
  '/admin/maintenance',
  '/api/maintenance-windows',
  `/api/maintenance-windows/${windowId}`,
  `/api/maintenance-windows/${windowId}/end`,
];

/**
 * Refuses (409) a window that would 503 the caller's own console (41-ui-fixes/09 B1.2): an ADMIN saving allowRoles
 * ["OWNER"] used to get the downtime page on the very next request, End now included. Applies only when the window
 * reaches the console: TENANT and SYSTEM scope always (FULL blocks everything, READ_ONLY blocks the writes End and
 * Edit are), ROUTE scope when a pattern covers the console's paths. A canary share is no way out: the caller may fall
 * in it. Platform admins pass the gate anyway, so they are never refused.
 */
function assertKeepsCallerIn(
  w: { scope: string; routePatterns: string[] | null | undefined; allowRoles: readonly string[] },
  caller: MaintenanceCaller | undefined,
  windowId: string = CONSOLE_ID_PLACEHOLDER,
): void {
  if (!caller) return;
  if (caller.userRole === 'ADMIN') return;
  if (w.scope === 'ROUTE' && !consolePaths(windowId).some((p) => matchesRoutePattern(w.routePatterns, p))) return;
  if (hasRole(w.allowRoles, caller.memberRole)) return;
  throw new AppError(MaintenanceMessages.LOCKS_OUT_CALLER, 409, ErrorCode.CONFLICT);
}

/** The tenant's IANA zone for the start-day filter (41-ui-fixes/09 B4.5); UTC when unset or not a zone. */
async function tenantTimeZone(tenantId: string): Promise<string | undefined> {
  try {
    const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service');
    const zone = (await SettingService.getByKeys(tenantId, ['timezone']))?.timezone;
    return zone && isTimezone(zone) ? zone : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Maintenance windows live on the SYSTEM connection (like `tenants`): a SYSTEM
 * window has `tenantId = null` and gates every tenant, so no tenant block
 * could see it. Every read and write is a deliberate `withSystemRLS` block.
 */
function windows<T>(fn: (repo: Repository<MaintenanceWindowEntity>) => Promise<T>): Promise<T> {
  return withSystemRLS((qr) => fn(qr.manager.getRepository(MaintenanceWindowEntity)));
}

/** Statuses a window can still be edited or moved out of. */
const OPEN_STATUSES = ['SCHEDULED', 'IN_PROGRESS'];

async function loadCandidates(cacheKey: string, where: { tenantId: string | null }): Promise<ActiveWindow[]> {
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    try {
      return (JSON.parse(cached) as unknown[]).map((w) => ActiveWindowSchema.parse({
        ...(w as Record<string, unknown>),
        scheduledStart: new Date((w as { scheduledStart: string }).scheduledStart),
        scheduledEnd: (w as { scheduledEnd: string | null }).scheduledEnd ? new Date((w as { scheduledEnd: string }).scheduledEnd!) : null,
      }));
    } catch { await redis.del(cacheKey).catch(() => {}); }
  }
  return singleFlight(cacheKey, async () => {
    const rows = await windows((repo) => repo
      .createQueryBuilder('w')
      .where(where.tenantId === null ? 'w.tenantId IS NULL' : 'w.tenantId = :tenantId', where.tenantId === null ? {} : { tenantId: where.tenantId })
      .andWhere('w.status IN (:...statuses)', { statuses: CANDIDATE_STATUSES })
      .orderBy('w.scheduledStart', 'ASC')
      .getMany());
    const parsed = rows.map((r) => ActiveWindowSchema.parse(r));
    await redis.setex(cacheKey, jitter(await cacheTtlSeconds()), JSON.stringify(parsed)).catch(() => {});
    return parsed;
  });
}

export default class MaintenanceService {

  // ── Hot path ───────────────────────────────────────────────────────────────

  /**
   * The active window gating `path` for `tenantId`, or null. Priority: a
   * full freeze (SYSTEM, then TENANT scope) wins over a ROUTE window — the
   * broader outage is the one the user must hear about.
   *
   * Fail-open: a Redis/DB blip returns null. Maintenance is an operational
   * switch, not a security control — an infra hiccup must not 503 the world.
   */
  static async resolveMaintenance(tenantId: string, path: string): Promise<ActiveWindow | null> {
    try {
      const now = new Date();
      const [system, tenant] = await Promise.all([
        loadCandidates(SYSTEM_CACHE_KEY, { tenantId: null }),
        loadCandidates(tenantCacheKey(tenantId), { tenantId }),
      ]);
      const active = [...system, ...tenant].filter((w) => isTimeActive(w, now));
      return active.find((w) => w.scope !== 'ROUTE')
        ?? active.find((w) => w.scope === 'ROUTE' && matchesRoutePattern(w.routePatterns, path))
        ?? null;
    } catch (error) {
      Logger.warn(`[maintenance] resolve failed (fail-open) tenant=${tenantId}: ${error}`);
      return null;
    }
  }

  /**
   * The status-page bridge's read (phase 3): every candidate window that could
   * concern `tenantId` — system ∪ tenant, SCHEDULED or IN_PROGRESS — from the
   * same cache the gate uses. `observability` renders these; it holds no
   * window table of its own (single-source locked decision). Fail-open to an
   * empty list: a cache blip must not 500 a public status page.
   */
  static async candidatesFor(tenantId: string): Promise<ActiveWindow[]> {
    try {
      const [system, tenant] = await Promise.all([
        loadCandidates(SYSTEM_CACHE_KEY, { tenantId: null }),
        loadCandidates(tenantCacheKey(tenantId), { tenantId }),
      ]);
      return [...system, ...tenant];
    } catch (error) {
      Logger.warn(`[maintenance] candidatesFor failed (empty list) tenant=${tenantId}: ${error}`);
      return [];
    }
  }

  /**
   * The roles a window created without an explicit `allowRoles` lets through: the tenant's
   * `maintenanceDefaultAllowRoles` (ROOT's for a SYSTEM window, `tenantId` null), else `["OWNER","ADMIN"]`.
   * The console's create form starts with it.
   */
  static defaultAllowRoles(tenantId: string | null): Promise<string[]> {
    return defaultAllowRoles(tenantId);
  }

  /**
   * The windows gating `tenantId` right now (41-ui-fixes/09 B3.2): the gate's candidates and its time rule, on the
   * server clock, broadest first (SYSTEM, TENANT, then ROUTE) like the resolver. The console's banners read this
   * instead of guessing from a list page on the browser clock. Fail-open like `candidatesFor` (an empty list).
   */
  static async activeFor(tenantId: string, now: Date = new Date()): Promise<ActiveWindow[]> {
    const rank = { SYSTEM: 0, TENANT: 1, ROUTE: 2 } as const;
    return (await this.candidatesFor(tenantId))
      .filter((w) => isTimeActive(w, now))
      .sort((a, b) => rank[a.scope] - rank[b.scope]);
  }

  /**
   * The escape hatch: platform ADMINs always pass; members pass on `allowRoles`, compared case-insensitively — rows
   * saved before the roles became a member-role enum may hold "admin" (41-ui-fixes/09 B1.2).
   */
  static isAllowed(actor: { userRole?: string | null; memberRole?: string | null }, window: ActiveWindow): boolean {
    if (actor.userRole === 'ADMIN') return true;
    return hasRole(window.allowRoles, actor.memberRole);
  }

  /** Seconds for `Retry-After`. Open-ended windows give a coarse 1h hint. */
  static retryAfterSeconds(window: ActiveWindow, now: Date = new Date()): number {
    if (!window.scheduledEnd) return 3600;
    return Math.max(60, Math.ceil((new Date(window.scheduledEnd).getTime() - now.getTime()) / 1000));
  }

  // ── Writes (each purges exactly the cache keys it can have changed) ────────

  private static async purge(tenantId: string | null | undefined): Promise<void> {
    await redis.del(tenantId ? tenantCacheKey(tenantId) : SYSTEM_CACHE_KEY).catch(() => {});
  }

  /**
   * The lock-out guard on a stored window (41-ui-fixes/09 B1.2), for the moves that make it gate without an edit: Start
   * now used to put an OWNER-only window (or an old row whose roles match no member) live for an ADMIN, who then got the
   * downtime page, End now included. 409 when the window would shut `caller` out of the console.
   */
  static assertCallerKeptIn(
    w: Pick<MaintenanceWindowView, 'windowId' | 'scope' | 'routePatterns' | 'allowRoles'>, caller: MaintenanceCaller | undefined,
  ): void {
    assertKeepsCallerIn(w, caller, w.windowId);
  }

  /**
   * `caller` (the routes pass it): refuse a window that would lock the caller out, judged on the allow-roles it will
   * really have — the tenant default when the body left them out (41-ui-fixes/09 B1.2, B4.3).
   */
  static async createWindow(
    data: CreateMaintenanceWindowDTO, createdByUserId?: string, caller?: MaintenanceCaller,
  ): Promise<MaintenanceWindowView> {
    const allowRoles = data.allowRoles ?? await defaultAllowRoles(data.scope === 'SYSTEM' ? null : data.tenantId ?? null);
    assertKeepsCallerIn({ scope: data.scope, routePatterns: data.routePatterns, allowRoles }, caller);
    const saved = await windows((repo) => repo.save(repo.create({
      tenantId: data.scope === 'SYSTEM' ? null : data.tenantId,
      title: data.title,
      message: data.message ?? null,
      scope: data.scope,
      routePatterns: data.scope === 'ROUTE' ? data.routePatterns : null,
      status: 'SCHEDULED',
      mode: data.mode,
      percentage: data.percentage ?? null,
      scheduledStart: data.scheduledStart,
      scheduledEnd: data.scheduledEnd ?? null,
      allowRoles,
      createdByUserId: createdByUserId ?? null,
    })));
    await this.purge(saved.tenantId);
    const view = MaintenanceWindowSchema.parse(saved);
    void emitMaintenanceEvent('scheduled', view);
    return view;
  }

  /**
   * An edit: only the received keys are written, `null` clears (1.4). The merged window (stored values under the
   * patch) must still end after it starts (1.7), keep a pattern when it is a ROUTE window (1.8), and not lock `caller`
   * out (1.5). The lock-out check runs only when the patch changes who is gated (41-ui-fixes/09 B1.2): the roles, the
   * route patterns, the mode, the canary share, or times that put a window live that was not (scope is not editable).
   * A title or message edit of a window the caller is not in goes through: it changes nothing about the gate.
   */
  static async updateWindow(windowId: string, data: UpdateMaintenanceWindowDTO, caller?: MaintenanceCaller): Promise<MaintenanceWindowView> {
    const patch: Partial<MaintenanceWindowEntity> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.message !== undefined) patch.message = data.message;
    if (data.routePatterns !== undefined) patch.routePatterns = data.routePatterns;
    if (data.mode !== undefined) patch.mode = data.mode;
    if (data.percentage !== undefined) patch.percentage = data.percentage;
    if (data.scheduledStart !== undefined) patch.scheduledStart = data.scheduledStart;
    if (data.scheduledEnd !== undefined) patch.scheduledEnd = data.scheduledEnd;
    if (data.allowRoles !== undefined) patch.allowRoles = data.allowRoles;
    // Column-only and conditional on the window still being open: a whole-row
    // save of the stale read used to write `IN_PROGRESS` back over a window
    // that was just ended — re-raising the 503 gate that had been lifted.
    const saved = await windows(async (repo) => {
      const row = await repo.findOne({ where: { windowId } });
      if (!row) throw new AppError(TenantMessages.MAINTENANCE_WINDOW_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
      if (Object.keys(patch).length) {
        if (!OPEN_STATUSES.includes(row.status)) throw new AppError(TenantMessages.MAINTENANCE_WINDOW_CLOSED, 409, ErrorCode.CONFLICT);
        const merged = {
          scope: row.scope,
          routePatterns: patch.routePatterns !== undefined ? patch.routePatterns : row.routePatterns,
          scheduledStart: patch.scheduledStart ?? row.scheduledStart,
          scheduledEnd: patch.scheduledEnd !== undefined ? patch.scheduledEnd : row.scheduledEnd,
          allowRoles: patch.allowRoles ?? row.allowRoles,
        };
        if (merged.scheduledEnd && new Date(merged.scheduledEnd) <= new Date(merged.scheduledStart)) {
          throw new AppError(MaintenanceMessages.END_BEFORE_START, 400, ErrorCode.VALIDATION_ERROR);
        }
        if (merged.scope === 'ROUTE' && !merged.routePatterns?.length) {
          throw new AppError(MaintenanceMessages.ROUTE_PATTERNS_REQUIRED, 400, ErrorCode.VALIDATION_ERROR);
        }
        const now = new Date();
        type Timed = Parameters<typeof isTimeActive>[0];
        const liveNow = (w: { status: string; scheduledStart: Date; scheduledEnd?: Date | null }) => isTimeActive(w as Timed, now);
        const timesMoved = (patch.scheduledStart !== undefined && timeOf(patch.scheduledStart) !== timeOf(row.scheduledStart))
          || (patch.scheduledEnd !== undefined && timeOf(patch.scheduledEnd) !== timeOf(row.scheduledEnd));
        const decidesGate = (patch.allowRoles !== undefined && !sameRoles(patch.allowRoles, row.allowRoles))
          || (patch.routePatterns !== undefined && !sameList(patch.routePatterns, row.routePatterns))
          || (patch.mode !== undefined && patch.mode !== row.mode)
          || (patch.percentage !== undefined && (patch.percentage ?? null) !== (row.percentage ?? null))
          || (timesMoved && liveNow({ status: row.status, ...merged }) && !liveNow(row));
        if (decidesGate) assertKeepsCallerIn(merged, caller, windowId);
        const res = await repo.update({ windowId, status: In(OPEN_STATUSES) }, patch as never);
        if (!res.affected) throw new AppError(TenantMessages.MAINTENANCE_WINDOW_CLOSED, 409, ErrorCode.CONFLICT);
      } else if (!OPEN_STATUSES.includes(row.status)) {
        throw new AppError(TenantMessages.MAINTENANCE_WINDOW_CLOSED, 409, ErrorCode.CONFLICT);
      }
      return (await repo.findOne({ where: { windowId } }))!;
    });
    await this.purge(saved.tenantId);
    const view = MaintenanceWindowSchema.parse(saved);
    void emitMaintenanceEvent('updated', view);
    return view;
  }

  /** Force-start now (sets IN_PROGRESS + actualStart). Listeners hear it as `forced`: an unplanned start. */
  static async startWindow(windowId: string): Promise<MaintenanceWindowView> {
    return this.transition(windowId, ['SCHEDULED'], { status: 'IN_PROGRESS', actualStart: new Date() }, { forced: true });
  }

  /** End now (sets COMPLETED + actualEnd) — the gate lifts immediately. */
  static async endWindow(windowId: string): Promise<MaintenanceWindowView> {
    return this.transition(windowId, ['IN_PROGRESS', 'SCHEDULED'], { status: 'COMPLETED', actualEnd: new Date() });
  }

  static async cancelWindow(windowId: string): Promise<MaintenanceWindowView> {
    return this.transition(windowId, ['SCHEDULED', 'IN_PROGRESS'], { status: 'CANCELLED', actualEnd: new Date() });
  }

  private static async transition(
    windowId: string, from: string[], patch: Partial<MaintenanceWindowEntity>, meta: MaintenanceEventMeta = {},
  ): Promise<MaintenanceWindowView> {
    // A conditional move: of an end and a cancel racing each other (or two
    // clicks), exactly one lands and emits its event.
    const saved = await windows(async (repo) => {
      const res = await repo.update({ windowId, status: In(from) }, patch as never);
      const row = await repo.findOne({ where: { windowId } });
      if (!row) throw new AppError(TenantMessages.MAINTENANCE_WINDOW_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
      if (!res.affected) throw new AppError(TenantMessages.MAINTENANCE_WINDOW_INVALID_TRANSITION, 409, ErrorCode.CONFLICT);
      return row;
    });
    await this.purge(saved.tenantId);
    const view = MaintenanceWindowSchema.parse(saved);
    const kind: MaintenanceEventKind =
      saved.status === 'IN_PROGRESS' ? 'started' : saved.status === 'COMPLETED' ? 'ended' : 'cancelled';
    void emitMaintenanceEvent(kind, view, meta);
    return view;
  }

  // ── Scheduler tick (phase 2) ───────────────────────────────────────────────

  /**
   * One scheduler pass: make `status`/`actualStart`/`actualEnd` reflect what
   * the resolve-time gate has already been enforcing, auto-end force-started
   * windows, and send the single advance notice. The gate never waits for
   * this — a dead scheduler delays bookkeeping and notifications, not the 503
   * (and not the lift: a SCHEDULED window past `scheduledEnd` is inactive at
   * resolve time regardless).
   */
  static async tick(now: Date = new Date()): Promise<{ started: number; completed: number; preNotified: number }> {
    let started = 0, completed = 0, preNotified = 0;
    // Every step is a conditional update on the status the window was read
    // in: a manual end/cancel landing between the read and the write wins
    // (the tick used to save IN_PROGRESS over a cancelled window), and two
    // scheduler instances ticking together move — and announce — a window once.

    // Due starts. A window that fully elapsed while the scheduler was down
    // goes straight to COMPLETED with the times the gate actually enforced
    // (it gated from scheduledStart and lifted at scheduledEnd on its own).
    const dueStart = await windows((repo) => repo.find({ where: { status: 'SCHEDULED', scheduledStart: LessThanOrEqual(now) } }));
    for (const w of dueStart) {
      const elapsed = !!w.scheduledEnd && new Date(w.scheduledEnd) <= now;
      const patch: Partial<MaintenanceWindowEntity> = elapsed
        ? { status: 'COMPLETED', actualStart: w.scheduledStart, actualEnd: w.scheduledEnd }
        : { status: 'IN_PROGRESS', actualStart: w.scheduledStart };
      const res = await windows((repo) => repo.update({ windowId: w.windowId, status: 'SCHEDULED' }, patch as never));
      if (!res.affected) continue;
      if (elapsed) completed++; else started++;
      Object.assign(w, patch);
      await this.purge(w.tenantId);
      void emitMaintenanceEvent(elapsed ? 'ended' : 'started', MaintenanceWindowSchema.parse(w));
    }

    // The auto-end — the "forgotten maintenance" defence. IN_PROGRESS kept
    // gating until this very moment (by design), so actualEnd is NOW, not
    // scheduledEnd.
    const dueEnd = await windows((repo) => repo.find({ where: { status: 'IN_PROGRESS', scheduledEnd: LessThanOrEqual(now) } }));
    for (const w of dueEnd) {
      const res = await windows((repo) => repo.update({ windowId: w.windowId, status: 'IN_PROGRESS' }, { status: 'COMPLETED', actualEnd: now } as never));
      if (!res.affected) continue;
      w.status = 'COMPLETED'; w.actualEnd = now;
      await this.purge(w.tenantId);
      void emitMaintenanceEvent('ended', MaintenanceWindowSchema.parse(w));
      completed++;
    }

    // One advance notice per window; `preNotifiedAt` is the idempotency
    // marker and is claimed (conditionally) BEFORE notifying, so a crashing
    // notifier can not re-spam every minute and two ticks notify once. Due
    // starts ran first, so anything still SCHEDULED here genuinely lies in the future.
    const horizon = new Date(now.getTime() + (await preNotifyLeadHours()) * 3_600_000);
    const dueNotice = await windows((repo) => repo.find({
      where: { status: 'SCHEDULED', preNotifiedAt: IsNull(), scheduledStart: Between(now, horizon) },
    }));
    for (const w of dueNotice) {
      const res = await windows((repo) => repo.update({ windowId: w.windowId, preNotifiedAt: IsNull() }, { preNotifiedAt: now } as never));
      if (!res.affected) continue;
      w.preNotifiedAt = now;
      // The reminder to the users of the window's scope, on the channels its notice names (announcement, docs/phases/47-announcements B).
      await emitMaintenanceEvent('reminder', MaintenanceWindowSchema.parse(w)).catch((error) =>
        Logger.warn(`[maintenance] pre-notice for ${w.windowId} failed: ${error}`));
      preNotified++;
    }

    return { started, completed, preNotified };
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  static async getWindow(windowId: string): Promise<MaintenanceWindowView> {
    const row = await windows((repo) => repo.findOne({ where: { windowId } }));
    if (!row) throw new AppError(TenantMessages.MAINTENANCE_WINDOW_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    return MaintenanceWindowSchema.parse(row);
  }

  static async listWindows(
    query: Pick<GetMaintenanceWindowsQuery, 'page' | 'pageSize'> & Partial<Omit<GetMaintenanceWindowsQuery, 'page' | 'pageSize' | 'status'>>
      & { status?: GetMaintenanceWindowsQuery['status'] | MaintenanceStatus },
  ): Promise<{ data: MaintenanceWindowView[]; total: number }> {
    const statuses = query.status === undefined ? undefined : Array.isArray(query.status) ? query.status : [query.status];
    const base: Record<string, unknown> = compactWhere({
      status: statuses?.length === 1 ? statuses[0] : inList(statuses),
      scope: inList(query.scope),
      mode: inList(query.mode),
      // 41-ui-fixes/09 B4.5: "starts on 1 March" means the tenant's 1 March, not UTC's.
      scheduledStart: dayRange(query.startFrom, query.startTo, (query.startFrom || query.startTo) && query.tenantId
        ? await tenantTimeZone(query.tenantId)
        : undefined),
    });
    // A SYSTEM window gates every tenant, so the tenant's console must list it
    // too (read-only there) — includeSystem adds the tenantId IS NULL branch.
    const branches: Record<string, unknown>[] = query.tenantId
      ? (query.includeSystem
        ? [{ ...base, tenantId: query.tenantId }, { ...base, tenantId: IsNull() }]
        : [{ ...base, tenantId: query.tenantId }])
      : [base];
    // phase 43: a search over title and message; every branch keeps the tenant condition above
    const where = query.search
      ? branches.flatMap((b) => [{ ...b, title: containsText(query.search!) }, { ...b, message: containsText(query.search!) }])
      : branches.length === 1 ? branches[0] : branches;
    const [rows, total] = await windows((repo) => repo.findAndCount({
      where: where as never,
      order: toOrder(query.sort ?? [{ field: 'scheduledStart', dir: 'desc' }], MAINTENANCE_SORTABLE, { windowId: 'ASC' }, MaintenanceWindowEntity) as never,
      skip: query.page * query.pageSize, take: query.pageSize,
    }));
    return { data: rows.map((r) => MaintenanceWindowSchema.parse(r)), total };
  }

}
