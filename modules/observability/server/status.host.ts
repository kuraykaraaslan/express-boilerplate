import 'reflect-metadata'
import Logger from '@kuraykaraaslan-labs/logger'
import { normalizeHostname } from './status.page.rules'

/**
 * The host → page binding as the proxy reads it (observability phase 15.4).
 *
 * The proxy must decide, on the root path of every domain-mode request, whether the host is bound to a status page, and it must do so with
 * ONE cheap read and no database. So the bindings are mirrored into Redis under `status:host:<host>` = `<tenantId>:<slug>`:
 *
 *  - written when a page is created or edited with a host (and the page is on), removed when the host is unbound, the page is switched off or
 *    deleted;
 *  - re-written by the heartbeat (`syncHostBindings`, every five minutes, with a 30-minute lifetime), so a lost key, a restarted Redis or an
 *    edit made behind our back repairs itself within one beat and a stale key can outlive a deleted page by 30 minutes at most.
 *
 * The proxy additionally requires the tenant in the value to be the tenant `tenant_domain` resolved the host to, so a key can never serve
 * one tenant's page on another tenant's host. Redis being unreadable means "no binding" for the proxy (the tenant's site answers).
 */

export const HOST_KEY_PREFIX = 'status:host:'
export const HOST_TTL_SECONDS = 30 * 60

export const hostKey = (host: string) => `${HOST_KEY_PREFIX}${host}`

async function redis() {
  const { default: client } = await import('@kuraykaraaslan-labs/redis')
  return client
}

export async function setHostBinding(tenantId: string, host: string, slug: string): Promise<void> {
  const h = normalizeHostname(host)
  if (!h) return
  try { await (await redis()).set(hostKey(h), `${tenantId}:${slug}`, 'EX', HOST_TTL_SECONDS) } catch (err) {
    Logger.warn(`[observability] status host binding not written: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function clearHostBinding(host: string | null | undefined): Promise<void> {
  const h = host ? normalizeHostname(host) : null
  if (!h) return
  try { await (await redis()).del(hostKey(h)) } catch { /* the 30-minute lifetime clears it */ }
}

/** Bring the mirror of one tenant in line with its pages: set what is bound and on, clear what is bound and off. */
export async function syncHostBindings(tenantId: string, pages: Array<{ slug: string; domain?: string | null; enabled: boolean }>): Promise<void> {
  for (const p of pages) {
    if (!p.domain) continue
    if (p.enabled) await setHostBinding(tenantId, p.domain, p.slug)
    else await clearHostBinding(p.domain)
  }
}
