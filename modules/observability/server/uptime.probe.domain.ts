import { getDomain } from 'tldts'
import { safeFetch } from '@kuraykaraaslan-labs/common/server/safe-fetch'
import { parseTarget } from './uptime.probe.net'
import { thresholdsOf } from './uptime.probe.tls'
import type { Monitor } from './entities/monitor.entity'
import type { CheckOutcome } from './uptime.probe.service'

/**
 * Domain-expiry monitoring through RDAP (observability phase 09.2).
 *
 * RDAP is the machine-readable successor to WHOIS: the IANA bootstrap file says which registry answers for a TLD, and that
 * registry returns an `events` array with an `expiration` entry. Every request goes through `safeFetch`.
 *
 * Honesty about gaps: some TLDs have no RDAP service and some registries hide the expiry date. Those return an INCONCLUSIVE sample
 * (`UNKNOWN`, with the reason) rather than UP. A domain nobody could look at is not a healthy domain, and it is not an outage either.
 *
 * Results are cached for hours: a domain's expiry changes about once a year, and the registries rate-limit.
 */

const BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json'
const BOOTSTRAP_TTL_MS = 24 * 3_600_000
const RESULT_TTL_MS = 12 * 3_600_000
const MAX_CACHE = 500
const DAY_MS = 86_400_000

type Bootstrap = Map<string, string>

let bootstrapCache: { at: number; map: Bootstrap } | null = null
const resultCache = new Map<string, { at: number; expiresAt: Date | null; reason: string | null }>()

/** Test hook. */
export function resetDomainCaches(): void { bootstrapCache = null; resultCache.clear() }

/** The registrable domain of a host (`www.example.co.uk` → `example.co.uk`), or null for an IP, a bare TLD or garbage. */
export function registrableDomain(host: string): string | null {
  return getDomain(host.trim().toLowerCase()) ?? null
}

/** Pure: tld → RDAP base URL, from the IANA bootstrap document. */
export function parseBootstrap(doc: unknown): Bootstrap {
  const map: Bootstrap = new Map()
  const services = (doc as { services?: unknown })?.services
  if (!Array.isArray(services)) return map
  for (const svc of services) {
    if (!Array.isArray(svc) || !Array.isArray(svc[0]) || !Array.isArray(svc[1])) continue
    const base = (svc[1] as unknown[]).find((u): u is string => typeof u === 'string' && u.startsWith('https://'))
    if (!base) continue
    for (const tld of svc[0] as unknown[]) if (typeof tld === 'string') map.set(tld.toLowerCase(), base)
  }
  return map
}

/** Pure: the `expiration` event of an RDAP domain object, or null. */
export function parseRdapExpiry(doc: unknown): Date | null {
  const events = (doc as { events?: unknown })?.events
  if (!Array.isArray(events)) return null
  for (const e of events) {
    const ev = e as { eventAction?: unknown; eventDate?: unknown }
    if (ev?.eventAction === 'expiration' && typeof ev.eventDate === 'string') {
      const d = new Date(ev.eventDate)
      if (!Number.isNaN(d.getTime())) return d
    }
  }
  return null
}

async function loadBootstrap(timeoutMs: number): Promise<Bootstrap> {
  if (bootstrapCache && Date.now() - bootstrapCache.at < BOOTSTRAP_TTL_MS) return bootstrapCache.map
  const res = await safeFetch(BOOTSTRAP_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`RDAP bootstrap answered ${res.status}`)
  const map = parseBootstrap(await res.json())
  if (map.size === 0) throw new Error('RDAP bootstrap was empty')
  bootstrapCache = { at: Date.now(), map }
  return map
}

async function lookupExpiry(domain: string, timeoutMs: number): Promise<{ expiresAt: Date | null; reason: string | null }> {
  const cached = resultCache.get(domain)
  if (cached && Date.now() - cached.at < RESULT_TTL_MS) return { expiresAt: cached.expiresAt, reason: cached.reason }

  const tld = domain.slice(domain.lastIndexOf('.') + 1)
  const base = (await loadBootstrap(timeoutMs)).get(tld)
  let out: { expiresAt: Date | null; reason: string | null }
  if (!base) {
    out = { expiresAt: null, reason: `no RDAP service is published for .${tld}` }
  } else {
    const res = await safeFetch(`${base.replace(/\/?$/, '/')}domain/${encodeURIComponent(domain)}`, {
      headers: { Accept: 'application/rdap+json, application/json' }, signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 404) out = { expiresAt: null, reason: 'the registry does not know this domain' }
    else if (!res.ok) throw new Error(`RDAP registry answered ${res.status}`)
    else {
      const expiresAt = parseRdapExpiry(await res.json())
      out = { expiresAt, reason: expiresAt ? null : 'the registry does not publish an expiry date' }
    }
  }
  if (resultCache.size >= MAX_CACHE) resultCache.delete(resultCache.keys().next().value as string)
  resultCache.set(domain, { at: Date.now(), ...out })
  return out
}

/** Pure verdict from an expiry date. Same thresholds and meaning as the certificate check. */
export function domainVerdict(expiresAt: Date, t: { warnDays: number; criticalDays: number }, now: Date): Pick<CheckOutcome, 'status' | 'error'> {
  const days = Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS)
  if (days < 0) return { status: 'DOWN', error: `domain expired ${-days} day${days === -1 ? '' : 's'} ago` }
  if (days <= t.criticalDays) return { status: 'DOWN', error: `domain expires in ${days} day${days === 1 ? '' : 's'} (critical at ${t.criticalDays})` }
  if (days <= t.warnDays) return { status: 'DEGRADED', error: `domain expires in ${days} days (warning at ${t.warnDays})` }
  return { status: 'UP', error: null }
}

type DomainMonitor = Pick<Monitor, 'target' | 'timeoutMs' | 'certWarnDays' | 'certCriticalDays'>

/** `DOMAIN` — how long until the registration lapses. */
export async function runDomainCheck(monitor: DomainMonitor, now: () => Date = () => new Date()): Promise<CheckOutcome> {
  const started = Date.now()
  const domain = registrableDomain(parseTarget(monitor.target).host)
  if (!domain) return { status: 'DOWN', latencyMs: null, statusCode: null, error: 'DOMAIN target needs a registrable domain name' }
  try {
    const { expiresAt, reason } = await lookupExpiry(domain, monitor.timeoutMs ?? 10_000)
    const latencyMs = Date.now() - started
    if (!expiresAt) return { status: 'UNKNOWN', latencyMs, statusCode: null, error: `expiry unknown: ${reason}` }
    const v = domainVerdict(expiresAt, thresholdsOf(monitor), now())
    return { status: v.status, latencyMs, statusCode: null, error: v.error }
  } catch (err) {
    // A registry that is down or rate-limiting tells us nothing about the domain: inconclusive, not DOWN.
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'UNKNOWN', latencyMs: Date.now() - started, statusCode: null, error: `RDAP lookup failed: ${message}`.slice(0, 300) }
  }
}
