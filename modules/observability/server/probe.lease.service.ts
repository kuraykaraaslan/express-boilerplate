import 'reflect-metadata'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { IsNull, MoreThan } from 'typeorm'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { env } from '@kuraykaraaslan-labs/env'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { decryptFieldOpt } from '@kuraykaraaslan-labs/common/server/field-encryption'
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { Monitor } from './entities/monitor.entity'
import { ProbeLease } from './entities/probe_lease.entity'
import { ProbeLocation } from './entities/probe_location.entity'
import CheckDetailService from './uptime.check-detail.service'
import { browserHosts } from './uptime.browser.schema'
import { browserChecksEnabled } from './observability.browser.gate'
import type { ProbeRunner } from './entities/probe_runner.entity'
import MonitorService from './uptime.monitor.service'
import ProbeLocationService, { browserEligibleOf } from './probe.location.service'
import { runnerCanBrowse } from './probe.runner.service'
import { normalisePolicy, privateTargetAllowed, publicTargetCheck, targetHost, type TargetPolicy } from './probe.policy'
import type { LocationStates } from './probe.quorum'
import { runnerSkew, MIN_SUPPORTED_RUNNER } from './probe.version'
import { interleave } from './observability.fairness'
import { limitOf } from './observability.limits'
import { OBSERVABILITY_LIMIT_KEYS } from './observability.limit-keys'
import { byPriority, effectiveCap, fairShare, rankOf, roomUnder } from './probe.caps'
import { recordShed } from './probe.shed'

/**
 * Leasing checks to runners and accepting their results (observability phase 10.2 and 10.3).
 *
 * A runner PULLS: it asks which checks of its location are due and receives a lease for each (a visibility timeout, at-least-once). It later posts
 * one result per lease. A result is accepted only against a lease that is the sender's, unexpired and not yet consumed; the lease is consumed by the
 * first accepted result, so a replayed or forged result writes nothing. The lease id is the idempotency key.
 */
export const MAX_LEASES_PER_POLL = 50
export const LEASE_GRACE_MS = 30_000
const PER_TENANT_PER_POLL = 10
/** A browser run starts a process before the first step: its lease is that much longer than the monitor's own budget. */
export const BROWSER_LAUNCH_ALLOWANCE_MS = 20_000
/** Browser checks one poll may hand out, whatever the runner asks for: a browser is the expensive thing here, so a poll never fans out. */
export const MAX_BROWSER_LEASES_PER_POLL = 4
/** Browser checks of ONE tenant in one poll: a tenant with many browser monitors cannot occupy every slot of a shared (public) runner. */
const BROWSER_PER_TENANT_PER_POLL = 2

export interface LeasedCheck {
  leaseId: string
  tenantId: string
  monitorId: string
  locationKey: string
  /** When the lease stops being valid; a result after this is refused. */
  deadline: string
  check: {
    type: string; target: string; timeoutMs: number | null; expectedStatus: number | null; expectedBodyContains: string | null
    degradedLatencyMs: number | null; headers: Record<string, string> | null; assertions: unknown; certWarnDays: number | null
    certCriticalDays: number | null; steps: unknown
    /** BROWSER only: the closed step grammar with its budgets. Present only for a runner that reported the browser capability. */
    browser?: unknown
    /** Decrypted: ONLY ever present for a PRIVATE location (the tenant's own runner). */
    secrets?: Record<string, string>
  }
}

/** Where in its interval a (monitor, location) pair first runs: spread by a stable hash so a thousand new monitors do not all fire at once. */
export function staggerOffsetMs(monitorId: string, locationKey: string, intervalSeconds: number): number {
  const h = createHash('sha256').update(`${monitorId}:${locationKey}`).digest().readUInt32BE(0)
  return h % Math.max(1, intervalSeconds * 1000)
}

export function isLocationDue(
  now: Date, monitorId: string, key: string, intervalSeconds: number, states: LocationStates | null | undefined,
  /** `lastRunAt`: when this pair last ran if `states` does not say (a one-location monitor keeps no per-location state: its `lastCheckedAt`); `createdAt`: the monitor's age. */
  opts: { lastRunAt?: Date | string | number | null; createdAt?: Date | string | null } = {},
): boolean {
  const period = Math.max(1, intervalSeconds) * 1000
  const fromState = states?.[key]?.at ? Date.parse(states[key].at) : NaN
  const fromRow = opts.lastRunAt ? new Date(opts.lastRunAt).getTime() : NaN
  const last = Math.max(Number.isFinite(fromState) ? fromState : -Infinity, Number.isFinite(fromRow) ? fromRow : -Infinity)
  if (Number.isFinite(last)) return last + period <= now.getTime()
  // never run from here: due once the current period has reached this pair's offset ...
  if (Math.floor(now.getTime() / period) * period + staggerOffsetMs(monitorId, key, intervalSeconds) <= now.getTime()) return true
  // ... or once the monitor is a whole interval old (a poll loop whose period divides the interval always lands on the same phase of it, and must not miss a late offset for ever)
  const created = opts.createdAt ? new Date(opts.createdAt).getTime() : NaN
  return Number.isFinite(created) && created + period <= now.getTime()
}

function stepsHosts(steps: unknown): string[] {
  if (!Array.isArray(steps)) return []
  return steps.map((s) => (s && typeof s === 'object' && typeof (s as { url?: unknown }).url === 'string' ? targetHost('HTTP', (s as { url: string }).url) : null)).filter((h): h is string => !!h)
}

const refusalLog = new Map<string, number>()

/** When this location last sampled the monitor (ms), for the "waited longest" tiebreak; null if it never ran here. */
function lastRunOf(m: Monitor, key: string): number | null {
  const at = (m.locationState as LocationStates | null | undefined)?.[key]?.at
  const t = at ? Date.parse(at) : NaN
  const row = singleLocationLastRun(m)
  const best = Math.max(Number.isFinite(t) ? t : -Infinity, row ?? -Infinity)
  return Number.isFinite(best) ? best : null
}

/**
 * A monitor with ONE location keeps no per-location state (`recordOutcome` only writes it for two or more), so without this a one-location monitor looked as if it had
 * never run and was due on every poll for the rest of its period. Its `lastCheckedAt` is exactly the last sample of that one location.
 */
function singleLocationLastRun(m: Monitor): number | null {
  if (!Array.isArray(m.locations) || m.locations.length !== 1 || !m.lastCheckedAt) return null
  const t = new Date(m.lastCheckedAt).getTime()
  return Number.isFinite(t) ? t : null
}

export interface Outstanding {
  /** Leases handed out and not yet resulted or expired, per tenant (a tenant absent from the map has none). */
  perTenant: Map<string, number>
  /** The same across the whole platform, or null when it could not be counted (the global cap is then not enforced on this poll). */
  global: number | null
}

export interface LeaseDeps {
  tenants(): Promise<string[]>
  publicCheck: typeof publicTargetCheck
  /** The platform-wide cap on outstanding leases; null = none (the default). */
  globalCap(): Promise<number | null>
  /** One tenant's cap: its plan's `observability.limit.runner_leases`, else the deployment default; null = none (the default). */
  tenantCap(tenantId: string): Promise<number | null>
  /** Only called when some cap is in force, so a deployment without caps pays no query. */
  outstanding(tenantIds: string[], now: Date): Promise<Outstanding>
}

function envCap(name: 'OBSERVABILITY_PROBE_GLOBAL_LEASE_CAP' | 'OBSERVABILITY_PROBE_TENANT_LEASE_CAP'): number | null {
  try { return effectiveCap((env as unknown as Record<string, number | undefined>)[name]) } catch { return null }
}

const defaultDeps: LeaseDeps = {
  async tenants() {
    const { listActiveTenants } = await import('@kuraykaraaslan-labs/tenant/server/tenant.sweep')
    return (await listActiveTenants()).map((t) => t.tenantId)
  },
  publicCheck: publicTargetCheck,
  globalCap: async () => envCap('OBSERVABILITY_PROBE_GLOBAL_LEASE_CAP'),
  async tenantCap(tenantId) {
    // A plan that declares the key wins; an undeclared key is "unlimited" in the limits mechanism, so it falls through to the deployment default.
    const plan = effectiveCap(await limitOf(tenantId, OBSERVABILITY_LIMIT_KEYS.RUNNER_LEASES).catch(() => Number.POSITIVE_INFINITY))
    return plan ?? envCap('OBSERVABILITY_PROBE_TENANT_LEASE_CAP')
  },
  async outstanding(tenantIds, now) {
    try {
      const { withSystemRLS } = await import('@kuraykaraaslan-labs/db')
      const rows = await withSystemRLS((qr) => qr.query(
        'SELECT "tenantId", COUNT(*)::int AS n FROM probe_leases WHERE "completedAt" IS NULL AND "expiresAt" > $1 GROUP BY "tenantId"', [now],
      )) as Array<{ tenantId: string; n: number }>
      const perTenant = new Map(rows.map((r) => [r.tenantId, Number(r.n)]))
      return { perTenant, global: [...perTenant.values()].reduce((a, b) => a + b, 0) }
    } catch (err) {
      Logger.warn(`[probe.lease] outstanding leases could not be counted across tenants (${err instanceof Error ? err.message : String(err)}); counting per tenant, global cap not enforced on this poll`)
      const perTenant = new Map<string, number>()
      for (const tenantId of tenantIds) {
        const n = await withTenantRepositoryFor(tenantId, ProbeLease, (repo) => repo.count({ where: { tenantId, completedAt: IsNull(), expiresAt: MoreThan(now) } })).catch(() => 0)
        perTenant.set(tenantId, n)
      }
      return { perTenant, global: null }
    }
  },
}
let deps: LeaseDeps = defaultDeps
/** Test seam. */
export function setLeaseDeps(d?: Partial<LeaseDeps>): void { deps = d ? { ...defaultDeps, ...d } : defaultDeps }

export const ResultSchema = z.object({
  tenantId: z.string().uuid(),
  leaseId: z.string().uuid(),
  status: z.enum(['UP', 'DOWN', 'DEGRADED', 'UNKNOWN']),
  latencyMs: z.number().int().min(0).max(600_000).nullable().default(null),
  statusCode: z.number().int().min(0).max(999).nullable().default(null),
  error: z.string().max(300).nullable().default(null),
  /** BROWSER only, additive: the bounded run record and (on a failure) one JPEG, base64. The route allows a larger body for results to carry it. */
  browser: z.object({
    detail: z.unknown(),
    // Deliberately lenient here: an oversized or malformed picture must cost the picture, not the SAMPLE. `decodeScreenshot` judges it; the route caps the whole body.
    screenshotJpegBase64: z.string().max(700_000).optional(),
  }).optional(),
})
export type ResultInput = z.input<typeof ResultSchema>

/** What one poll did about the caps (the lease response carries `shed` so the runner's own stats show it). */
export interface LeaseStats { shed: { tenant: number; global: number } }

/** One tenant's due checks, ordered by priority, ready to lease (busy and refused ones already dropped), and what its own cap held back. */
interface TenantPicks {
  tenantId: string
  picks: Monitor[]
  /** Due and leasable checks left unleased because the tenant is at its own cap. */
  shedTenant: number
  cap: number | null
  outstanding: number
}

export default class ProbeLeaseService {
  /** The due checks of this runner's location, leased. */
  static async lease(runner: ProbeRunner, opts: { max?: number; browserSlots?: number } = {}, now: Date = new Date()): Promise<LeasedCheck[]> {
    return (await ProbeLeaseService.leaseWithStats(runner, opts, now)).leases
  }

  /**
   * Lease the due checks of this runner's location, within the caps (see probe.caps.ts). In order: each tenant's due checks by priority, cut to the
   * tenant's own room under its cap; then the platform's room shared max-min fairly between the tenants; then one check per tenant per round up to the
   * poll size; and only THEN are leases written, so a check the poll could not carry is never leased (it would have been busy until its visibility timeout).
   * With no cap configured nothing here counts anything and the result is what it always was.
   */
  static async leaseWithStats(runner: ProbeRunner, opts: { max?: number; browserSlots?: number } = {}, now: Date = new Date()): Promise<{ leases: LeasedCheck[] } & LeaseStats> {
    // A runner older than the wire contract supports is refused work, not fed leases it could mis-handle (426 Upgrade Required).
    if (runnerSkew(runner.version) === 'unsupported') {
      throw new AppError(`This runner is too old; update it to ${MIN_SUPPORTED_RUNNER} or later`, 426, ErrorCode.VALIDATION_ERROR, { details: { minimum: MIN_SUPPORTED_RUNNER, version: runner.version ?? null } })
    }
    const none = { leases: [] as LeasedCheck[], shed: { tenant: 0, global: 0 } }
    const max = Math.min(MAX_LEASES_PER_POLL, Math.max(1, opts.max ?? 20))
    const location = await withTenantRepositoryFor(runner.tenantId, ProbeLocation, (repo) => repo.findOne({ where: { tenantId: runner.tenantId, locationId: runner.locationId } }))
    if (!location || !location.enabled) return none
    await ProbeLocationService.markSeen(runner.tenantId, runner.locationId, null, now)

    const isPublic = location.kind === 'PUBLIC'
    // A private location serves only its own tenant. A public one (published by the ROOT tenant) serves every active tenant that picked it.
    const tenantIds = isPublic && isRootTenant(runner.tenantId) ? await deps.tenants() : [runner.tenantId]
    const policy: TargetPolicy = normalisePolicy(location.targetPolicy)

    // Caps: nothing is counted unless one is in force.
    const [globalCap, tenantCaps] = await Promise.all([
      deps.globalCap().then(effectiveCap).catch(() => null),
      Promise.all(tenantIds.map((t) => deps.tenantCap(t).then(effectiveCap).catch(() => null))),
    ])
    const capOf = new Map(tenantIds.map((t, i) => [t, tenantCaps[i]]))
    const capsInForce = globalCap !== null || tenantCaps.some((c) => c !== null)
    const outstanding: Outstanding = capsInForce ? await deps.outstanding(tenantIds, now) : { perTenant: new Map(), global: null }

        // BROWSER checks go ONLY to a runner that reported the browser capability, and only where browser checks may be placed (a private location, or a public one the
    // ROOT tenant enabled). A shared budget across the tenants of one poll keeps the expensive work from fanning out.
    const browser = { allowed: runnerCanBrowse(runner) && browserEligibleOf(location), remaining: Math.min(MAX_BROWSER_LEASES_PER_POLL, Math.max(0, opts.browserSlots ?? 1)) }

    const perTenant: TenantPicks[] = []
    for (const tenantId of tenantIds) {
      try {
        const cap = capOf.get(tenantId) ?? null
        const used = outstanding.perTenant.get(tenantId) ?? 0
        const sel = await ProbeLeaseService.selectForTenant(tenantId, location.key, isPublic, policy, Math.min(PER_TENANT_PER_POLL, max), roomUnder(cap, used), now, browser)
        if (sel.picks.length || sel.shedTenant) perTenant.push({ ...sel, tenantId, cap, outstanding: used })
      } catch (err) {
        Logger.warn(`[probe.lease] tenant ${tenantId} location ${location.key}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // The platform cap: share what is left of it between the tenants max-min fairly; priority decides inside each tenant's share.
    const shed = { tenant: 0, global: 0 }
    const shedBy = new Map<string, { tenant: number; global: number }>()
    for (const t of perTenant) { shedBy.set(t.tenantId, { tenant: t.shedTenant, global: 0 }); shed.tenant += t.shedTenant }
    if (globalCap !== null && outstanding.global !== null) {
      const room = roomUnder(globalCap, outstanding.global)
      const wants = new Map(perTenant.map((t) => [t.tenantId, t.picks.length] as const))
      const byTenant = new Map(perTenant.map((t) => [t.tenantId, t] as const))
      const rank = (id: string) => { const p = byTenant.get(id)?.picks[0]; return p ? rankOf(p) : Number.POSITIVE_INFINITY }
      const alloc = fairShare(wants, room, rank)
      for (const t of perTenant) {
        const keep = alloc.get(t.tenantId) ?? 0
        const dropped = t.picks.length - keep
        if (dropped > 0) { t.picks = t.picks.slice(0, keep); shedBy.get(t.tenantId)!.global = dropped; shed.global += dropped }
      }
    }
    const recordings: Array<Promise<void>> = []
    for (const t of perTenant) {
      const by = shedBy.get(t.tenantId)!
      if (by.tenant) recordings.push(recordShed({ tenantId: t.tenantId, locationId: runner.locationId, locationKey: location.key, reason: 'tenant', count: by.tenant, cap: t.cap, outstanding: t.outstanding }, now))
      if (by.global) recordings.push(recordShed({ tenantId: t.tenantId, locationId: runner.locationId, locationKey: location.key, reason: 'global', count: by.global, cap: globalCap, outstanding: outstanding.global ?? 0 }, now))
    }
    // Bounded: counting what was shed must never hold up the poll that shed it.
    if (recordings.length) await Promise.race([Promise.all(recordings.map((r) => r.catch(() => {}))), new Promise<void>((resolve) => { setTimeout(resolve, 500).unref?.() })])

    // Fair across tenants, like the local sweep: one check per tenant per round, so one tenant's backlog cannot fill the poll.
    const chosen: Array<{ tenantId: string; monitor: Monitor }> = interleave(perTenant.map((t) => t.picks.map((monitor) => ({ tenantId: t.tenantId, monitor })))).slice(0, max)
    const leases: LeasedCheck[] = []
    for (const { tenantId, monitor } of chosen) {
      try { leases.push(await ProbeLeaseService.createLease(tenantId, runner, location.key, isPublic, monitor, now)) }
      catch (err) { Logger.warn(`[probe.lease] tenant ${tenantId} monitor ${monitor.monitorId}: lease not written: ${err instanceof Error ? err.message : String(err)}`) }
    }
    return { leases, shed }
  }

  /** The tenant's due, leasable checks for this location, most important first, at most `take`, never more than `room` (its room under its own cap). */
  private static async selectForTenant(
    tenantId: string, key: string, isPublic: boolean, policy: TargetPolicy, perPoll: number, room: number, now: Date, browser: { allowed: boolean; remaining: number },
  ): Promise<{ picks: Monitor[]; shedTenant: number }> {
    const monitors = await withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.find({ where: { tenantId, isActive: true } }))
    const due = monitors.filter((m) =>
      m.type !== 'HEARTBEAT' && Array.isArray(m.locations) && m.locations.includes(key)
      && !(m.pausedUntil && new Date(m.pausedUntil).getTime() > now.getTime())
      && isLocationDue(now, m.monitorId, key, m.intervalSeconds, m.locationState as LocationStates | null, { lastRunAt: singleLocationLastRun(m), createdAt: m.createdAt }))
    if (due.length === 0) return { picks: [], shedTenant: 0 }

    const live = await withTenantRepositoryFor(tenantId, ProbeLease, (repo) => repo.find({ where: { tenantId, locationKey: key, completedAt: IsNull() } }))
    const busy = new Set(live.filter((l) => new Date(l.expiresAt).getTime() > now.getTime()).map((l) => l.monitorId))

    const ordered = byPriority(due.filter((m) => !busy.has(m.monitorId)).map((monitor) => ({ monitor, monitorId: monitor.monitorId, type: monitor.type, intervalSeconds: monitor.intervalSeconds, lastRunAt: lastRunOf(monitor, key) })))
    const take = Math.min(perPoll, room)
    const picks: Monitor[] = []
    let i = 0
    let browserForTenant = 0
    let browserOn: boolean | null = null
    for (; i < ordered.length && picks.length < take; i += 1) {
      const m = ordered[i].monitor
      if (m.type === 'BROWSER') {
        // Not this runner's job (it reported no browser, or the location is not one browsers may be placed at): said once per interval on the monitor, because a
        // check nobody can run must not look like a check that is passing. No slot left in this poll is NOT a refusal: it simply waits for the next one.
        if (!browser.allowed) { await ProbeLeaseService.recordRefusal(tenantId, m, key, 'this runner cannot run browser checks (it did not report the browser capability, or the location is not enabled for browsers)', now); continue }
        if (browser.remaining <= 0 || browserForTenant >= BROWSER_PER_TENANT_PER_POLL) continue
        // The workspace's own switches are judged at LEASE time too, so turning browser checks off stops the ones that already exist.
        browserOn ??= await browserChecksEnabled(tenantId)
        if (!browserOn) { await ProbeLeaseService.recordRefusal(tenantId, m, key, 'browser checks are switched off for this workspace (setting or plan)', now); continue }
      }
      const hosts = m.type === 'STEPS' ? stepsHosts(m.steps) : m.type === 'BROWSER' ? browserHosts(m.browser) : [targetHost(m.type, m.target)]
      const refusal = await ProbeLeaseService.refusal(hosts, isPublic, policy)
      if (refusal) { await ProbeLeaseService.recordRefusal(tenantId, m, key, refusal, now); continue }
      picks.push(m)
      if (m.type === 'BROWSER') { browser.remaining -= 1; browserForTenant += 1 }
    }
    // Only a cap SHEDS: checks left over because the poll is full or the per-poll fairness slice was reached are just not due yet on this poll.
    const capBinds = Number.isFinite(room) && room < perPoll
    return { picks, shedTenant: capBinds ? ordered.length - i : 0 }
  }

  private static async createLease(tenantId: string, runner: ProbeRunner, key: string, isPublic: boolean, m: Monitor, now: Date): Promise<LeasedCheck> {
    const timeoutMs = m.timeoutMs ?? 10_000
    const expiresAt = new Date(now.getTime() + timeoutMs + LEASE_GRACE_MS + (m.type === 'BROWSER' ? BROWSER_LAUNCH_ALLOWANCE_MS : 0))
    const lease = await withTenantRepositoryFor(tenantId, ProbeLease, (repo) => repo.save(repo.create({
      tenantId, monitorId: m.monitorId, locationKey: key, runnerId: runner.runnerId, expiresAt, completedAt: null,
    })))
    return {
      leaseId: lease.leaseId, tenantId, monitorId: m.monitorId, locationKey: key, deadline: expiresAt.toISOString(),
      check: {
        type: m.type, target: m.target, timeoutMs: m.timeoutMs ?? null, expectedStatus: m.expectedStatus ?? null,
        expectedBodyContains: m.expectedBodyContains ?? null, degradedLatencyMs: m.degradedLatencyMs ?? null, headers: m.headers ?? null,
        assertions: m.assertions ?? null, certWarnDays: m.certWarnDays ?? null, certCriticalDays: m.certCriticalDays ?? null, steps: m.steps ?? null,
        ...(m.type === 'BROWSER' ? { browser: m.browser ?? null } : {}),
        ...(isPublic ? {} : { secrets: Object.fromEntries(Object.entries(m.secrets ?? {}).map(([n, v]) => [n, decryptFieldOpt(v)]).filter(([, v]) => typeof v === 'string')) as Record<string, string> }),
      },
    }
  }

  /** Why this runner must not be given these hosts, or null. */
  private static async refusal(hosts: (string | null)[], isPublic: boolean, policy: TargetPolicy): Promise<string | null> {
    if (hosts.length === 0 || hosts.some((h) => h === null)) return 'the target has no host this location can check'
    for (const h of hosts as string[]) {
      if (isPublic) {
        const r = await deps.publicCheck(h)
        if (!r.ok) return `refused for a public location: ${r.reason}`
      } else if (!privateTargetAllowed(h, policy)) {
        return `"${h}" is not in this location's target allow-list`
      }
    }
    return null
  }

  /** The reason is visible to the tenant on the monitor (an UNKNOWN sample at that location), at most once per interval per pair per process. */
  private static async recordRefusal(tenantId: string, m: Monitor, key: string, reason: string, now: Date): Promise<void> {
    const id = `${m.monitorId}:${key}`
    const last = refusalLog.get(id) ?? 0
    if (now.getTime() - last < Math.max(60, m.intervalSeconds) * 1000) return
    refusalLog.set(id, now.getTime())
    await MonitorService.recordOutcome(tenantId, m, { status: 'UNKNOWN', latencyMs: null, statusCode: null, error: reason.slice(0, 300) }, { locationKey: key })
      .catch((err) => Logger.warn(`[probe.lease] refusal not recorded: ${err instanceof Error ? err.message : String(err)}`))
  }

  /**
   * Accept one result. Returns `duplicate: true` (and writes nothing) for a lease already consumed, so a retry after a lost response is safe; a
   * lease that is unknown, someone else's, or past its deadline is refused with a 409 that says nothing about which.
   */
  static async acceptResult(runner: ProbeRunner, raw: unknown, now: Date = new Date()): Promise<{ accepted: boolean; duplicate: boolean }> {
    const parsed = ResultSchema.safeParse(raw)
    if (!parsed.success) throw new AppError('Invalid result', 400, ErrorCode.VALIDATION_ERROR)
    const r = parsed.data
    const refuse = () => new AppError('The lease is not valid for this runner', 409, ErrorCode.CONFLICT)

    const outcome = await withTenantTransactionFor(r.tenantId, async (qr) => {
      const repo = qr.manager.getRepository(ProbeLease)
      const lease = await repo.findOne({ where: { tenantId: r.tenantId, leaseId: r.leaseId, runnerId: runner.runnerId }, lock: { mode: 'pessimistic_write' } })
      if (!lease) throw refuse()
      if (lease.completedAt) return { duplicate: true as const }
      if (new Date(lease.expiresAt).getTime() < now.getTime()) throw refuse()
      lease.completedAt = now
      await repo.save(lease)
      return { duplicate: false as const, lease }
    })
    if (outcome.duplicate) return { accepted: false, duplicate: true }

    const monitor = await withTenantRepositoryFor(r.tenantId, Monitor, (repo) => repo.findOne({ where: { tenantId: r.tenantId, monitorId: outcome.lease.monitorId } }))
    // The monitor was deleted or no longer uses this location while the check ran: the lease is consumed, the sample is dropped.
    if (!monitor || !Array.isArray(monitor.locations) || !monitor.locations.includes(outcome.lease.locationKey)) return { accepted: true, duplicate: false }
    const browser = monitor.type === 'BROWSER' && r.browser ? CheckDetailService.prepare(r.browser, r.status) : null
    await MonitorService.recordOutcome(r.tenantId, monitor, { status: r.status, latencyMs: r.latencyMs, statusCode: r.statusCode, error: r.error }, { locationKey: outcome.lease.locationKey, ...(browser ? { browser } : {}) })
    return { accepted: true, duplicate: false }
  }
}
