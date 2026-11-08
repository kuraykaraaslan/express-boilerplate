import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import type { ObjectLiteral, Repository } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import redis from '@kuraykaraaslan-labs/redis'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module'
import { Monitor } from '../entities/monitor.entity'
import { StatusComponent } from '../entities/status_component.entity'
import { Slo } from '../entities/slo.entity'
import { AlertRoute } from '../entities/alert_route.entity'
import { AlertIntegration } from '../entities/alert_integration.entity'
import { AlertDependency } from '../entities/alert_dependency.entity'
import { AlertSilenceTemplate } from '../entities/alert_silence_template.entity'
import { IncidentUpdateTemplate } from '../entities/incident_update_template.entity'
import MonitorService from '../uptime.monitor.service'
import StatusComponentService from '../status.component.service'
import SloService from '../slo.service'
import AlertRouteService from '../alert.route.service'
import AlertIntegrationService from '../alert.integration.service'
import AlertDependencyService from '../alert.dependency.service'
import AlertSilenceTemplateService from '../alert.silence-template.service'
import IncidentTemplateService from '../incident.templates.service'
import type { ObservabilityConfig, ConfigRequest } from './config.dto'
import { KIND_FIELD } from './config.dto'
import { CONFIG_KINDS, MANAGED_BY_CODE, keyOfSource, sourceKeyOf, type ConfigKind } from './config.kinds'
import { codeMark, runAsConfigApply } from './config.managed'
import { loadSnapshot, managedKeys } from './config.live'
import { exportConfig, type ExportOptions } from './config.export'
import { browserStartUrl } from '../uptime.browser.schema'
import { planConfig, executionOrder, buildMaps, type LiveSnapshot, type Plan, type PlanAction } from './config.plan'
import { issuesToProblems, scanHostile, checkDocument, unresolvedSecrets, parseConfigText, ConfigParseError, type ConfigProblem } from './config.parse'
import { ObservabilityConfigDTO } from './config.dto'

/**
 * Plan, apply, export, detach (observability phase 21.3). The routes and the console call this; the CLI reaches it through the routes.
 *
 * Apply is not one database transaction: every service it drives opens its own (and some have side effects, such as re-evaluating alerts),
 * so the unit of safety is different. The whole document is validated and planned BEFORE the first write; a plan with a problem writes
 * nothing; the writes run in dependency order under a per-tenant lock; and because the plan is computed from the live rows, a run that
 * stopped half way is finished by running it again (the second run plans only what is left).
 */

export interface Actor { type: 'USER' | 'API_KEY'; id: string | null }

export class ConfigProblemsError extends AppError {
  constructor(readonly problems: ConfigProblem[]) {
    super('The configuration has problems', 422, ErrorCode.VALIDATION_ERROR, { details: { problems } })
    this.name = 'ConfigProblemsError'
  }
}

type Row = Record<string, unknown>
type EntityClass = abstract new (...args: never[]) => object
const repoOf = (tenantId: string, entity: EntityClass) => <T>(cb: (repo: Repository<ObjectLiteral>) => Promise<T>) => withTenantRepositoryFor(tenantId, entity as never, cb as never) as Promise<T>

// ── reading the request ─────────────────────────────────────────────────────

export interface Prepared { document: ObservabilityConfig; kinds: ConfigKind[]; snapshot: LiveSnapshot; plan: Plan }

/** A request to a validated document and its plan. Throws `ConfigProblemsError` for anything that is wrong with the file or the plan. */
export async function prepare(tenantId: string, request: ConfigRequest): Promise<Prepared> {
  const kinds = (request.kinds && request.kinds.length ? CONFIG_KINDS.filter((k) => request.kinds!.includes(k)) : [...CONFIG_KINDS]) as ConfigKind[]
  let raw: unknown
  try {
    raw = request.content !== undefined ? parseConfigText(request.content, request.format as 'yaml' | 'json') : request.document
    scanHostile(raw)
  } catch (e) {
    if (e instanceof ConfigParseError) throw new ConfigProblemsError(e.problems)
    throw e
  }
  const parsed = ObservabilityConfigDTO.safeParse(raw)
  if (!parsed.success) throw new ConfigProblemsError(issuesToProblems(parsed.error.issues))
  const document = parsed.data
  const unresolved = unresolvedSecrets(document)
  if (unresolved.length) throw new ConfigProblemsError(unresolved)

  const snapshot = await loadSnapshot(tenantId, kinds)
  // What a kind this request does not manage may still be referred to when it is already code-managed live.
  const external = {
    monitors: kinds.includes('monitors') ? new Set<string>() : managedKeys(snapshot, 'monitors'),
    components: kinds.includes('components') ? new Set<string>() : managedKeys(snapshot, 'components'),
  }
  const refProblems = checkDocument(document, external).filter((p) => kinds.some((k) => p.path.startsWith(`${k}[`)))
  if (refProblems.length) throw new ConfigProblemsError(refProblems)

  const plan = planConfig(document, snapshot, { kinds, prune: request.prune, adopt: request.adopt, pruneKeys: request.pruneKeys })
  if (plan.problems.length) throw new ConfigProblemsError(plan.problems)
  return { document, kinds, snapshot, plan }
}

// ── apply ───────────────────────────────────────────────────────────────────

export interface AppliedAction { kind: ConfigKind; key: string; op: PlanAction['op']; id: string | null }
export interface ApplyResult {
  plan: Pick<Plan, 'summary' | 'warnings' | 'hash'>
  applied: AppliedAction[]
  /** Credentials a create issued. Returned ONCE, to the caller of this apply; nothing stores them in the clear. */
  issued: { heartbeatTokens: Record<string, string>; ingestKeys: Record<string, string> }
}

const LOCK_TTL_SECONDS = 300
const lockKey = (tenantId: string) => `obs:config:apply:${tenantId}`

async function withApplyLock<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const token = randomUUID()
  let got: unknown
  try { got = await redis.set(lockKey(tenantId), token, 'EX', LOCK_TTL_SECONDS, 'NX') } catch {
    throw new AppError('Could not take the apply lock; try again in a moment', 503, ErrorCode.PROVIDER_UNAVAILABLE, { retryable: true })
  }
  if (got !== 'OK') throw new AppError('Another apply is running for this workspace', 409, ErrorCode.CONFLICT, { retryable: true })
  try { return await fn() } finally {
    // Release only our own lock: a slow apply whose lock expired must not free somebody else's.
    try { if ((await redis.get(lockKey(tenantId))) === token) await redis.del(lockKey(tenantId)) } catch { /* the TTL frees it */ }
  }
}

const TARGET_PLACEHOLDER: Record<string, string> = { HEARTBEAT: 'heartbeat', STEPS: 'steps' }

type Ids = { monitors: Map<string, string>; components: Map<string, string> }

function idsFrom(snap: LiveSnapshot): Ids {
  const m = buildMaps(snap)
  const invert = (x: Map<string, string>) => new Map([...x].map(([id, key]) => [key, id]))
  return { monitors: invert(m.monitorKeyById), components: invert(m.componentKeyById) }
}

function resolveRef(ref: string, ids: Ids): string {
  const m = /^(component|monitor):(.+)$/.exec(ref)
  if (!m) return ref
  const id = (m[1] === 'component' ? ids.components : ids.monitors).get(m[2])
  if (!id) throw new AppError(`"${ref}" does not resolve to a resource (it was not created)`, 409, ErrorCode.CONFLICT)
  return `${m[1]}:${id}`
}
function resolveKeys(keys: string[], map: Map<string, string>, what: string): string[] {
  return keys.map((k) => { const id = map.get(k); if (!id) throw new AppError(`${what} "${k}" does not resolve to a resource`, 409, ErrorCode.CONFLICT); return id })
}

const ENTITY_BY_KIND: Record<ConfigKind, EntityClass> = {
  monitors: Monitor, components: StatusComponent, slos: Slo, silenceTemplates: AlertSilenceTemplate, integrations: AlertIntegration,
  routes: AlertRoute, dependencies: AlertDependency, incidentTemplates: IncidentUpdateTemplate,
}
const PK: Record<ConfigKind, string> = {
  monitors: 'monitorId', components: 'componentId', slos: 'sloId', silenceTemplates: 'templateId', integrations: 'integrationId',
  routes: 'routeId', dependencies: 'dependencyId', incidentTemplates: 'templateId',
}
/** Kinds whose rows carry a `sourceKey` of their own (a dependency and an update template are identified by their natural key). */
const HAS_SOURCE_KEY = new Set<ConfigKind>(['monitors', 'components', 'slos', 'silenceTemplates', 'integrations', 'routes'])

async function markRow(tenantId: string, kind: ConfigKind, id: string, mark: { managedBy: string | null; sourceKey?: string | null }): Promise<void> {
  const patch: Row = { managedBy: mark.managedBy }
  if (HAS_SOURCE_KEY.has(kind) && mark.sourceKey !== undefined) patch.sourceKey = mark.sourceKey
  await repoOf(tenantId, ENTITY_BY_KIND[kind])((repo) => repo.update({ tenantId, [PK[kind]]: id } as never, patch as never))
}

interface Issued { heartbeatTokens: Record<string, string>; ingestKeys: Record<string, string> }

async function writeAction(tenantId: string, action: PlanAction, doc: ObservabilityConfig, ids: Ids, snap: LiveSnapshot, issued: Issued): Promise<string | null> {
  const { kind, key, op, id } = action
  const arr = doc[KIND_FIELD[kind]] as unknown as Array<Row>
  const item = arr.find((i) => (kind === 'dependencies' ? `${i.child}>${i.parent}` : kind === 'incidentTemplates' ? `${i.status}/${i.locale}` : i.key) === key) as Row | undefined
  const mark = codeMark(HAS_SOURCE_KEY.has(kind) ? key : null)
  const changedFields = new Set(action.fields ?? [])
  const all = op === 'create'
  const want = (f: string) => all || changedFields.has(f)

  if (op === 'delete') {
    if (kind === 'monitors') await markRow(tenantId, kind, id as string, { managedBy: null, sourceKey: null }) // release the key: a monitor is soft-deleted and its row keeps it
    switch (kind) {
      case 'monitors': await MonitorService.remove(tenantId, id as string); break
      case 'components': await StatusComponentService.remove(tenantId, id as string); break
      case 'slos': await SloService.remove(tenantId, id as string); break
      case 'silenceTemplates': await AlertSilenceTemplateService.remove(tenantId, id as string); break
      case 'integrations': await AlertIntegrationService.remove(tenantId, id as string); break
      case 'routes': await AlertRouteService.remove(tenantId, id as string); break
      case 'dependencies': await AlertDependencyService.remove(tenantId, id as string); break
      case 'incidentTemplates': await IncidentTemplateService.remove(tenantId, id as string); break
    }
    return id as string
  }
  if (!item) throw new AppError(`the plan names ${kind} "${key}" which is not in the document`, 409, ErrorCode.CONFLICT)

  switch (kind) {
    case 'monitors': {
      const m = item as unknown as ObservabilityConfig['monitors'][number]
      const fields: Row = {}
      for (const f of ['name', 'type', 'intervalSeconds', 'timeoutMs', 'expectedStatus', 'expectedBodyContains', 'degradedLatencyMs', 'consecutiveFailThreshold', 'isActive', 'assertions', 'certWarnDays', 'certCriticalDays', 'heartbeatGraceSeconds', 'steps', 'browser', 'latencyBaselineFactor', 'groupName', 'tags', ...(m.type === 'BROWSER' ? ['locations', 'quorum'] : [])]) {
        if (want(f)) fields[f] = (m as unknown as Row)[f] ?? null
      }
      if (want('target')) fields.target = m.target ?? (m.type === 'BROWSER' ? browserStartUrl((m as unknown as Row).browser) : null) ?? TARGET_PLACEHOLDER[m.type] ?? ''
      if (all || (action.secretFields ?? []).some((s) => s.startsWith('headers.'))) fields.headers = m.headers ?? null
      if (all || (action.secretFields ?? []).some((s) => s.startsWith('secrets.'))) fields.secrets = m.secrets ?? null
      if (op === 'create') {
        const created = await MonitorService.create(tenantId, { ...fields, ...mark } as Partial<Monitor>)
        ids.monitors.set(key, created.monitorId)
        if (created.heartbeatToken) issued.heartbeatTokens[key] = created.heartbeatToken
        return created.monitorId
      }
      await MonitorService.update(tenantId, id as string, { ...fields, ...(op === 'adopt' ? mark : {}) } as Partial<Monitor>)
      ids.monitors.set(key, id as string)
      return id as string
    }
    case 'components': {
      const c = item as unknown as ObservabilityConfig['components'][number]
      const index = arr.indexOf(item)
      const data: Row = {}
      if (want('name')) data.name = c.name
      if (want('description')) data.description = c.description ?? null
      if (want('order')) data.order = c.order ?? index
      if (want('isPublic')) data.isPublic = c.isPublic ?? true
      if (want('monitors')) data.monitorIds = resolveKeys(c.monitors, ids.monitors, 'monitor')
      if (op === 'create') {
        const created = await StatusComponentService.create(tenantId, { ...data, ...mark } as never)
        ids.components.set(key, created.componentId)
        return created.componentId
      }
      if (Object.keys(data).length) await StatusComponentService.update(tenantId, id as string, data as never)
      if (op === 'adopt') await markRow(tenantId, kind, id as string, mark)
      ids.components.set(key, id as string)
      return id as string
    }
    case 'slos': {
      const s = item as unknown as ObservabilityConfig['slos'][number]
      const monitorIds = resolveKeys(s.monitors, ids.monitors, 'monitor')
      const componentId = s.component ? (ids.components.get(s.component) ?? null) : null
      if (s.component && !componentId) throw new AppError(`component "${s.component}" does not resolve to a resource`, 409, ErrorCode.CONFLICT)
      if (op === 'create') {
        const { key: _k, monitors: _m, component: _c, ...rest } = s as unknown as Row
        void _k; void _m; void _c
        const created = await SloService.create(tenantId, { ...rest, monitorIds, componentId } as never, null, mark as never)
        return created.sloId
      }
      const patch: Row = {}
      for (const f of ['name', 'description', 'kind', 'objectivePercent', 'windowDays', 'latencyThresholdMs', 'metricSpec', 'lowBudgetPercent', 'burnAlerts', 'isActive']) if (want(f)) patch[f] = (s as unknown as Row)[f] ?? null
      if (want('monitors')) patch.monitorIds = monitorIds
      if (want('component')) patch.componentId = componentId
      if (Object.keys(patch).length) await SloService.update(tenantId, id as string, patch as never)
      if (op === 'adopt') await markRow(tenantId, kind, id as string, mark)
      return id as string
    }
    case 'silenceTemplates': {
      const t = item as unknown as ObservabilityConfig['silenceTemplates'][number]
      if (op === 'create') return (await AlertSilenceTemplateService.create(tenantId, t, mark as never)).templateId
      const patch: Row = {}
      for (const f of ['name', 'matchers', 'durationMinutes', 'reason']) if (want(f)) patch[f] = (t as unknown as Row)[f]
      if (Object.keys(patch).length) await AlertSilenceTemplateService.update(tenantId, id as string, patch)
      if (op === 'adopt') await markRow(tenantId, kind, id as string, mark)
      return id as string
    }
    case 'integrations': {
      const i = item as unknown as ObservabilityConfig['integrations'][number]
      if (op === 'create') {
        const made = await AlertIntegrationService.create(tenantId, { name: i.name, kind: i.kind, severityCeiling: i.severityCeiling, defaultLabels: i.defaultLabels }, { ...mark, enabled: i.enabled } as never)
        issued.ingestKeys[key] = made.key
        return made.integration.integrationId
      }
      const patch: Row = {}
      for (const f of ['name', 'severityCeiling', 'defaultLabels', 'enabled']) if (want(f)) patch[f] = (i as unknown as Row)[f] ?? null
      if (Object.keys(patch).length) await AlertIntegrationService.update(tenantId, id as string, patch as never)
      if (op === 'adopt') await markRow(tenantId, kind, id as string, mark)
      return id as string
    }
    case 'routes': {
      const r = item as unknown as ObservabilityConfig['routes'][number]
      const position = r.position ?? arr.indexOf(item)
      if (op === 'create') {
        const { key: _k, position: _p, ...rest } = r as unknown as Row
        void _p
        void _k
        return (await AlertRouteService.create(tenantId, { ...rest, position } as never, mark as never)).routeId
      }
      const patch: Row = {}
      for (const f of ['name', 'matchers', 'groupBy', 'groupWaitSeconds', 'groupIntervalSeconds', 'targets', 'incident', 'continueMatching', 'enabled']) if (want(f)) patch[f] = (r as unknown as Row)[f] ?? null
      if (want('position')) patch.position = position
      if (Object.keys(patch).length) await AlertRouteService.update(tenantId, id as string, patch as never)
      if (op === 'adopt') await markRow(tenantId, kind, id as string, mark)
      return id as string
    }
    case 'dependencies': {
      const d = item as unknown as ObservabilityConfig['dependencies'][number]
      if (op === 'create') return (await AlertDependencyService.create(tenantId, { child: resolveRef(d.child, ids), parent: resolveRef(d.parent, ids) }, mark as never)).dependencyId
      if (op === 'adopt') await markRow(tenantId, kind, id as string, mark)
      return id as string
    }
    case 'incidentTemplates': {
      const t = item as unknown as ObservabilityConfig['incidentTemplates'][number]
      const row = await IncidentTemplateService.upsert(tenantId, t, mark as never)
      return row.templateId
    }
  }
  void snap
  return null
}

function redactMessage(message: string, secrets: readonly string[]): string {
  let out = message
  for (const s of secrets) if (s.length >= 3) out = out.split(s).join('[redacted]')
  return out
}

/** Every secret value the document carries, so an error message can be scrubbed of them. */
function secretValuesOf(doc: ObservabilityConfig): string[] {
  const out: string[] = []
  for (const m of doc.monitors) {
    for (const v of Object.values(m.headers ?? {})) if (typeof v === 'string') out.push(v)
    for (const v of Object.values(m.secrets ?? {})) if (typeof v === 'string') out.push(v)
  }
  return out
}

export async function applyConfig(tenantId: string, request: ConfigRequest, actor: Actor): Promise<ApplyResult> {
  return withApplyLock(tenantId, async () => {
    const { document, snapshot, plan } = await prepare(tenantId, request)
    if (request.planHash && request.planHash !== plan.hash) {
      throw new AppError('The live state changed since the plan was made; plan again and review it', 409, ErrorCode.CONFLICT, { details: { planHash: plan.hash } })
    }
    const ids = idsFrom(snapshot)
    const issued: Issued = { heartbeatTokens: {}, ingestKeys: {} }
    const applied: AppliedAction[] = []
    const secrets = secretValuesOf(document)
    for (const action of executionOrder(plan)) {
      try {
        const id = await runAsConfigApply(() => writeAction(tenantId, action, document, ids, snapshot, issued))
        applied.push({ kind: action.kind, key: action.key, op: action.op, id })
      } catch (e) {
        const status = e instanceof AppError ? e.statusCode : 500
        const message = redactMessage(e instanceof Error ? e.message : 'unknown error', secrets).slice(0, 300)
        Logger.warn(`[config] apply stopped at ${action.kind} "${action.key}" (${action.op}) for tenant ${tenantId}: ${message}`)
        throw new AppError(`Apply stopped at ${action.kind} "${action.key}": ${message}. Nothing after it was written; run it again to finish.`, status >= 400 && status < 600 ? status : 500, e instanceof AppError ? e.code : ErrorCode.INTERNAL_ERROR, {
          details: { applied: applied.length, failedAt: { kind: action.kind, key: action.key, op: action.op } },
        })
      }
    }
    await recordApplied(tenantId, actor, plan, applied)
    return { plan: { summary: plan.summary, warnings: plan.warnings, hash: plan.hash }, applied, issued }
  })
}

// ── audit and events ────────────────────────────────────────────────────────

async function audit(tenantId: string, actor: Actor, action: string, resourceId: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    await ifActive(tenantId, 'audit_log', async () => {
      const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service')
      await AuditLogService.log({ tenantId, actorId: actor.id, actorType: actor.type, action, resourceType: 'observability_config', resourceId, metadata })
    })
  } catch (err) {
    Logger.warn(`[config] ${action} not audited: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function recordApplied(tenantId: string, actor: Actor, plan: Plan, applied: AppliedAction[]): Promise<void> {
  if (applied.length === 0) return
  const counts = { ...plan.summary }
  await audit(tenantId, actor, 'observability.config.applied', plan.hash, { counts, kinds: [...new Set(applied.map((a) => a.kind))] })
  void (async () => {
    try {
      const { default: WebhookService } = await import('@kuraykaraaslan-labs/webhook/server/webhook.service')
      await WebhookService.dispatchEvent(tenantId, 'observability.config_applied', { counts, kinds: [...new Set(applied.map((a) => a.kind))], planHash: plan.hash, actor: actor.type })
    } catch (err) {
      Logger.debug?.(`[config] observability.config_applied not delivered: ${err instanceof Error ? err.message : String(err)}`)
    }
  })()
}

// ── export, managed list, detach ────────────────────────────────────────────

export async function exportFor(tenantId: string, kinds: readonly ConfigKind[] | undefined, opts: ExportOptions) {
  const want = kinds && kinds.length ? CONFIG_KINDS.filter((k) => kinds.includes(k)) : [...CONFIG_KINDS]
  const snapshot = await loadSnapshot(tenantId, CONFIG_KINDS)
  const { document, warnings } = exportConfig(snapshot, opts)
  // Only the requested kinds are returned; the rest are empty so the document still validates.
  for (const k of CONFIG_KINDS) if (!want.includes(k)) (document as unknown as Record<string, unknown[]>)[KIND_FIELD[k]] = []
  return { document, warnings }
}

export interface ManagedItem { kind: ConfigKind; id: string; key: string | null; name: string | null }

export async function listManaged(tenantId: string, kinds: readonly ConfigKind[] = CONFIG_KINDS): Promise<ManagedItem[]> {
  const snap = await loadSnapshot(tenantId, kinds)
  const out: ManagedItem[] = []
  for (const kind of kinds) {
    for (const r of (snap[KIND_FIELD[kind] as keyof LiveSnapshot] ?? []) as Row[]) {
      if (r.managedBy !== MANAGED_BY_CODE) continue
      const key = kind === 'dependencies' ? `${r.child}>${r.parent}` : kind === 'incidentTemplates' ? `${r.status}/${r.locale}` : keyOfSource(r.sourceKey as string | null)
      out.push({ kind, id: r[PK[kind]] as string, key, name: (r.name as string) ?? null })
    }
  }
  return out
}

/** Hand a code-managed row to the console. The key is released, so the file can no longer reach the row. */
export async function detach(tenantId: string, kind: ConfigKind, id: string, actor: Actor): Promise<void> {
  const row = await repoOf(tenantId, ENTITY_BY_KIND[kind])((repo) => repo.findOne({ where: { tenantId, [PK[kind]]: id } as never })) as Row | null
  if (!row) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND)
  if (row.managedBy !== MANAGED_BY_CODE) throw new AppError('This resource is not managed from code', 409, ErrorCode.CONFLICT)
  await markRow(tenantId, kind, id, { managedBy: null, sourceKey: null })
  await audit(tenantId, actor, 'observability.config.detached', id, { kind, key: kind === 'dependencies' || kind === 'incidentTemplates' ? null : keyOfSource(row.sourceKey as string | null) })
}

export { sourceKeyOf }
