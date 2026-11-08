import { resolve4, resolve6, resolveCname, resolveTxt, resolveMx } from 'node:dns/promises'

/**
 * The record resolvers, behind one first-party module.
 *
 * A thin indirection with a reason: `node:net` reaches into `node:dns` itself,
 * so a test that replaces the built-in wholesale breaks the loopback server the
 * TCP probes are tested against. Naming the map here lets a test substitute
 * DNS without touching what TCP depends on.
 */
export const DNS_RESOLVERS = {
  A: resolve4, AAAA: resolve6, CNAME: resolveCname, TXT: resolveTxt, MX: resolveMx,
} as const

export type DnsRecordType = keyof typeof DNS_RESOLVERS
