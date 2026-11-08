import net from 'node:net'
import { DNS_RESOLVERS, type DnsRecordType } from './uptime.probe.dns'
import { egressLookup, currentEgress } from './probe.egress'
import { isAddressAllowed } from '@kuraykaraaslan-labs/common/server/ip-guard'
import type { Monitor } from './entities/monitor.entity'
import type { CheckOutcome } from './uptime.probe.service'

/**
 * The non-HTTP probes (observability phase 1): TCP, PING and DNS.
 *
 * `MonitorTypeEnum` has declared all four since the beginning and only HTTP
 * ran — which meant a tenant could create a `TCP` monitor, see it in the list,
 * and never learn that it was checking nothing. A declared type with no
 * implementation is worse than an absent one: the UI promises a check that
 * silently does not happen.
 *
 * ## The SSRF guard is the SAME one, not a second copy
 *
 * `safeFetch` protects HTTP by pinning the validated IP for the connection.
 * `createValidatingLookup` is that pinning, exposed as a `net.connect`-shaped
 * lookup — so a TCP probe refuses private and metadata ranges through exactly
 * the code the HTTP probe uses, and DNS rebinding cannot slip a probe onto
 * `169.254.169.254:80` either. A second guard written here would drift, and
 * drift in an SSRF guard looks like a working uptime monitor.
 */

/** `host:port`, `tcp://host:port`, or a bare host — port optional. */
export function parseTarget(target: string): { host: string; port: number | null } {
  const cleaned = target.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const withoutPath = cleaned.split('/')[0] ?? ''

  // Bracketed IPv6 with a port: [::1]:443
  const bracketed = withoutPath.match(/^\[(.+)\]:(\d+)$/)
  if (bracketed) return { host: bracketed[1], port: Number(bracketed[2]) }
  if (withoutPath.startsWith('[') && withoutPath.endsWith(']')) {
    return { host: withoutPath.slice(1, -1), port: null }
  }

  // A bare IPv6 literal has several colons; only a single trailing one is a port.
  const parts = withoutPath.split(':')
  if (parts.length === 2 && /^\d+$/.test(parts[1])) return { host: parts[0], port: Number(parts[1]) }
  return { host: withoutPath, port: null }
}

/** One TCP handshake against `host:port`. Resolves, never throws. */
export async function tcpConnect(
  host: string, port: number, timeoutMs: number,
): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
  const started = Date.now()
  // observability.03: `net.connect` skips the lookup for an IP literal, so the pinning guard never sees it; judge the literal here
  // with the same rule (public only, or the private runner's declared ranges).
  const literal = host.replace(/^\[|\]$/g, '')
  if (net.isIP(literal)) {
    const egress = currentEgress()
    const allowed = egress && egress.ipAllowlist.length > 0
      ? isAddressAllowed(literal, egress.ipAllowlist, 'public_or_listed')
      : isAddressAllowed(literal)
    if (!allowed) return { ok: false, latencyMs: 0, error: `${literal} is a private or reserved address` }
  }
  return new Promise((resolvePromise) => {
    let settled = false
    const finish = (ok: boolean, error: string | null) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePromise({ ok, latencyMs: Date.now() - started, error })
    }

    const socket = net.connect({
      host, port,
      // The HTTP probe's guard, reused rather than reimplemented. The cast is
      // the shape difference between undici's lookup contract and node:net's
      // (`all` handling); the behaviour — resolve, refuse a blocked range,
      // connect to the address that was validated — is identical.
      lookup: egressLookup() as unknown as net.LookupFunction,
    })
    socket.setTimeout(timeoutMs)
    // A completed handshake IS the answer; nothing is written or read, so a
    // probe never appears in the target's application logs as a malformed
    // request.
    socket.once('connect', () => finish(true, null))
    socket.once('timeout', () => finish(false, `connect timed out after ${timeoutMs}ms`))
    socket.once('error', (err: Error) => finish(false, err.message.slice(0, 300)))
  })
}

function verdict(
  ok: boolean, latencyMs: number, error: string | null, degradedLatencyMs: number | null | undefined,
): CheckOutcome {
  if (!ok) return { status: 'DOWN', latencyMs, statusCode: null, error }
  if (degradedLatencyMs != null && latencyMs > degradedLatencyMs) {
    return { status: 'DEGRADED', latencyMs, statusCode: null, error: null }
  }
  return { status: 'UP', latencyMs, statusCode: null, error: null }
}

type NetMonitor = Pick<Monitor, 'target' | 'timeoutMs' | 'degradedLatencyMs' | 'expectedBodyContains'>

/** `TCP` — is the port open. The target must name one. */
export async function runTcpCheck(monitor: NetMonitor): Promise<CheckOutcome> {
  const { host, port } = parseTarget(monitor.target)
  if (!host || port == null) {
    // A configuration error, reported as DOWN rather than thrown: the sweep
    // runs across every tenant's monitors and one bad target must not end it.
    return { status: 'DOWN', latencyMs: null, statusCode: null, error: 'TCP target needs host:port' }
  }
  const r = await tcpConnect(host, port, monitor.timeoutMs ?? 10_000)
  return verdict(r.ok, r.latencyMs, r.error, monitor.degradedLatencyMs)
}

/**
 * `PING` — reachability.
 *
 * **This does not send ICMP, and the honest reason is that Node cannot.** A raw
 * ICMP socket needs elevated privileges or a native module, and neither belongs
 * in a web process; a container without `NET_RAW` could not send one anyway.
 * The plan anticipated this and asked for a documented TCP fallback, which is
 * also what every hosted uptime service does behind the word "ping".
 *
 * With a port in the target, it IS a TCP check. Without one it tries 443 then
 * 80 — the two ports a host that answers anything almost always answers on —
 * and the error names the ladder so an operator can see what was actually
 * attempted rather than guessing.
 */
export async function runPingCheck(monitor: NetMonitor): Promise<CheckOutcome> {
  const { host, port } = parseTarget(monitor.target)
  if (!host) return { status: 'DOWN', latencyMs: null, statusCode: null, error: 'PING target needs a host' }

  const timeoutMs = monitor.timeoutMs ?? 10_000
  const ports = port != null ? [port] : [443, 80]
  let lastError: string | null = null
  for (const p of ports) {
    const r = await tcpConnect(host, p, timeoutMs)
    if (r.ok) return verdict(true, r.latencyMs, null, monitor.degradedLatencyMs)
    lastError = `tcp/${p}: ${r.error}`
  }
  return {
    status: 'DOWN', latencyMs: null, statusCode: null,
    error: `ICMP unavailable, TCP fallback failed (${ports.join(',')}) — ${lastError}`.slice(0, 300),
  }
}

/** `A@host` / `TXT@host` / plain `host` (defaults to A). */
export function parseDnsTarget(target: string): { host: string; record: DnsRecordType } {
  const at = target.trim().split('@')
  if (at.length === 2 && at[0].toUpperCase() in DNS_RESOLVERS) {
    return { host: at[1].trim(), record: at[0].toUpperCase() as DnsRecordType }
  }
  return { host: parseTarget(target).host, record: 'A' }
}

/** Flatten every resolver's shape (TXT gives string[][], MX gives objects). */
function flatten(answers: unknown): string[] {
  if (!Array.isArray(answers)) return []
  return answers.flatMap((a) => {
    if (typeof a === 'string') return [a]
    if (Array.isArray(a)) return a.map(String)
    if (a && typeof a === 'object' && 'exchange' in a) return [String((a as { exchange: unknown }).exchange)]
    return [String(a)]
  })
}

/**
 * `DNS` — does the record resolve, and (optionally) does it still say what it
 * should. `expectedBodyContains` is reused as the expected value rather than
 * adding a column: it already means "the answer must contain this", and one
 * more nullable column per check type is how a monitor table becomes a union
 * of four.
 *
 * NXDOMAIN and an empty answer are both DOWN. A name that resolves to nothing
 * is not up — the distinction matters to a resolver author and not to the
 * person whose site is unreachable.
 */
export async function runDnsCheck(monitor: NetMonitor): Promise<CheckOutcome> {
  const { host, record } = parseDnsTarget(monitor.target)
  if (!host) return { status: 'DOWN', latencyMs: null, statusCode: null, error: 'DNS target needs a hostname' }

  const started = Date.now()
  try {
    const answers = flatten(await DNS_RESOLVERS[record](host))
    const latencyMs = Date.now() - started
    if (answers.length === 0) {
      return { status: 'DOWN', latencyMs, statusCode: null, error: `${record} record for ${host} is empty` }
    }
    const expected = monitor.expectedBodyContains
    if (expected && !answers.some((a) => a.includes(expected))) {
      return {
        status: 'DOWN', latencyMs, statusCode: null,
        error: `${record} record did not contain "${expected}"`,
      }
    }
    return verdict(true, latencyMs, null, monitor.degradedLatencyMs)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'DOWN', latencyMs: Date.now() - started, statusCode: null, error: message.slice(0, 300) }
  }
}
