import tls from 'node:tls'
import net from 'node:net'
import { egressLookup } from './probe.egress'
import { parseTarget } from './uptime.probe.net'
import type { Monitor } from './entities/monitor.entity'
import type { CheckOutcome } from './uptime.probe.service'

/**
 * The TLS probe and certificate expiry (observability phase 09.1).
 *
 * One handshake, then the certificate is read and judged. It goes through the same address guard the HTTP and TCP probes use
 * (`createValidatingLookup`), so a monitor cannot be pointed at a private or metadata address: there is no second guard here.
 *
 * `rejectUnauthorized` is OFF on purpose. The point is to REPORT why a certificate is bad ("expired", "self-signed", "wrong host")
 * rather than receive an opaque connection error, and nothing is sent over the connection, so there is nothing to protect by refusing.
 */

export const DEFAULT_CERT_WARN_DAYS = 30
export const DEFAULT_CERT_CRITICAL_DAYS = 7
const DAY_MS = 86_400_000

export interface CertInfo {
  validFrom: Date
  validTo: Date
  /** Whole days until `validTo`; negative once expired. */
  daysToExpiry: number
  /** The certificate names the host that was asked about. */
  hostnameOk: boolean
  /** The chain is trusted by this runtime's roots. */
  authorized: boolean
  authError: string | null
  protocol: string | null
  issuer: string | null
}

type RawInspection = { ok: true; info: CertInfo } | { ok: false; error: string }
export type CertInspection = RawInspection & { latencyMs: number }

interface PeerCert { valid_from?: string; valid_to?: string; issuer?: { O?: string; CN?: string } }

/** Pure: turn a peer certificate plus the handshake facts into CertInfo. Exported for tests. */
export function describeCertificate(
  cert: PeerCert, host: string, facts: { authorized: boolean; authError: string | null; protocol: string | null; hostnameOk: boolean }, now: Date,
): CertInfo | null {
  const validFrom = cert.valid_from ? new Date(cert.valid_from) : null
  const validTo = cert.valid_to ? new Date(cert.valid_to) : null
  if (!validFrom || !validTo || Number.isNaN(validFrom.getTime()) || Number.isNaN(validTo.getTime())) return null
  return {
    validFrom, validTo,
    daysToExpiry: Math.floor((validTo.getTime() - now.getTime()) / DAY_MS),
    hostnameOk: facts.hostnameOk,
    authorized: facts.authorized,
    authError: facts.authError,
    protocol: facts.protocol,
    issuer: cert.issuer?.O ?? cert.issuer?.CN ?? null,
  }
}

/** One TLS handshake against `host:port` (default 443). Resolves, never throws. */
export async function inspectCertificate(host: string, port: number, timeoutMs: number, now: () => Date = () => new Date()): Promise<CertInspection> {
  const started = Date.now()
  return new Promise((resolvePromise) => {
    let settled = false
    const finish = (r: RawInspection) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePromise({ ...r, latencyMs: Date.now() - started })
    }
    const socket = tls.connect({
      host, port,
      // SNI must be a hostname, never an IP literal.
      servername: net.isIP(host) ? undefined : host,
      lookup: egressLookup() as unknown as net.LookupFunction,
      rejectUnauthorized: false,
    })
    socket.setTimeout(timeoutMs)
    socket.once('timeout', () => finish({ ok: false, error: `TLS handshake timed out after ${timeoutMs}ms` }))
    socket.once('error', (err: Error) => finish({ ok: false, error: err.message.slice(0, 300) }))
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate(true)
      if (!cert || !cert.valid_to) { finish({ ok: false, error: 'server presented no certificate' }); return }
      const identityError = tls.checkServerIdentity(host, cert)
      const info = describeCertificate(cert as PeerCert, host, {
        authorized: socket.authorized,
        authError: socket.authorized ? null : String(socket.authorizationError ?? 'untrusted certificate'),
        protocol: socket.getProtocol(),
        hostnameOk: identityError === undefined,
      }, now())
      if (!info) { finish({ ok: false, error: 'certificate dates could not be read' }); return }
      finish({ ok: true, info })
    })
  })
}

export interface CertThresholds { warnDays: number; criticalDays: number }

/**
 * Pure verdict. An expired or invalid certificate is DOWN; a certificate inside the critical window is DOWN too (an operator who
 * sets `certCriticalDays` is asking to be told before it breaks); inside the warning window it is DEGRADED.
 */
export function certVerdict(info: CertInfo, t: CertThresholds, now: Date): Pick<CheckOutcome, 'status' | 'error'> {
  if (now.getTime() < info.validFrom.getTime()) return { status: 'DOWN', error: 'certificate is not valid yet' }
  if (info.daysToExpiry < 0 || now.getTime() > info.validTo.getTime()) {
    const ago = Math.max(0, Math.floor((now.getTime() - info.validTo.getTime()) / DAY_MS))
    return { status: 'DOWN', error: `certificate expired ${ago} day${ago === 1 ? '' : 's'} ago` }
  }
  if (!info.hostnameOk) return { status: 'DOWN', error: 'certificate does not match the host name' }
  if (!info.authorized) return { status: 'DOWN', error: `certificate chain is not trusted (${(info.authError ?? 'unknown').slice(0, 80)})` }
  if (info.daysToExpiry <= t.criticalDays) return { status: 'DOWN', error: `certificate expires in ${info.daysToExpiry} day${info.daysToExpiry === 1 ? '' : 's'} (critical at ${t.criticalDays})` }
  if (info.daysToExpiry <= t.warnDays) return { status: 'DEGRADED', error: `certificate expires in ${info.daysToExpiry} days (warning at ${t.warnDays})` }
  return { status: 'UP', error: null }
}

export function thresholdsOf(m: Pick<Monitor, 'certWarnDays' | 'certCriticalDays'>): CertThresholds {
  const warn = m.certWarnDays ?? DEFAULT_CERT_WARN_DAYS
  const critical = Math.min(m.certCriticalDays ?? DEFAULT_CERT_CRITICAL_DAYS, warn)
  return { warnDays: warn, criticalDays: critical }
}

type TlsMonitor = Pick<Monitor, 'target' | 'timeoutMs' | 'certWarnDays' | 'certCriticalDays' | 'degradedLatencyMs'>

/** `TLS` — is the certificate valid, trusted, for this host, and far enough from expiry. */
export async function runTlsCheck(monitor: TlsMonitor, now: () => Date = () => new Date()): Promise<CheckOutcome> {
  const { host, port } = parseTarget(monitor.target)
  if (!host) return { status: 'DOWN', latencyMs: null, statusCode: null, error: 'TLS target needs a host' }
  const r = await inspectCertificate(host, port ?? 443, monitor.timeoutMs ?? 10_000, now)
  if (!r.ok) return { status: 'DOWN', latencyMs: r.latencyMs, statusCode: null, error: r.error }
  const v = certVerdict(r.info, thresholdsOf(monitor), now())
  return { status: v.status, latencyMs: r.latencyMs, statusCode: null, error: v.error }
}

/**
 * The certificate half of an HTTPS monitor with `certWarnDays` set: the HTTP verdict stays, and a bad or nearly-expired certificate
 * can only make it worse (UP → DEGRADED or DOWN, never the other way).
 */
export async function certIssueForUrl(url: string, monitor: TlsMonitor, now: () => Date = () => new Date()): Promise<Pick<CheckOutcome, 'status' | 'error'> | null> {
  let parsed: URL
  try { parsed = new URL(url) } catch { return null }
  if (parsed.protocol !== 'https:') return null
  const r = await inspectCertificate(parsed.hostname, parsed.port ? Number(parsed.port) : 443, monitor.timeoutMs ?? 10_000, now)
  if (!r.ok) return { status: 'DOWN', error: r.error }
  const v = certVerdict(r.info, thresholdsOf(monitor), now())
  return v.status === 'UP' ? null : v
}
