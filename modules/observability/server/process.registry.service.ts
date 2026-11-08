import {
  NODE_HEARTBEAT_MS, NODE_TTL_SECONDS, listKinds, readProcessNodes,
  type HealthReport, type ProcessNodeInfo,
} from '@kuraykaraaslan-labs/process_host/server/process-registry'
import { env } from '@kuraykaraaslan-labs/env'
import Logger from '@kuraykaraaslan-labs/logger'
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import IncidentService from './incident.service'
import AlertService from './alert.service'
import type { AlertSignal } from './alert.ingest.parsers'
import { RUNBOOKS } from './observability.runbooks'

/**
 * Platform view of every sidecar process (docs/phases/09-observability phase 5 §5.2).
 *
 * Reads ONLY through `process_host`'s `readProcessNodes` / `listKinds`; it does
 * not know the ZSET format (OD-12). A Redis that cannot be read yields
 * `unknown`, never `down` — the same rule the telephony status screen uses:
 * telling an operator a running process is down because WE could not ask is the
 * fastest way to make a status screen untrusted.
 */

export interface ProcessRow {
  kind: string
  nodeId: string
  version: string
  port: number
  startedAt: number
  lastBeatAt: number
  /** Milliseconds since the last heartbeat, measured at read time. */
  beatAgeMs: number
  health: HealthReport
  info: Record<string, unknown>
}

export type KindState = 'ok' | 'below' | 'unknown' | 'unexpected'

export interface KindSummary {
  kind: string
  /** Declared count from EXPECTED_PROCESSES; null when the kind is not declared. */
  expected: number | null
  live: number
  state: KindState
}

export interface ProcessListing {
  processes: ProcessRow[]
  kinds: KindSummary[]
  /** Set when Redis could not be read; every state is then `unknown`. */
  redisError?: string
  expectedConfigured: boolean
}

/** `ws:1,worker:2` → `{ ws: 1, worker: 2 }`. Malformed pairs are ignored. */
export function parseExpectedProcesses(raw: string | undefined | null): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of (raw ?? '').split(',')) {
    const [kind, count] = part.split(':').map((s) => s.trim())
    const n = Number.parseInt(count ?? '', 10)
    if (kind && Number.isFinite(n) && n >= 0) out[kind] = n
  }
  return out
}

function toRow(node: ProcessNodeInfo, now: number): ProcessRow {
  return {
    kind: node.kind,
    nodeId: node.nodeId,
    version: node.version,
    port: node.port,
    startedAt: node.startedAt,
    lastBeatAt: node.lastBeatAt,
    beatAgeMs: Math.max(0, now - node.lastBeatAt),
    health: node.health,
    info: node.info,
  }
}

/** Every live node of every kind, plus a per-kind summary against the declared expectation. */
export async function listProcesses(now: number = Date.now(), expectedRaw: string | undefined = env.EXPECTED_PROCESSES): Promise<ProcessListing> {
  const expected = parseExpectedProcesses(expectedRaw)
  const known = await listKinds()
  if (known.redisError) {
    const kinds = Object.keys(expected).map((kind) => ({ kind, expected: expected[kind], live: 0, state: 'unknown' as const }))
    return { processes: [], kinds, redisError: known.redisError, expectedConfigured: kinds.length > 0 }
  }

  const kindNames = [...new Set([...known.kinds, ...Object.keys(expected)])].sort()
  const processes: ProcessRow[] = []
  const kinds: KindSummary[] = []
  let redisError: string | undefined
  for (const kind of kindNames) {
    const read = await readProcessNodes(kind)
    if (read.redisError) { redisError = read.redisError; kinds.push({ kind, expected: expected[kind] ?? null, live: 0, state: 'unknown' }); continue }
    processes.push(...read.nodes.map((n) => toRow(n, now)))
    const want = expected[kind] ?? null
    const live = read.nodes.length
    kinds.push({
      kind, expected: want, live,
      state: want === null ? 'unexpected' : live >= want ? 'ok' : 'below',
    })
  }
  processes.sort((a, b) => a.kind.localeCompare(b.kind) || a.nodeId.localeCompare(b.nodeId))
  return { processes, kinds, redisError, expectedConfigured: Object.keys(expected).length > 0 }
}

/** A kind must stay below its count for this long before an incident opens. */
export const BELOW_GRACE_MS = 2 * NODE_TTL_SECONDS * 1000

const REASON_PREFIX = 'source:process kind:'
const reasonFor = (kind: string): string => `${REASON_PREFIX}${kind}`

/** First time each kind was seen below its expected count (this evaluator's memory). */
const belowSince = new Map<string, number>()

export interface ExpectedEvaluation { opened: string[]; resolved: string[]; pending: string[] }

/**
 * Raise an alert for a kind below its expected count for more than two heartbeat TTLs; resolve it when the kind returns. Empty
 * `EXPECTED_PROCESSES` means "do not alert". Redis unreadable changes nothing (unknown ≠ down).
 *
 * Since the alert pipeline (phase 11) a missing process is an ALERT on the ROOT tenant, like a failing monitor: it can be silenced, routed,
 * grouped, and — because every process kind is an `entity` in the dependency graph — it mutes the alerts of whatever depends on it. The
 * default policy still opens the same private, auto incident, and it keeps `reason = "source:process kind:<kind>"`, so incidents opened
 * before the alert layer (found and closed by that reason) are still closed when the kind returns.
 */
export async function evaluateExpectedProcesses(now: number = Date.now(), listing?: ProcessListing): Promise<ExpectedEvaluation> {
  const result: ExpectedEvaluation = { opened: [], resolved: [], pending: [] }
  const current = listing ?? await listProcesses(now)
  if (!current.expectedConfigured || current.redisError) return result

  const open = await IncidentService.list(ROOT_TENANT_ID, { status: 'OPEN', limit: 200 })
  const legacyOpenFor = (kind: string) => open.find((i) => i.isAuto && i.reason === reasonFor(kind))

  for (const summary of current.kinds) {
    if (summary.expected === null) continue
    if (summary.state === 'below') {
      const since = belowSince.get(summary.kind) ?? now
      belowSince.set(summary.kind, since)
      if (now - since <= BELOW_GRACE_MS) { result.pending.push(summary.kind); continue }
      const r = await AlertService.ingest(ROOT_TENANT_ID, processAlertSignal(summary.kind, 'FIRING', `Process "${summary.kind}" below expected count (${summary.live}/${summary.expected})`))
      if (r?.created) result.opened.push(summary.kind)
    } else if (summary.state === 'ok') {
      belowSince.delete(summary.kind)
      const resolvedAlert = await AlertService.ingest(ROOT_TENANT_ID, processAlertSignal(summary.kind, 'RESOLVED', ''))
      const legacy = legacyOpenFor(summary.kind)
      if (legacy) await IncidentService.resolveById(ROOT_TENANT_ID, legacy.incidentId)
      if (resolvedAlert || legacy) result.resolved.push(summary.kind)
    }
  }
  if (result.opened.length || result.resolved.length) {
    Logger.info(`[process-registry] alerts opened=${result.opened.join(',')} resolved=${result.resolved.join(',')}`)
  }
  return result
}

/** A process kind, as an alert signal. Identity is the KIND, so a recovery resolves exactly the alert that its absence raised. */
export function processAlertSignal(kind: string, status: 'FIRING' | 'RESOLVED', title: string): AlertSignal {
  return {
    source: 'process', sourceRef: kind, status, severity: 'MAJOR', title: title.slice(0, 300),
    fingerprint: `process:${kind}`,
    labels: { alertname: 'ProcessBelowExpected', kind, entity: `process:${kind}` },
    annotations: { summary: title, reason: reasonFor(kind), runbook: RUNBOOKS.platformJobs },
  }
}

/** Exposed for tests. */
export function __resetProcessEvaluatorForTests(): void { belowSince.clear() }

export { NODE_HEARTBEAT_MS, NODE_TTL_SECONDS }
