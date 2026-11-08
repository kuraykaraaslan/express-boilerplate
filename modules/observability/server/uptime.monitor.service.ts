import 'reflect-metadata'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { Monitor } from './entities/monitor.entity'
import { MonitorCheck } from './entities/monitor_check.entity'
import CheckDetailService, { type PreparedBrowserResult } from './uptime.check-detail.service'
import { MoreThanOrEqual } from 'typeorm'
import { compactWhere, inList, searchWhere, toOrder } from '@kuraykaraaslan-labs/common/server/common.list-query'
import { MONITOR_SORTABLE, type ListMonitorsQuery } from './uptime.dto'
import { encryptFieldOpt } from '@kuraykaraaslan-labs/common/server/field-encryption'
import { runCheck, applyOutcome, type CheckOutcome } from './uptime.probe.service'
import {
  generateHeartbeatToken, hashHeartbeatToken, heartbeatVerdict, looksLikeHeartbeatToken, runDurationMs, tokenPrefix,
  type HeartbeatSignal,
} from './uptime.heartbeat'
import { baselineVerdict, BASELINE_WINDOW_SAMPLES } from './uptime.baseline'
import { getMetrics } from './metrics'
import IncidentService from './incident.service'
import AlertService from './alert.service'
import { componentEntitiesOf, monitorAlertSignal } from './alert.monitor-source'
import StatusComponentService from './status.component.service'
import StatusUptimeService from './status.uptime.service'
import type { MonitorStatus } from './uptime.enums'
import { assertMonitorAllowed, limitOf } from './observability.limits'
import { refusalDetails, refusalForLimit } from './observability.refusals'
import { probeRunBuffer, registerUsageDrain } from './observability.metering'
import { assertBrowserChecksEnabled, assertBrowserHeadroom } from './observability.browser.gate'
import { BrowserConfigSchema, MAX_BROWSER_STEPS, browserStartUrl } from './uptime.browser.schema'
import { browserProblems } from './uptime.dto'
import { OBSERVABILITY_LIMIT_KEYS } from './observability.limit-keys'
import ProbeLocationService from './probe.location.service'
import { LOCAL_LOCATION, advanceLocation, combineLocations, quorumTransition, type LocationStates } from './probe.quorum'
import { checkTenantBudget } from './observability.tenant-budget'
import { assertEditable } from './config/config.managed'
import { recordSample } from './uptime.sample-store'

export interface ProbeResult {
  outcome: CheckOutcome
  status: MonitorStatus
  transition: 'DOWN' | 'RECOVERED' | null
}

/** CRUD + the single-monitor probe orchestration. The BullMQ scheduler (Faz 0.2)
 *  simply calls `probeAndRecord` for each active monitor on its interval; keeping
 *  the orchestration here (not in the job) is what makes it unit-testable and what
 *  the "test now" button reuses. */
/**
 * One unit of the probe-runs meter per raw check written (phase 16 metering split): by check type and location, aggregated per minute in this process
 * (never a write per probe). Every path that writes a `monitor_checks` row goes through `recordOutcome`, so the meter and the table can be reconciled
 * row for row (`observability.reconcile.ts`). A sample without a location key is the in-process probe: `local`.
 */
function meterProbeRun(tenantId: string, monitor: Pick<Monitor, 'type'>, locationKey: string | null): void {
  probeRunBuffer.add(tenantId, 1, { checkType: String(monitor.type), location: locationKey ?? 'local' })
  void registerUsageDrain()
}

export default class MonitorService {
  static async list(tenantId: string): Promise<Monitor[]> {
    return withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.find({ where: { tenantId }, order: { createdAt: 'DESC' } }))
  }

  /** One page of monitors (phase 43 list contract): types, active, a group; search in the name and target. */
  static async listPage(tenantId: string, query: ListMonitorsQuery): Promise<{ data: Monitor[]; total: number }> {
    const base: Record<string, unknown> = compactWhere({ tenantId, type: inList(query.type), isActive: query.isActive, groupName: query.groupName })
    const [data, total] = await withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.findAndCount({
      where: searchWhere(base, query.search, ['name', 'target']) as never,
      order: toOrder(query.sort, MONITOR_SORTABLE, { monitorId: 'ASC' }, Monitor) as never,
      skip: query.page * query.pageSize,
      take: query.pageSize,
    }))
    return { data, total }
  }

  /** Most recent probe results for a monitor, newest first — the status view's timeline. */
  static async listChecks(tenantId: string, monitorId: string, opts: { limit?: number } = {}): Promise<MonitorCheck[]> {
    return withTenantRepositoryFor(tenantId, MonitorCheck, (repo) => repo.find({
      where: { tenantId, monitorId },
      order: { checkedAt: 'DESC' },
      take: Math.min(200, Math.max(1, opts.limit ?? 50)),
    }))
  }

  static async getById(tenantId: string, monitorId: string): Promise<Monitor> {
    const row = await withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.findOne({ where: { tenantId, monitorId } }))
    if (!row) throw new AppError('Monitor not found', 404, ErrorCode.NOT_FOUND)
    return row
  }

  /** Secrets are stored encrypted and never returned: the API shows their NAMES only (`secretNames`). */
  private static sealSecrets(data: Partial<Monitor>): Partial<Monitor> {
    if (!data.secrets) return data
    return { ...data, secrets: Object.fromEntries(Object.entries(data.secrets).map(([k, v]) => [k, encryptFieldOpt(v) as string])) }
  }

  /**
   * Create a monitor. A HEARTBEAT monitor also gets its push token here: the plaintext is returned ONCE (`heartbeatToken`) and only
   * its hash is stored, so a later read can never reveal it. Rotate to get a new one.
   */
  /**
   * Check and clean a write's `locations` / `quorum` (phase 10). Called whenever a write touches locations, quorum or secrets (a monitor that gains
   * secrets must not already be running from a public location). Returns the data to store; `locationState` is reset when the set of locations changes,
   * so a removed location's old samples cannot vote.
   */
  private static async normaliseLocations(tenantId: string, data: Partial<Monitor>, existing?: Monitor): Promise<Partial<Monitor>> {
    const type = data.type ?? existing?.type
    const browser = type === 'BROWSER'
    if (data.locations === undefined && data.quorum === undefined && data.secrets === undefined && !(browser && (data.type !== undefined || data.browser !== undefined))) return data
    const requested = data.locations !== undefined ? (data.locations ?? []) : (existing?.locations ?? [])
    if (type === 'HEARTBEAT' && requested.length) throw new AppError('A heartbeat monitor is pushed to, so it has no probe locations', 400, ErrorCode.VALIDATION_ERROR)
    const secrets = data.secrets !== undefined ? data.secrets : existing?.secrets
    const cleaned = requested.length ? await ProbeLocationService.resolveForMonitor(tenantId, requested, { hasSecrets: !!secrets && Object.keys(secrets).length > 0, browser }) : []
    const max = await limitOf(tenantId, OBSERVABILITY_LIMIT_KEYS.LOCATIONS_PER_MONITOR)
    if (Number.isFinite(max) && cleaned.length > max) {
      throw new AppError(`Your plan allows ${max} locations per monitor.`, 403, ErrorCode.FORBIDDEN, { details: { key: OBSERVABILITY_LIMIT_KEYS.LOCATIONS_PER_MONITOR, limit: max, requested: cleaned.length, ...refusalDetails(refusalForLimit(OBSERVABILITY_LIMIT_KEYS.LOCATIONS_PER_MONITOR)) } })
    }
    const quorum = data.quorum !== undefined ? data.quorum : existing?.quorum
    if (quorum != null && quorum > Math.max(1, cleaned.length)) throw new AppError('Quorum cannot exceed the number of locations', 400, ErrorCode.VALIDATION_ERROR)
    if (data.locations === undefined) return data
    const changed = JSON.stringify(cleaned) !== JSON.stringify(existing?.locations ?? [])
    return { ...data, locations: cleaned.length ? cleaned : null, ...(changed ? { locationState: null } : {}) }
  }

  /**
   * The rules of a BROWSER monitor that need the stored row or the workspace (D-OBS-8), judged when a write touches what they depend on (a rename of a monitor on a
   * downgraded plan still works). Validates the merged definition, derives the display target from the first goto, and checks the two switches (plan and workspace
   * setting) and the plan's browser-monitor count. The DTO already refined a create; this is the choke point every other writer (PATCH, import, as-code) passes through.
   */
  private static async prepareBrowser(tenantId: string, data: Partial<Monitor>, existing?: Monitor): Promise<Partial<Monitor>> {
    const type = data.type ?? existing?.type
    if (type !== 'BROWSER') return data
    const touches = !existing || ['type', 'browser', 'locations', 'intervalSeconds', 'timeoutMs', 'secrets', 'steps'].some((k) => (data as Record<string, unknown>)[k] !== undefined)
    if (!touches) return data
    const merged = {
      browser: data.browser !== undefined ? data.browser : existing?.browser,
      locations: data.locations !== undefined ? data.locations : existing?.locations,
      intervalSeconds: data.intervalSeconds ?? existing?.intervalSeconds, timeoutMs: data.timeoutMs ?? existing?.timeoutMs,
      secrets: data.secrets !== undefined ? data.secrets : existing?.secrets, steps: data.steps !== undefined ? data.steps : existing?.steps,
    }
    const parsed = BrowserConfigSchema.safeParse(merged.browser)
    if (!parsed.success) throw new AppError(`browser: ${parsed.error.issues[0]?.message ?? 'invalid definition'}`, 400, ErrorCode.VALIDATION_ERROR)
    const problems = browserProblems(merged)
    if (problems.length) throw new AppError(problems[0].message, 400, ErrorCode.VALIDATION_ERROR, { details: { problems } })
    if (parsed.data.steps.length > MAX_BROWSER_STEPS) throw new AppError(`a BROWSER monitor has at most ${MAX_BROWSER_STEPS} steps`, 400, ErrorCode.VALIDATION_ERROR)
    if (!existing || data.type !== undefined || data.browser !== undefined) {
      await assertBrowserChecksEnabled(tenantId)
      if (!existing || existing.type !== 'BROWSER') {
        await assertBrowserHeadroom(tenantId, () => withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.count({ where: { tenantId, type: 'BROWSER' } })))
      }
    }
    return data.browser !== undefined ? { ...data, target: browserStartUrl(data.browser) ?? data.target } : data
  }

  static async create(tenantId: string, data: Partial<Monitor>): Promise<Monitor & { heartbeatToken?: string }> {
    data = await MonitorService.prepareBrowser(tenantId, data)
    data = await MonitorService.normaliseLocations(tenantId, data)
    await assertMonitorAllowed(
      tenantId, { type: data.type ?? 'HTTP', intervalSeconds: data.intervalSeconds, stepsCount: data.steps?.length },
      { adding: 1, count: () => withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.count({ where: { tenantId } })) },
    )
    const token = data.type === 'HEARTBEAT' ? generateHeartbeatToken() : null
    const row = await withTenantRepositoryFor(tenantId, Monitor, (repo) =>
      repo.save(repo.create({
        ...MonitorService.sealSecrets(data), tenantId, lastStatus: 'UNKNOWN', consecutiveFailures: 0, consecutiveSuccesses: 0,
        ...(token ? { heartbeatTokenHash: hashHeartbeatToken(token) } : {}),
      })))
    // A copy, never the saved entity itself: the plaintext token must not live on an object a repository may cache or return again.
    return token ? { ...row, heartbeatToken: token } : row
  }

  static async update(tenantId: string, monitorId: string, data: Partial<Monitor>): Promise<Monitor> {
    const existing = await MonitorService.getById(tenantId, monitorId)
    data = await MonitorService.prepareBrowser(tenantId, data, existing)
    data = await MonitorService.normaliseLocations(tenantId, data, existing)
    // Only what this write changes is judged: a tenant that downgraded keeps what it has and can still rename or pause it.
    if (data.type !== undefined || data.intervalSeconds !== undefined || data.steps !== undefined) {
      await assertMonitorAllowed(tenantId, {
        type: data.type ?? (await MonitorService.getById(tenantId, monitorId)).type,
        intervalSeconds: data.intervalSeconds, stepsCount: data.steps?.length,
      })
    }
    return withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(Monitor)
      const row = await repo.findOne({ where: { tenantId, monitorId }, lock: { mode: 'pessimistic_write' } })
      if (!row) throw new AppError('Monitor not found', 404, ErrorCode.NOT_FOUND)
      // A code-managed monitor changes through an apply; its pause and maintenance windows are state, not definition.
      assertEditable(row, 'monitor', data as Record<string, unknown>, ['pausedUntil', 'maintenanceUntil'])
      // A write that omits `secrets` keeps the stored ones; one that sends the map replaces it (names the caller dropped are removed).
      Object.assign(row, MonitorService.sealSecrets(data))
      return repo.save(row)
    })
  }

  /** New heartbeat token; the old one stops working immediately. Returned once. */
  static async rotateHeartbeatToken(tenantId: string, monitorId: string): Promise<{ heartbeatToken: string }> {
    const monitor = await MonitorService.getById(tenantId, monitorId)
    if (monitor.type !== 'HEARTBEAT') throw new AppError('Only heartbeat monitors have a token', 400, ErrorCode.VALIDATION_ERROR)
    const token = generateHeartbeatToken()
    await withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.update({ tenantId, monitorId }, { heartbeatTokenHash: hashHeartbeatToken(token) }))
    return { heartbeatToken: token }
  }

  /**
   * A job's push. Looks the monitor up by token hash inside THIS tenant; anything that does not match answers the same 404, so the
   * endpoint cannot be used to learn which tokens exist. `ping` records an UP sample (recovery is immediate), `start` only stamps the
   * run, `fail` records DOWN with the job's own say-so.
   */
  static async recordHeartbeat(tenantId: string, token: string, signal: HeartbeatSignal): Promise<{ status: string }> {
    const notFound = () => new AppError('Not found', 404, ErrorCode.NOT_FOUND)
    if (!looksLikeHeartbeatToken(token)) throw notFound()
    const monitor = await withTenantRepositoryFor(tenantId, Monitor, (repo) =>
      repo.findOne({ where: { tenantId, heartbeatTokenHash: hashHeartbeatToken(token), type: 'HEARTBEAT', isActive: true } }))
    if (!monitor) { Logger.debug?.(`[uptime.heartbeat] unknown token ${tokenPrefix(token)}`); throw notFound() }
    // Only a token that matched spends the tenant's budget, so a stranger guessing tokens cannot exhaust it.
    await checkTenantBudget(tenantId, 'heartbeat')

    return MonitorService.applyHeartbeat(tenantId, monitor, signal)
  }

  /**
   * What a heartbeat that already identified its monitor does: stamp the run, record the sample. Shared by the token endpoint and by in-process senders (the
   * platform's own cron jobs, `cron.heartbeat.ts`), which know their monitor and have no token.
   */
  static async applyHeartbeat(tenantId: string, monitor: Monitor, signal: HeartbeatSignal): Promise<{ status: string }> {
    const now = new Date()
    if (signal === 'start') {
      await withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.update({ tenantId, monitorId: monitor.monitorId }, { heartbeatStartedAt: now }))
      return { status: 'started' }
    }
    const duration = signal === 'ping' ? runDurationMs(monitor, now) : null
    await withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.update({ tenantId, monitorId: monitor.monitorId }, signal === 'ping'
      ? { lastHeartbeatAt: now, heartbeatState: 'ok' }
      : { heartbeatState: 'fail' }))
    const outcome: CheckOutcome = signal === 'ping'
      ? { status: 'UP', latencyMs: duration, statusCode: null, error: null }
      : { status: 'DOWN', latencyMs: duration, statusCode: null, error: 'job reported a failure' }
    await MonitorService.recordOutcome(tenantId, monitor, outcome)
    return { status: signal === 'ping' ? 'ok' : 'failed' }
  }

  static async remove(tenantId: string, monitorId: string): Promise<void> {
    const current = await withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.findOne({ where: { tenantId, monitorId } }))
    assertEditable(current, 'monitor')
    await withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.softDelete({ tenantId, monitorId }))
  }

  /**
   * Probe one monitor once: run the check, record the raw sample, advance the
   * debounced status, and open/resolve an incident on a genuine crossing. Never
   * throws from the probe itself (a down target is data, not an error).
   */
  static async probeAndRecord(tenantId: string, monitorId: string): Promise<ProbeResult> {
    const monitor = await withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.findOne({ where: { tenantId, monitorId } }))
    if (!monitor) throw new AppError('Monitor not found', 404, ErrorCode.NOT_FOUND)

    // HEARTBEAT has nothing to call: its verdict is read from the stored push times. A healthy one records NOTHING here (the ping
    // already recorded its own UP sample), so only silence produces a sample from the sweep.
    if (monitor.type === 'HEARTBEAT') {
      const verdict = heartbeatVerdict(monitor, new Date())
      if (verdict.status === 'UP') return { outcome: verdict, status: monitor.lastStatus as MonitorStatus, transition: null }
      return MonitorService.recordOutcome(tenantId, monitor, verdict)
    }

    // A BROWSER monitor is never probed in this process, whatever its locations say (D-OBS-8): its runner leases it.
    if (monitor.type === 'BROWSER') {
      return { outcome: { status: 'UNKNOWN', latencyMs: null, statusCode: null, error: 'browser checks run only in a browser-capable probe runner' }, status: monitor.lastStatus as MonitorStatus, transition: null }
    }

    // A monitor that names locations but not `local` is probed only by its runners: the in-process probe has nothing to do for it.
    const locations = monitor.locations ?? []
    if (locations.length > 0 && !locations.includes(LOCAL_LOCATION)) {
      return { outcome: { status: 'UNKNOWN', latencyMs: null, statusCode: null, error: 'this monitor runs from probe locations only' }, status: monitor.lastStatus as MonitorStatus, transition: null }
    }
    let outcome = await runCheck(monitor)
    outcome = await MonitorService.applyLatencyBaseline(tenantId, monitor, outcome)
    return MonitorService.recordOutcome(tenantId, monitor, outcome, locations.length > 0 ? { locationKey: LOCAL_LOCATION } : {})
  }

  /** Optional: a healthy sample far slower than this monitor's own recent median becomes DEGRADED (`latencyBaselineFactor`). */
  private static async applyLatencyBaseline(tenantId: string, monitor: Monitor, outcome: CheckOutcome): Promise<CheckOutcome> {
    if (!monitor.latencyBaselineFactor || outcome.status !== 'UP' || outcome.latencyMs == null) return outcome
    const since = new Date(Date.now() - 24 * 3_600_000)
    const recent = await withTenantRepositoryFor(tenantId, MonitorCheck, (repo) => repo.find({
      where: { tenantId, monitorId: monitor.monitorId, status: 'UP', checkedAt: MoreThanOrEqual(since) },
      order: { checkedAt: 'DESC' }, take: BASELINE_WINDOW_SAMPLES, select: { latencyMs: true },
    })).catch(() => [] as MonitorCheck[])
    const v = baselineVerdict(recent.map((c) => c.latencyMs).filter((x): x is number => typeof x === 'number'), outcome.latencyMs, monitor.latencyBaselineFactor)
    if (!v.degraded) return outcome
    return { ...outcome, status: 'DEGRADED', error: `latency ${outcome.latencyMs}ms is ${v.ratio?.toFixed(1)}x the ${Math.round(v.baselineMs ?? 0)}ms baseline` }
  }

  /** The bounded run record (and failure screenshot) of a BROWSER sample. Best effort: losing the detail must never lose the sample. */
  private static async storeBrowserDetail(tenantId: string, monitorId: string, check: Pick<MonitorCheck, 'checkId' | 'checkedAt'> | undefined, prepared: PreparedBrowserResult | undefined, locationKey: string | null = null): Promise<void> {
    if (!prepared || !check?.checkId) return
    await CheckDetailService.store(tenantId, monitorId, check.checkId, check.checkedAt, prepared, locationKey)
      .catch((err) => Logger.warn(`[uptime] browser detail not stored for monitor ${monitorId}: ${err instanceof Error ? err.message : String(err)}`))
  }

  /**
   * Everything that happens to a finished sample: stamp it, advance the debounce, open or resolve incidents, refresh components.
   * Shared by the probe sweep, "check now" and heartbeat pushes.
   */
  static async recordOutcome(tenantId: string, monitor: Monitor, outcome: CheckOutcome, opts: { locationKey?: string; browser?: PreparedBrowserResult } = {}): Promise<ProbeResult> {
    const monitorId = monitor.monitorId
    const locationKey = opts.locationKey ?? null

    // An INCONCLUSIVE sample (the probe could not tell) is written to the checks list with its reason and stops there: it does not
    // move the debounce, the rollup or incidents. "We could not look" must never read as up, and must never page either.
    if (outcome.status === 'UNKNOWN') {
      const unknown = await withTenantRepositoryFor(tenantId, MonitorCheck, (repo) => repo.save(repo.create({
        tenantId, monitorId, status: 'UNKNOWN', latencyMs: outcome.latencyMs, statusCode: outcome.statusCode, error: outcome.error,
        duringMaintenance: false, locationKey, checkedAt: new Date(),
      })))
      meterProbeRun(tenantId, monitor, locationKey)
      // the Core telemetry store keeps the same sample (42-telemetry/04 §4.1, release N: both are written)
      recordSample(tenantId, monitorId, { checkedAt: unknown.checkedAt, status: 'UNKNOWN', latencyMs: outcome.latencyMs, statusCode: outcome.statusCode, error: outcome.error, duringMaintenance: false, locationKey })
      await MonitorService.storeBrowserDetail(tenantId, monitorId, unknown, opts.browser, locationKey)
      await withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.update({ tenantId, monitorId }, { lastCheckedAt: new Date() }))
      return { outcome, status: monitor.lastStatus as MonitorStatus, transition: null }
    }
    const sample = outcome as CheckOutcome & { status: 'UP' | 'DOWN' | 'DEGRADED' }

    // Resolved ONCE per probe and used twice: to stamp the sample, and further
    // down to decide whether a DOWN transition may auto-open an incident. It
    // used to be read only in that second place, so the fact that a red sample
    // was expected existed for one `if` and was then thrown away.
    // Fails CLOSED to "not in maintenance" — a bridge hiccup must raise the
    // alarm and count against uptime, never silently excuse an outage.
    const { maintenanceActive } = await import('./status.maintenance.bridge')
    const ownWindow = monitor.maintenanceUntil != null && new Date(monitor.maintenanceUntil).getTime() > Date.now()
    const duringMaintenance = ownWindow || await maintenanceActive(tenantId).catch(() => false)

    const checkedAt = new Date()
    const savedCheck = await withTenantRepositoryFor(tenantId, MonitorCheck, (repo) => repo.save(repo.create({
      tenantId, monitorId,
      status: outcome.status,
      latencyMs: outcome.latencyMs,
      statusCode: outcome.statusCode,
      error: outcome.error,
      duringMaintenance,
      locationKey,
      checkedAt,
    })))
    meterProbeRun(tenantId, monitor, locationKey)
    recordSample(tenantId, monitorId, { checkedAt, status: sample.status, latencyMs: outcome.latencyMs, statusCode: outcome.statusCode, error: outcome.error, duringMaintenance, locationKey })
    await MonitorService.storeBrowserDetail(tenantId, monitorId, savedCheck, opts.browser, locationKey)
    // Daily rollup keeps 30/90-day uptime computable after raw checks are
    // pruned. Best-effort: a rollup hiccup must not fail the probe.
    //
    // A sample taken during planned maintenance is skipped when the tenant
    // wants it excluded (default). The raw check above is still written, so
    // nothing is hidden — only the uptime PERCENTAGE stops treating scheduled
    // work as unplanned unavailability. Exclusion at write time rather than by
    // subtracting windows at read time: the rollups are per-day counters, a
    // two-hour window cannot be subtracted from them once raw checks are
    // pruned, and uptime history should not rewrite itself when somebody
    // toggles a setting.
    if (!(duringMaintenance && await StatusUptimeService.excludesMaintenance(tenantId))) {
      await StatusUptimeService.bumpDaily(tenantId, monitorId, sample.status, checkedAt, { locationKey, latencyMs: sample.latencyMs }).catch(() => {})
    }

    // The debounce step is applied to the LOCKED current row, and only the
    // state columns are written. The probe above is a network call: saving
    // the monitor read before it used to overwrite an operator's config edit
    // made meanwhile (URL, threshold), and two overlapping probes (the job +
    // "check now") each advanced the SAME stale counters — both could see the
    // DOWN crossing and open two incidents. Now exactly one prober observes a
    // given transition.
    const { change, previousStatus, disagreeing } = await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(Monitor)
      const current = await repo.findOne({ where: { tenantId, monitorId }, lock: { mode: 'pessimistic_write' } })
      if (!current) throw new AppError('Monitor not found', 404, ErrorCode.NOT_FOUND)

      // Two or more locations (phase 10): each location debounces its OWN samples first, then the monitor's status is the quorum of them.
      // There is no second debounce at the monitor level: a real outage must not wait twice, and flapping in one region never reaches here.
      if (locationKey && (current.locations?.length ?? 0) > 1) {
        const now = new Date()
        const states: LocationStates = { ...((current.locationState as LocationStates | null) ?? {}) }
        const adv = advanceLocation(states[locationKey], sample, current.consecutiveFailThreshold, now)
        states[locationKey] = adv.state
        const verdict = combineLocations(states, current.locations ?? [], { quorum: current.quorum, now, intervalSeconds: current.intervalSeconds })
        const status = (verdict.status === 'UNKNOWN' ? current.lastStatus : verdict.status) as MonitorStatus
        const transition = verdict.status === 'UNKNOWN' ? null : quorumTransition(current.lastStatus as MonitorStatus, verdict.status)
        await repo.update({ tenantId, monitorId }, {
          lastStatus: status, consecutiveFailures: adv.state.consecutiveFailures, consecutiveSuccesses: adv.state.consecutiveSuccesses,
          locationState: states, lastCheckedAt: now,
        })
        return {
          change: { status, consecutiveFailures: adv.state.consecutiveFailures, consecutiveSuccesses: adv.state.consecutiveSuccesses, transition },
          previousStatus: current.lastStatus, disagreeing: verdict.down,
        }
      }

      const next = applyOutcome(
        { lastStatus: current.lastStatus as MonitorStatus, consecutiveFailures: current.consecutiveFailures, consecutiveSuccesses: current.consecutiveSuccesses },
        sample,
        current.consecutiveFailThreshold,
      )
      await repo.update({ tenantId, monitorId }, {
        lastStatus: next.status,
        consecutiveFailures: next.consecutiveFailures,
        consecutiveSuccesses: next.consecutiveSuccesses,
        lastCheckedAt: new Date(),
      })
      return { change: next, previousStatus: current.lastStatus, disagreeing: [] as string[] }
    })

    // One metric system (locked decision): probe results go into the existing
    // Prometheus registry. No-op until instrumentation initialised metrics.
    const metrics = getMetrics()
    if (metrics) {
      if (outcome.latencyMs != null) metrics.uptimeLatency.observe({ tenantId, monitorId }, outcome.latencyMs)
      const statusValue = change.status === 'UP' ? 1 : change.status === 'DEGRADED' ? 0.5 : change.status === 'DOWN' ? 0 : -1
      metrics.uptimeStatus.set({ tenantId, monitorId }, statusValue)
    }

    // Any debounced state change refreshes the customer-facing components
    // that translate this monitor (UP↔DEGRADED matters there too).
    if (change.status !== previousStatus) {
      await StatusComponentService.recomputeForMonitor(tenantId, monitorId)
    }

    // Outages and recoveries go through the alert pipeline (phase 11): the alert is judged once (maintenance, silences, the dependency
    // graph, routing), and the default policy opens the incident exactly as this used to do directly. A failure of the pipeline must
    // never fail the probe, so it is swallowed here as the direct incident calls were.
    if (change.transition === 'DOWN') {
      // Expected outage ≠ incident (tenant phase-3 bridge rule): during an active full/tenant maintenance window the probe records checks
      // and component status as usual, and the alert is STORED but suppressed ('maintenance'), so a planned outage pages nobody. The
      // maintenance check fails CLOSED to "not in maintenance", so a bridge hiccup still raises the alarm.
      if (duringMaintenance) Logger.info(`[uptime] auto-incident suppressed during maintenance (tenant=${tenantId} monitor=${monitorId})`)
      const componentEntities = await componentEntitiesOf(tenantId, monitorId)
      // With several locations the alert says which ones saw it down, so "DOWN from eu-west and us-east" is in the first message.
      const error = disagreeing.length > 0 ? `down from ${disagreeing.join(', ')}${outcome.error ? `: ${outcome.error}` : ''}`.slice(0, 300) : outcome.error
      await AlertService.ingest(tenantId, monitorAlertSignal(monitor, 'FIRING', { error, duringMaintenance, componentEntities }))
        .catch((err) => Logger.warn(`[uptime] alert pipeline failed for monitor ${monitorId}: ${err instanceof Error ? err.message : String(err)}`))
    } else if (change.transition === 'RECOVERED') {
      await AlertService.ingest(tenantId, monitorAlertSignal(monitor, 'RESOLVED', {}))
        .catch((err) => Logger.warn(`[uptime] alert pipeline failed on recovery of monitor ${monitorId}: ${err instanceof Error ? err.message : String(err)}`))
      // Exactly what recovery did before the alert layer: close any open incident of this monitor. It also covers incidents that were
      // opened before alerts existed (they have no alert to settle them).
      await IncidentService.resolveOpenIncident(tenantId, monitorId).catch(() => {})
    }

    return { outcome, status: change.status, transition: change.transition }
  }
}
