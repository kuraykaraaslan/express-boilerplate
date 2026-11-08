import { AsyncLocalStorage } from 'node:async_hooks'
import { createValidatingLookup } from '@kuraykaraaslan-labs/common/server/safe-fetch'

/**
 * How far a probe may reach, set per call (observability phase 10.6).
 *
 * The control plane's own probes run with no egress context and keep the strict rule: public addresses only. A PRIVATE runner runs each
 * check inside `withEgress({ ipAllowlist })`: public addresses stay allowed, and addresses inside the tenant's declared CIDRs become allowed
 * too, so the runner can reach its own network and nothing else private. The connection guard (`createValidatingLookup`) is the same code
 * either way: this only changes the list it is handed, so there is no second guard to drift out of step with the first.
 */
export interface Egress { ipAllowlist: string[] }

const store = new AsyncLocalStorage<Egress>()

export const withEgress = <T>(egress: Egress, fn: () => Promise<T>): Promise<T> => store.run(egress, fn)
export const currentEgress = (): Egress | undefined => store.getStore()

/** Options for `safeFetch`. */
export function egressFetchOptions(): { ipAllowlist?: string[]; ipAllowlistMode?: 'public_or_listed' } {
  const e = store.getStore()
  return e && e.ipAllowlist.length > 0 ? { ipAllowlist: e.ipAllowlist, ipAllowlistMode: 'public_or_listed' } : {}
}

/** The `net.connect` / `tls.connect` lookup for this call. */
export function egressLookup() {
  const e = store.getStore()
  return e && e.ipAllowlist.length > 0 ? createValidatingLookup(e.ipAllowlist, undefined, 'public_or_listed') : createValidatingLookup()
}
