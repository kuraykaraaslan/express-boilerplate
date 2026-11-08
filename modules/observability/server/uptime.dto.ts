import { z } from 'zod'
import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query'
import { isIP } from 'node:net'
import { isBlockedIp } from '@kuraykaraaslan-labs/common/server/ip-guard'
import { patchSchema } from '@kuraykaraaslan-labs/common/server/zod-patch'
import { AssertionListSchema } from './uptime.assertions'
import { StepListSchema, SECRET_NAME } from './uptime.steps.schema'
import { BrowserConfigSchema, MIN_BROWSER_INTERVAL_SECONDS, MIN_BROWSER_TIMEOUT_MS, browserSecretNames, type BrowserConfig } from './uptime.browser.schema'
import { LOCAL_LOCATION, LOCATION_KEY_RE } from './probe.quorum'
import { MonitorTypeEnum, ComponentStatusEnum, IncidentUpdateStatusEnum, IncidentSeverityEnum } from './uptime.enums'

const SecretMap = z.record(z.string().regex(SECRET_NAME), z.string().min(1).max(2000))
  .refine((m) => Object.keys(m).length <= 20, 'at most 20 secrets')

/** The shared field set. Per-type rules are in `CreateMonitorDTO.superRefine`; the PATCH schema is derived from this plain object. */
export const MonitorFieldsDTO = z.object({
  name: z.string().min(1).max(200),
  type: MonitorTypeEnum.default('HTTP'),
  /** URL for HTTP, host[:port] for TCP/TLS, host for PING/DNS, a domain for DOMAIN. HEARTBEAT, STEPS and BROWSER do not need one. */
  target: z.string().min(1).max(500).optional(),
  intervalSeconds: z.number().int().positive().max(86400).default(60),
  timeoutMs: z.number().int().positive().max(120000).default(10000),
  expectedStatus: z.number().int().min(100).max(599).nullish(),
  expectedBodyContains: z.string().max(500).nullish(),
  degradedLatencyMs: z.number().int().positive().nullish(),
  headers: z.record(z.string(), z.string()).nullish(),
  consecutiveFailThreshold: z.number().int().min(1).max(20).default(3),
  isActive: z.boolean().default(true),
  assertions: AssertionListSchema.nullish(),
  certWarnDays: z.number().int().min(1).max(365).nullish(),
  certCriticalDays: z.number().int().min(0).max(365).nullish(),
  heartbeatGraceSeconds: z.number().int().min(0).max(86400).nullish(),
  steps: StepListSchema.nullish(),
  /** BROWSER: the closed browser step grammar with its budgets (`uptime.browser.schema.ts`). Runs only in a browser-capable runner. */
  browser: BrowserConfigSchema.nullish(),
  secrets: SecretMap.nullish(),
  latencyBaselineFactor: z.number().min(1.5).max(50).nullish(),
  groupName: z.string().min(1).max(100).nullish(),
  tags: z.array(z.string().min(1).max(40)).max(20).nullish(),
  /** Where the monitor runs from: `local` (the in-process probe), published public locations and the workspace's own private ones. Empty = `local`. */
  locations: z.array(z.string().min(1).max(64).refine((k) => k === LOCAL_LOCATION || LOCATION_KEY_RE.test(k), 'not a location key')).max(10).nullish(),
  /** How many locations must be DOWN for the monitor to be DOWN (default: a majority of those that report). */
  quorum: z.number().int().min(1).max(10).nullish(),
  pausedUntil: z.coerce.date().nullish(),
  maintenanceUntil: z.coerce.date().nullish(),
})

/** The host part of an HTTP / TCP / DOMAIN target, lower-cased, without brackets; null when there is none. */
function targetHost(type: string, target: string): string | null {
  try {
    if (type === 'HTTP') return new URL(target).hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (type === 'TCP') return new URL(`tcp://${target}`).hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (type === 'DOMAIN') return target.replace(/^[a-z]+:\/\//i, '').split('/')[0]!.toLowerCase()
  } catch { /* the shape rules below answer */ }
  return null
}

/**
 * observability.03: a monitor the PLATFORM probes (no location, or the local one) must aim at a public address. The probe
 * connects from inside the platform's network and returns what it saw (status, timings, `expectedBodyContains`), so an internal
 * target (the metadata service, loopback, a private range, `localhost`) was SSRF, a port scanner and a response-body oracle. A
 * host NAME is checked again at probe time by the pinning fetch; an IP literal and the localhost names are refused here. A
 * monitor that runs only on the tenant's own enrolled runners (a private network they operate) may target private addresses.
 */
function internalTargetProblem(type: string, target: string, locations?: readonly string[] | null): string | null {
  const host = targetHost(type, target)
  if (!host) return null
  const onPlatform = !locations || locations.length === 0 || locations.includes(LOCAL_LOCATION)
  if (!onPlatform) return null
  const internal = host === 'localhost' || host.endsWith('.localhost') || (isIP(host) !== 0 && isBlockedIp(host))
  return internal ? 'the target must be a public address (an internal one needs a probe location in that network)' : null
}

/** What each type needs. Returns a reason or null; used by create and import. */
export function monitorProblem(m: { type: string; target?: string | null; steps?: unknown; browser?: unknown; assertions?: unknown; certWarnDays?: number | null; certCriticalDays?: number | null; locations?: string[] | null }): string | null {
  const target = (m.target ?? '').trim()
  return shapeProblem(m, target) ?? internalTargetProblem(m.type, target, m.locations)
}

function shapeProblem(m: { type: string; steps?: unknown; browser?: unknown }, target: string): string | null {
  switch (m.type) {
    case 'HEARTBEAT': return null
    case 'STEPS': return m.steps ? null : 'a STEPS monitor needs a step list'
    case 'BROWSER': return m.browser ? null : 'a BROWSER monitor needs a browser definition'
    case 'HTTP':
      try { const u = new URL(target); return u.protocol === 'http:' || u.protocol === 'https:' ? null : 'HTTP target must be an http(s) URL' } catch { return 'HTTP target must be a URL' }
    case 'TCP': return /:\d{1,5}$/.test(target) ? null : 'TCP target must be host:port'
    case 'DOMAIN': return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(target.replace(/^[a-z]+:\/\//i, '').split('/')[0]) ? null : 'DOMAIN target must be a domain name'
    default: return target ? null : `${m.type} target is required`
  }
}

/** The cross-field rules of a monitor definition: shared by create, import and the monitoring-as-code document (phase 21). */
export function refineMonitor(
  m: { type: string; target?: string | null; steps?: unknown; browser?: unknown; assertions?: unknown; certWarnDays?: number | null; certCriticalDays?: number | null; locations?: string[] | null; quorum?: number | null; intervalSeconds?: number | null; timeoutMs?: number | null; secrets?: Record<string, unknown> | null },
  ctx: z.RefinementCtx,
): void {
  const problem = monitorProblem(m)
  if (problem) ctx.addIssue({ code: 'custom', path: ['target'], message: problem })
  if (m.certCriticalDays != null && m.certWarnDays != null && m.certCriticalDays > m.certWarnDays) {
    ctx.addIssue({ code: 'custom', path: ['certCriticalDays'], message: 'critical days must not exceed warning days' })
  }
  if (m.type !== 'STEPS' && m.type !== 'BROWSER' && m.steps) ctx.addIssue({ code: 'custom', path: ['steps'], message: 'steps belong to a STEPS monitor' })
  if (m.type !== 'BROWSER' && m.browser) ctx.addIssue({ code: 'custom', path: ['browser'], message: 'a browser definition belongs to a BROWSER monitor' })
  if (m.type === 'BROWSER') browserProblems(m).forEach((p) => ctx.addIssue({ code: 'custom', path: [p.path], message: p.message }))
  if (m.type === 'HEARTBEAT' && m.locations?.length) ctx.addIssue({ code: 'custom', path: ['locations'], message: 'a heartbeat monitor is pushed to, so it has no probe locations' })
  if (m.quorum != null && m.quorum > (m.locations?.length ?? 1)) ctx.addIssue({ code: 'custom', path: ['quorum'], message: 'quorum cannot exceed the number of locations' })
}

/**
 * What a BROWSER monitor needs beyond the grammar (D-OBS-8): it never runs in the app process, so it must name at least one probe location and
 * may not name `local`; a browser run is expensive, so the interval and timeout have floors that no plan can lower; and every secret a step
 * types must exist on the monitor (so a typo fails when saving, not at 3 a.m.). Shared by create, import and monitoring-as-code.
 */
export function browserProblems(m: { browser?: unknown; locations?: string[] | null; intervalSeconds?: number | null; timeoutMs?: number | null; secrets?: Record<string, unknown> | null; steps?: unknown }): Array<{ path: string; message: string }> {
  const out: Array<{ path: string; message: string }> = []
  const remote = (m.locations ?? []).filter((k) => k !== LOCAL_LOCATION)
  if (remote.length === 0) out.push({ path: 'locations', message: 'a BROWSER monitor runs only from a browser-capable probe location: name at least one' })
  if ((m.locations ?? []).includes(LOCAL_LOCATION)) out.push({ path: 'locations', message: 'a BROWSER monitor cannot run from `local`: the app process never runs a browser' })
  if (m.intervalSeconds != null && m.intervalSeconds < MIN_BROWSER_INTERVAL_SECONDS) out.push({ path: 'intervalSeconds', message: `a BROWSER monitor runs at most every ${MIN_BROWSER_INTERVAL_SECONDS} seconds` })
  if (m.timeoutMs != null && m.timeoutMs < MIN_BROWSER_TIMEOUT_MS) out.push({ path: 'timeoutMs', message: `a BROWSER monitor needs a timeout of at least ${MIN_BROWSER_TIMEOUT_MS} ms (it is the budget of the whole run)` })
  if (m.steps) out.push({ path: 'steps', message: 'steps belong to a STEPS monitor; a BROWSER monitor uses `browser`' })
  const parsed = BrowserConfigSchema.safeParse(m.browser)
  if (parsed.success) {
    const missing = browserSecretNames(parsed.data as BrowserConfig).filter((n) => !m.secrets || !(n in m.secrets))
    if (missing.length) out.push({ path: 'secrets', message: `the browser steps use secret(s) not defined on the monitor: ${missing.join(', ')}` })
  }
  return out
}

export const CreateMonitorDTO = MonitorFieldsDTO.superRefine(refineMonitor)
export type CreateMonitorInput = z.infer<typeof CreateMonitorDTO>

export const UpdateMonitorDTO = patchSchema(MonitorFieldsDTO)
export type UpdateMonitorInput = z.infer<typeof UpdateMonitorDTO>

/** Bulk operations on many monitors at once (phase 09.7). */
export const BulkMonitorDTO = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum(['pause', 'resume', 'delete', 'maintenance', 'clear-maintenance']),
  /** pause / maintenance: until when (omit to pause indefinitely via isActive=false). */
  until: z.coerce.date().nullish(),
})
export type BulkMonitorInput = z.infer<typeof BulkMonitorDTO>

export const ImportMonitorsDTO = z.object({
  format: z.enum(['csv', 'yaml', 'json']),
  content: z.string().min(1).max(500_000),
  dryRun: z.boolean().default(true),
})
export type ImportMonitorsInput = z.infer<typeof ImportMonitorsDTO>

// ============================================================================
// Status components (phase 2)
// ============================================================================

export const CreateStatusComponentDTO = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).nullish(),
  order: z.number().int().min(0).max(10000).optional(),
  isPublic: z.boolean().optional(),
  monitorIds: z.array(z.string().uuid()).max(100).optional(),
  /** The one level of grouping (phase 15.2); null clears it. */
  groupId: z.string().uuid().nullish(),
  /** Per-component display options. */
  showUptime: z.boolean().optional(),
  showHistory: z.boolean().optional(),
  showRegions: z.boolean().optional(),
  /** The response-time chart (phase 15.6): daily average and approximate p95. Off by default. */
  showResponseTime: z.boolean().optional(),
})
export type CreateStatusComponentInput = z.infer<typeof CreateStatusComponentDTO>

export const UpdateStatusComponentDTO = patchSchema(CreateStatusComponentDTO).extend({
  // MAINTENANCE is set here by the operator; derivation never overwrites it,
  // and setting any other value hands control back to the probes.
  status: ComponentStatusEnum.optional(),
})
export type UpdateStatusComponentInput = z.infer<typeof UpdateStatusComponentDTO>

// ============================================================================
// Incident public face + progress updates (phase 2)
// ============================================================================

export const UpdateIncidentDTO = z.object({
  title: z.string().min(1).max(300).optional(),
  severity: IncidentSeverityEnum.optional(),
  isPublic: z.boolean().optional(),
  publicMessage: z.string().max(2000).nullish(),
  affectedComponentIds: z.array(z.string().uuid()).max(100).nullish(),
  /**
   * Restricted status pages (password, members, address list) that show this PRIVATE incident after their own gate passed (phase 15.3). Touching it is an
   * outward-facing act, so it takes `observability.status.publish` like `isPublic`. null or [] clears it. Never shown on a public page.
   */
  audiencePageIds: z.array(z.string().uuid()).max(20).nullish(),
})
export type UpdateIncidentInput = z.infer<typeof UpdateIncidentDTO>

export const AddIncidentUpdateDTO = z.object({
  status: IncidentUpdateStatusEnum,
  publicMessage: z.string().min(1).max(2000),
})
export type AddIncidentUpdateInput = z.infer<typeof AddIncidentUpdateDTO>

/** The monitor list (phase 43 list contract). Secrets, headers and the heartbeat token hash never sort or search. */
export const MONITOR_SORTABLE = {
  name: 'name', type: 'type', intervalSeconds: 'intervalSeconds', isActive: 'isActive', lastStatus: 'lastStatus',
  lastCheckedAt: 'lastCheckedAt', createdAt: 'createdAt',
} as const

export const ListMonitorsQuery = listQuerySchema({
  sortable: MONITOR_SORTABLE,
  defaultSort: 'createdAt:desc',
  pageSize: { default: 25, max: 200 },
  filters: {
    type: listFilter.oneOf(MonitorTypeEnum.options),
    isActive: listFilter.flag(),
    groupName: listFilter.value(),
  },
})
export type ListMonitorsQuery = z.infer<typeof ListMonitorsQuery>
