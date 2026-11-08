import { lookup } from 'node:dns/promises'
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service'
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { safeFetch } from '@kuraykaraaslan-labs/common/server/safe-fetch'
import { ipv4ToInt, ipv6ToBigInt } from '@kuraykaraaslan-labs/common/server/ip-guard'

/**
 * storage.08 (decided 2026-10-21): every request the SERVER makes to a storage endpoint (downloadBuffer, the link proxy
 * mode, the scan job, a migration copy, bucket CORS, the direct-upload calls) goes through `safeFetch`. `s3Endpoint` is a
 * tenant setting, so a tenant admin could point it at 169.254.169.254 or an internal service and read the answer back.
 *
 * The PLATFORM endpoint (the root tenant's `s3Endpoint`, which tenants inherit) may be a
 * self-hosted MinIO on a private or loopback address: its resolved addresses are listed, and the mode is
 * `public_or_listed`, so public addresses and exactly the platform endpoint's are reachable and a tenant-set endpoint is
 * held to public addresses. (The `operator` mode would admit ONLY the listed addresses, which would also refuse a tenant's
 * own public bucket; `public_or_listed` is the decided "platform endpoint allowed, tenant endpoint public only".)
 * DNS of the target is pinned by safeFetch's validating lookup; redirects are not followed.
 */
const PLATFORM_LIST_TTL_MS = 60_000
let cached: { at: number; list: string[] } | null = null

function hostOf(endpoint: string): string | null {
  try {
    const host = new URL(endpoint.includes('://') ? endpoint : `http://${endpoint}`).hostname
    return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  } catch {
    return null
  }
}

export async function platformStorageAddresses(now = Date.now()): Promise<string[]> {
  if (cached && now - cached.at < PLATFORM_LIST_TTL_MS) return cached.list
  let rootEndpoint: string | undefined
  try {
    rootEndpoint = (await SettingService.getByKeys(ROOT_TENANT_ID, ['s3Endpoint']))?.s3Endpoint || undefined
  } catch { /* unreadable: nothing is listed, so only public addresses are reachable (fails closed for a private endpoint) */ }
  const list = new Set<string>()
  for (const endpoint of [rootEndpoint]) {
    const host = endpoint ? hostOf(endpoint) : null
    if (!host) continue
    if (ipv4ToInt(host) !== null || (host.includes(':') && ipv6ToBigInt(host) !== null)) { list.add(host); continue }
    try {
      for (const a of await lookup(host, { all: true })) list.add(a.address)
    } catch { /* an unresolvable platform host lists nothing */ }
  }
  cached = { at: now, list: [...list] }
  return cached.list
}

/** Test seam: forget the cached platform list. */
export function resetPlatformStorageAddresses(): void {
  cached = null
}

/** A server-side request to a storage endpoint: public addresses, or the platform endpoint's own (see above). */
export async function storageFetch(url: string, init: RequestInit = {}): Promise<Response> {
  // `cache` is a browser / Next fetch option; a server-side request has no HTTP cache to bypass
  const { cache: _cache, ...rest } = init
  void _cache
  const res = await safeFetch(url, rest as never, { ipAllowlist: await platformStorageAddresses(), ipAllowlistMode: 'public_or_listed' })
  return res as unknown as Response
}
