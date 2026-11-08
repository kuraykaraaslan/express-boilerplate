// No logger or env import in the probe code on purpose: a probe runner inside a tenant's network runs these files and has no platform secrets.
import { safeFetch } from '@kuraykaraaslan-labs/common/server/safe-fetch'
import { egressFetchOptions } from './probe.egress'
import type { Monitor } from './entities/monitor.entity'
import type { MonitorStatus, SampleStatus } from './uptime.enums'
import { evaluateAssertions, legacyAssertions, needsBody, readStoredAssertions, type Assertion } from './uptime.assertions'

/** Bodies are read through a cap: a probe must never buffer a hostile or huge response. */
export const MAX_BODY_BYTES = 1_048_576

export interface CheckOutcome {
  /** UP | DOWN | DEGRADED — a single raw sample. UNKNOWN = the probe could not tell (see `SampleStatus`); it never reaches the debounce. */
  status: SampleStatus
  latencyMs: number | null
  statusCode: number | null
  error: string | null
}

/** Read at most `maxBytes` of a response body as text. Never throws; an unreadable body is an empty one. */
export async function readBodyCapped(res: { body?: unknown; text(): Promise<string> }, maxBytes = MAX_BODY_BYTES): Promise<{ text: string; bytes: number }> {
  try {
    // Structural on purpose: `safeFetch` answers with undici's Response, whose header iterator types differ from the DOM's.
    const stream = res.body as { getReader(): ReadableStreamDefaultReader<Uint8Array> } | null | undefined
    if (!stream) { const t = await res.text(); return { text: t.slice(0, maxBytes), bytes: Math.min(t.length, maxBytes) } }
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done || !value) break
      bytes += value.byteLength
      chunks.push(value)
      if (bytes >= maxBytes) { await reader.cancel().catch(() => {}); break }
    }
    const buf = new Uint8Array(Math.min(bytes, maxBytes))
    let off = 0
    for (const c of chunks) { const room = buf.length - off; if (room <= 0) break; buf.set(c.subarray(0, room), off); off += Math.min(c.byteLength, room) }
    return { text: new TextDecoder().decode(buf), bytes: buf.length }
  } catch {
    return { text: '', bytes: 0 }
  }
}

type HttpMonitor = Pick<Monitor, 'target' | 'timeoutMs' | 'expectedStatus' | 'expectedBodyContains' | 'degradedLatencyMs' | 'headers'>
  & Partial<Pick<Monitor, 'assertions' | 'certWarnDays' | 'certCriticalDays'>>

/**
 * Run ONE HTTP probe. Pure of any DB/state — just "is this target healthy right
 * now". SSRF-safe by construction: it goes through `safeFetch`, which pins the
 * validated IP for the connection (private/metadata ranges are refused, DNS
 * rebinding cannot slip a probe onto an internal host).
 *
 * Verdict: transport/timeout error or a status/body mismatch → DOWN; a healthy
 * response slower than `degradedLatencyMs` → DEGRADED (up but slow); else UP.
 *
 * Assertions (phase 09.4) are evaluated on top: the two legacy columns are read as assertions of their own, stored assertions are
 * added, a failed DOWN-severity assertion makes the sample DOWN and a failed DEGRADED-severity one (a latency budget by default)
 * makes it DEGRADED. When `certWarnDays` is set on an https target the certificate can only make the verdict worse.
 */
export async function runHttpCheck(monitor: HttpMonitor): Promise<CheckOutcome> {
  const started = Date.now()
  try {
    const res = await safeFetch(monitor.target, {
      method: 'GET',
      headers: monitor.headers ?? undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(monitor.timeoutMs ?? 10_000),
    }, egressFetchOptions())
    const latencyMs = Date.now() - started
    const statusCode = res.status

    const stored = readStoredAssertions(monitor.assertions)
    const hasStatusRule = stored.some((a) => a.kind === 'status')
    if (!hasStatusRule) {
      const statusOk = monitor.expectedStatus != null
        ? statusCode === monitor.expectedStatus
        : statusCode >= 200 && statusCode < 400
      if (!statusOk) {
        return { status: 'DOWN', latencyMs, statusCode, error: `unexpected status ${statusCode}` }
      }
    }

    const rules: Assertion[] = [...legacyAssertions(monitor), ...stored]
    let degradedReason: string | null = null
    if (rules.length > 0) {
      const body = needsBody(rules) ? await readBodyCapped(res) : { text: null as string | null, bytes: Number(res.headers?.get?.('content-length')) || null }
      const r = evaluateAssertions(rules, {
        statusCode, latencyMs, body: body.text, sizeBytes: body.bytes,
        header: (name) => res.headers?.get?.(name) ?? null,
      })
      if (r.down.length > 0) return { status: 'DOWN', latencyMs, statusCode, error: r.down[0].slice(0, 300) }
      if (r.degraded.length > 0) degradedReason = r.degraded[0].slice(0, 300)
    }

    let verdict: CheckOutcome = degradedReason
      ? { status: 'DEGRADED', latencyMs, statusCode, error: degradedReason }
      : monitor.degradedLatencyMs != null && latencyMs > monitor.degradedLatencyMs
        ? { status: 'DEGRADED', latencyMs, statusCode, error: null }
        : { status: 'UP', latencyMs, statusCode, error: null }

    if (monitor.certWarnDays != null) {
      const { certIssueForUrl } = await import('./uptime.probe.tls')
      const issue = await certIssueForUrl(monitor.target, monitor as Pick<Monitor, 'target' | 'timeoutMs' | 'certWarnDays' | 'certCriticalDays' | 'degradedLatencyMs'>)
      if (issue && (issue.status === 'DOWN' || verdict.status === 'UP')) verdict = { ...verdict, status: issue.status, error: issue.error }
    }
    return verdict
  } catch (err) {
    const latencyMs = Date.now() - started
    const error = err instanceof Error ? err.message : String(err)
    return { status: 'DOWN', latencyMs, statusCode: null, error: error.slice(0, 300) }
  }
}

export interface StateChange {
  /** Debounced status AFTER applying this sample. */
  status: MonitorStatus
  consecutiveFailures: number
  consecutiveSuccesses: number
  /** 'DOWN' when it just crossed into an outage, 'RECOVERED' when it just came back, else null. */
  transition: 'DOWN' | 'RECOVERED' | null
}

/**
 * The debounce that makes uptime trustworthy — PURE, so it is exhaustively unit
 * tested. A single failure never opens an incident; DOWN needs
 * `threshold` consecutive failures, and recovery is symmetric (`threshold`
 * consecutive successes), which also damps flapping: one stray success mid-outage
 * does not flip the page back to green.
 */
export function applyOutcome(
  prev: { lastStatus: MonitorStatus; consecutiveFailures: number; consecutiveSuccesses: number },
  outcome: { status: SampleStatus },
  threshold: number,
): StateChange {
  const t = Math.max(1, threshold)
  // An inconclusive sample moves nothing. The service filters these out before calling, this keeps the state machine safe on its own.
  if (outcome.status === 'UNKNOWN') {
    return { status: prev.lastStatus, consecutiveFailures: prev.consecutiveFailures, consecutiveSuccesses: prev.consecutiveSuccesses, transition: null }
  }
  if (outcome.status === 'DOWN') {
    const consecutiveFailures = prev.consecutiveFailures + 1
    const crossed = consecutiveFailures >= t && prev.lastStatus !== 'DOWN'
    return {
      status: crossed ? 'DOWN' : prev.lastStatus === 'DOWN' ? 'DOWN' : prev.lastStatus,
      consecutiveFailures,
      consecutiveSuccesses: 0,
      transition: crossed ? 'DOWN' : null,
    }
  }
  // UP or DEGRADED — both mean "available"
  const consecutiveSuccesses = prev.consecutiveSuccesses + 1
  const availableStatus: MonitorStatus = outcome.status === 'DEGRADED' ? 'DEGRADED' : 'UP'
  if (prev.lastStatus === 'DOWN') {
    const recovered = consecutiveSuccesses >= t
    return {
      status: recovered ? availableStatus : 'DOWN',        // stay DOWN until recovery threshold
      consecutiveFailures: 0,
      consecutiveSuccesses,
      transition: recovered ? 'RECOVERED' : null,
    }
  }
  // Not in an outage: an available sample takes effect immediately (UP↔DEGRADED
  // is not an outage transition, so no incident either way).
  return { status: availableStatus, consecutiveFailures: 0, consecutiveSuccesses, transition: null }
}

/**
 * Run the check a monitor's TYPE asks for.
 *
 * The one place `Monitor.type` becomes behaviour. Before this existed every
 * monitor ran an HTTP probe whatever its type said, so a `DNS` monitor
 * pointed at a bare hostname reported DOWN forever and looked like an outage
 * rather than a missing implementation.
 *
 * An unknown type falls back to HTTP rather than throwing: the enum is the
 * gate on what can be stored, and a sweep across every tenant must not end
 * because one row holds a string from a future version.
 */
export async function runCheck(monitor: Monitor): Promise<CheckOutcome> {
  switch (monitor.type) {
    case 'TCP':  return (await import('./uptime.probe.net')).runTcpCheck(monitor)
    case 'PING': return (await import('./uptime.probe.net')).runPingCheck(monitor)
    case 'DNS':  return (await import('./uptime.probe.net')).runDnsCheck(monitor)
    case 'TLS':    return (await import('./uptime.probe.tls')).runTlsCheck(monitor)
    case 'DOMAIN': return (await import('./uptime.probe.domain')).runDomainCheck(monitor)
    case 'STEPS':  return (await import('./uptime.probe.steps')).runStepsCheck(monitor)
    // BROWSER checks run ONLY in a browser-capable probe runner (D-OBS-8): the app process never launches a browser. Reaching here with one is a wiring
    // error (the sweep and "check now" refuse it first); the answer is inconclusive, never a verdict.
    case 'BROWSER':
      return { status: 'UNKNOWN', latencyMs: null, statusCode: null, error: 'browser checks run only in a browser-capable probe runner' }
    // HEARTBEAT is evaluated from stored state by the monitor service (nothing to call), so reaching here with it is a wiring error.
    case 'HEARTBEAT':
      return { status: 'UNKNOWN', latencyMs: null, statusCode: null, error: 'heartbeat monitors are evaluated from received pings' }
    default:     return runHttpCheck(monitor)
  }
}

