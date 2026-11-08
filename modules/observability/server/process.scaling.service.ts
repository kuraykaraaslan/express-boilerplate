import { listKinds, readProcessNodes, type ProcessNodeInfo } from '@kuraykaraaslan-labs/process_host/server/process-registry'
import {
  SUP_STATE_TTL_SECONDS, readSupervisorEvents, readSupervisorSignal, readSupervisorState,
} from '@kuraykaraaslan-labs/process_host/server/supervisor/publisher'
import type {
  PublishedBudget, PublishedChild, PublishedPolicy, PublishedSignal, SignalSample, SupervisorEvent, SupervisorStateV1, SupervisorStatus,
} from '@kuraykaraaslan-labs/process_host/server/supervisor/types'
import Logger from '@kuraykaraaslan-labs/logger'
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import IncidentService from './incident.service'

/**
 * The Scaling view of `/admin/system/processes` (docs/phases/14-docker/07-process-scaling.md task 6, owner decision D4).
 *
 * Reads ONLY through `process_host`'s readers (`listKinds`, `readProcessNodes`, `readSupervisorState`,
 * `readSupervisorEvents`, `readSupervisorSignal`); the key layout stays process_host's. Supervisors are found from the
 * registry (`proc:nodes:<kind>` nodes with `info.role = 'supervisor'`), never by a key scan. A supervisor whose state key
 * is gone or older than its 15 s TTL is stale and left out (it stopped or lost Redis), so the screen never shows a group
 * that no longer runs.
 *
 * Children are joined with their own registry rows (`info.role = 'child'`, `info.supervisor`, `info.childIndex`) for the
 * partitions an automation child holds (`info.automation.partitions`, reported by the automation host's info provider).
 */

/** How much decision log the screen shows per supervisor (the key keeps 200). */
export const SCALING_EVENTS_LIMIT = 50
/** The signal line covers the last hour. */
export const SIGNAL_WINDOW_MS = 60 * 60 * 1000

export interface ScalingChild extends PublishedChild {
  /** Milliseconds since the child started; null while its slot waits for a restart. */
  uptimeMs: number | null
  /** The partitions the child holds (automation-worker); null when the child does not report any. */
  partitions: number[] | null
}

export interface ScalingSupervisor {
  kind: string
  nodeId: string
  hostname: string
  pid: number
  startedAt: number
  updatedAt: number
  status: SupervisorStatus
  policy: PublishedPolicy
  budget: PublishedBudget
  signal: PublishedSignal
  frozen: SupervisorStateV1['frozen'] | null
  lastDecision: SupervisorEvent | null
  children: ScalingChild[]
  /** Newest first. */
  events: SupervisorEvent[]
  /** Oldest first, the last hour. */
  history: SignalSample[]
}

export interface ScalingListing {
  supervisors: ScalingSupervisor[]
  /** Supervisors announced in the registry whose state is missing or stale (left out of `supervisors`). */
  stale: number
  /** Set when Redis could not be read; the list is then empty and means "unknown", not "scaling is off". */
  redisError?: string
}

const isNumberArray = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x))

/** `info.partitions`, or the first `info.<provider>.partitions` (the automation host reports `info.automation.partitions`). */
export function partitionsOf(info: Record<string, unknown> | undefined): number[] | null {
  if (!info) return null
  if (isNumberArray(info.partitions)) return [...info.partitions].sort((a, b) => a - b)
  for (const value of Object.values(info)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const p = (value as Record<string, unknown>).partitions
      if (isNumberArray(p)) return [...p].sort((a, b) => a - b)
    }
  }
  return null
}

const role = (n: ProcessNodeInfo): unknown => n.info?.role

function toView(state: SupervisorStateV1, childNodes: ProcessNodeInfo[], events: SupervisorEvent[], history: SignalSample[], now: number): ScalingSupervisor {
  const mine = childNodes.filter((n) => role(n) === 'child' && n.info.supervisor === state.nodeId)
  const children: ScalingChild[] = [...state.children].sort((a, b) => a.index - b.index).map((c) => {
    const node = mine.find((n) => n.info.childIndex === c.index)
    return { ...c, uptimeMs: c.pid === null ? null : Math.max(0, now - c.startedAt), partitions: partitionsOf(node?.info) }
  })
  return {
    kind: state.kind,
    nodeId: state.nodeId,
    hostname: state.hostname,
    pid: state.pid,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    status: state.status,
    policy: state.policy,
    budget: state.budget,
    signal: state.signal,
    frozen: state.frozen ?? null,
    lastDecision: state.lastDecision ?? null,
    children,
    events,
    history,
  }
}

/** Every live supervisor of every kind with its state, children, recent decisions and last-hour signal. */
export async function listSupervisors(now: number = Date.now()): Promise<ScalingListing> {
  const known = await listKinds()
  if (known.redisError) return { supervisors: [], stale: 0, redisError: known.redisError }
  const supervisors: ScalingSupervisor[] = []
  let stale = 0
  let redisError: string | undefined
  for (const kind of known.kinds) {
    const read = await readProcessNodes(kind)
    if (read.redisError) { redisError = read.redisError; continue }
    for (const node of read.nodes.filter((n) => role(n) === 'supervisor')) {
      try {
        const state = await readSupervisorState(kind, node.nodeId)
        if (!state || now - state.updatedAt > SUP_STATE_TTL_SECONDS * 1000) { stale += 1; continue }
        const [events, history] = await Promise.all([
          readSupervisorEvents(kind, node.nodeId, SCALING_EVENTS_LIMIT),
          readSupervisorSignal(kind, node.nodeId, now - SIGNAL_WINDOW_MS),
        ])
        supervisors.push(toView(state, read.nodes, events, history, now))
      } catch (e) {
        redisError = e instanceof Error ? e.message : String(e)
      }
    }
  }
  supervisors.sort((a, b) => a.hostname.localeCompare(b.hostname) || a.kind.localeCompare(b.kind) || a.nodeId.localeCompare(b.nodeId))
  return { supervisors, stale, ...(redisError && { redisError }) }
}

// ── Crash-loop alert ─────────────────────────────────────────────────────────

const CRASH_REASON_PREFIX = 'source:process-crash-loop kind:'
export const crashLoopReason = (kind: string): string => `${CRASH_REASON_PREFIX}${kind}`

export interface CrashLoopEvaluation { opened: string[]; resolved: string[] }

/**
 * The crash-loop alert (07 "Observability"): a kind with a frozen supervisor (three crashes in 5 min froze its
 * scale-up) opens ONE root-tenant incident — the same path as the expected-process check (`isAuto`, private,
 * `reason = "source:process-crash-loop kind:<kind>"`), deduplicated by that reason while it is open — and it resolves
 * when no live supervisor of the kind is frozen any more: every one reports it unfrozen, or none is left (its state is
 * gone or stale: the group was stopped, redeployed or turned off, so there is no crash loop left to watch, and a kind
 * that should be running is the expected-process check's business). Otherwise nothing could ever close it. A Redis read
 * failure changes nothing (unknown ≠ healthy).
 * Prometheus carries the same signal as `ProcessCrashLoop` (alert-rules.ts) over `process_crash_loop`.
 */
export async function evaluateCrashLoops(now: number = Date.now(), listing?: ScalingListing): Promise<CrashLoopEvaluation> {
  const result: CrashLoopEvaluation = { opened: [], resolved: [] }
  const current = listing ?? await listSupervisors(now)
  if (current.redisError) return result

  const frozenByKind = new Map<string, ScalingSupervisor[]>()
  const seen = new Set<string>()
  for (const s of current.supervisors) {
    seen.add(s.kind)
    if (s.frozen) frozenByKind.set(s.kind, [...(frozenByKind.get(s.kind) ?? []), s])
  }

  const open = await IncidentService.list(ROOT_TENANT_ID, { status: 'OPEN', limit: 200 })
  const openCrash = open.filter((i) => i.isAuto && typeof i.reason === 'string' && i.reason.startsWith(CRASH_REASON_PREFIX))

  for (const [kind, frozen] of frozenByKind) {
    if (openCrash.some((i) => i.reason === crashLoopReason(kind))) continue
    const hosts = [...new Set(frozen.map((s) => s.hostname))].join(', ')
    const crashes = Math.max(...frozen.map((s) => s.frozen?.crashes ?? 0))
    await IncidentService.openIncident(ROOT_TENANT_ID, {
      monitorId: null,
      title: `Process "${kind}" in a crash loop on ${hosts}: scale-up frozen (${crashes} crashes in 5 min)`,
      reason: crashLoopReason(kind),
      severity: 'MAJOR',
      isAuto: true,
    })
    result.opened.push(kind)
  }

  for (const incident of openCrash) {
    const kind = incident.reason!.slice(CRASH_REASON_PREFIX.length)
    if (frozenByKind.has(kind)) continue
    if (!seen.has(kind)) Logger.info(`[process-scaling] ${kind}: no live supervisor left, resolving its crash-loop incident`)
    await IncidentService.resolveById(ROOT_TENANT_ID, incident.incidentId)
    result.resolved.push(kind)
  }
  if (result.opened.length || result.resolved.length) {
    Logger.info(`[process-scaling] crash-loop incidents opened=${result.opened.join(',')} resolved=${result.resolved.join(',')}`)
  }
  return result
}
