import { lookup as dnsLookup } from 'node:dns'
import { isBlockedIp, matchesAllowEntry } from '@kuraykaraaslan-labs/common/server/ip-guard'
import { parseTarget } from './uptime.probe.net'
import type { MonitorType } from './uptime.enums'

/**
 * Which targets a probe location may be given (observability phase 10.6). Pure except `publicTargetCheck`, which resolves DNS.
 *
 *  - A PRIVATE runner sits inside the tenant's network and may reach private ranges BY DESIGN, so it is restricted the other way round: the tenant
 *    declares the CIDRs and hostnames it may reach and everything else is refused. An empty policy allows nothing.
 *  - A PUBLIC runner is operated by the platform and must never be pointed at an internal address, whatever DNS says today.
 */
export interface TargetPolicy { cidrs: string[]; hostnames: string[] }

export const EMPTY_POLICY: TargetPolicy = { cidrs: [], hostnames: [] }
const HOST_RE = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/

export function normalisePolicy(raw: unknown): TargetPolicy {
  const o = (raw && typeof raw === 'object' ? raw : {}) as { cidrs?: unknown; hostnames?: unknown }
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim().toLowerCase()).filter(Boolean) : [])
  return { cidrs: [...new Set(strings(o.cidrs))].slice(0, 100), hostnames: [...new Set(strings(o.hostnames))].slice(0, 100) }
}

/** Why a policy entry is invalid, or null. A CIDR must parse; a hostname is an exact name or `*.suffix`. */
export function policyEntryProblem(kind: 'cidr' | 'hostname', entry: string): string | null {
  if (kind === 'hostname') return HOST_RE.test(entry) ? null : `"${entry}" is not a hostname or *.suffix`
  const [base, bits] = entry.split('/')
  const max = base?.includes(':') ? 128 : 32
  const n = Number(bits)
  const looksIp = /^[0-9a-f:.]+$/i.test(base ?? '')
  if (!looksIp || (bits !== undefined && (!Number.isInteger(n) || n < 0 || n > max))) return `"${entry}" is not an IP or CIDR`
  // a /0 would allow everything: that is "no policy", and it must be said as such rather than hidden in a CIDR
  if (bits !== undefined && n < 8 && !base.includes(':')) return `"${entry}" is too broad (smallest allowed prefix is /8)`
  return null
}

/** The host part of a monitor target for any type (URL, host:port or bare host). */
export function targetHost(type: MonitorType | string, target: string): string | null {
  if (type === 'HEARTBEAT' || type === 'STEPS') return null
  const t = target.trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) { try { return new URL(t).hostname.replace(/^\[|\]$/g, '').toLowerCase() } catch { return null } }
  if (type === 'DNS') return t.toLowerCase()
  const host = parseTarget(t).host
  return host ? host.toLowerCase() : null
}

export function hostAllowedByPolicy(host: string, policy: TargetPolicy): boolean {
  const h = host.toLowerCase()
  if (policy.hostnames.some((e) => (e.startsWith('*.') ? h.endsWith(e.slice(1)) && h.length > e.length - 1 : h === e))) return true
  return policy.cidrs.some((c) => matchesAllowEntry(h, c))
}

/**
 * May a PRIVATE runner be given this target? Only when the host matches the tenant's declared policy. STEPS monitors name several hosts
 * (one per step) and are judged by `stepsHosts`.
 */
export function privateTargetAllowed(host: string | null, policy: TargetPolicy): boolean {
  return host !== null && hostAllowedByPolicy(host, policy)
}

type Resolve = (host: string) => Promise<string[]>
const defaultResolve: Resolve = (host) => new Promise((resolve, reject) => dnsLookup(host, { all: true }, (err, list) => (err ? reject(err) : resolve(list.map((a) => a.address)))))

/**
 * May a PUBLIC runner be given this target? Every address the host resolves to must be public. A name that does not resolve is refused
 * (a runner cannot probe what the platform cannot even look up). The runner repeats the check at connect time, so this is the early refusal
 * and the pinned connection is the one that cannot be raced.
 */
export async function publicTargetCheck(host: string | null, resolve: Resolve = defaultResolve): Promise<{ ok: boolean; reason?: string }> {
  if (!host) return { ok: false, reason: 'the target has no host' }
  const literal = /^[0-9a-f:.]+$/i.test(host) && (host.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(host))
  let addresses: string[]
  try { addresses = literal ? [host] : await resolve(host) } catch { return { ok: false, reason: `"${host}" does not resolve` } }
  if (addresses.length === 0) return { ok: false, reason: `"${host}" does not resolve` }
  const blocked = addresses.find((a) => isBlockedIp(a))
  return blocked ? { ok: false, reason: `"${host}" resolves to ${blocked}, a private or reserved address` } : { ok: true }
}
