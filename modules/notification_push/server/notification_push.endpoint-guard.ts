import { lookup } from 'node:dns/promises'
import { isBlockedIp } from '@kuraykaraaslan-labs/common/server/ip-guard'

/**
 * Where a Web Push endpoint may point (notification_push.02, fixed 2026-10-20).
 *
 * The server POSTs every notification to the stored endpoint, so it must be a public https push service:
 *  - at subscribe time, `isPublicPushEndpoint`: https only, no credentials, a DNS name (never an IP literal, which also catches
 *    the numeric forms the URL parser normalises, e.g. 0x7f000001 and 2130706433), and no single-label, localhost or
 *    private-suffix name (`.internal` is where cloud metadata lives);
 *  - at send time, `endpointResolvesPublic`: the same rules again, and every address the name resolves to NOW must be a public
 *    one (the common SSRF guard's `isBlockedIp`), so a name that later moves to a private address (DNS rebinding) is not sent to.
 */
const PRIVATE_SUFFIXES = ['.localhost', '.internal', '.local', '.lan', '.home', '.corp', '.intranet', '.localdomain']

export function isPublicPushEndpoint(raw: string): boolean {
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host || host === 'localhost' || !host.includes('.')) return false
  if (host.includes(':') || /^\d+(\.\d+){3}$/.test(host)) return false
  return !PRIVATE_SUFFIXES.some((s) => host.endsWith(s))
}

/** True when the endpoint passes `isPublicPushEndpoint` and every resolved address is public. Fails closed on a DNS error. */
export async function endpointResolvesPublic(
  raw: string,
  resolve: (host: string) => Promise<Array<{ address: string }>> = (host) => lookup(host, { all: true }),
): Promise<boolean> {
  if (!isPublicPushEndpoint(raw)) return false
  try {
    const addresses = await resolve(new URL(raw).hostname)
    return addresses.length > 0 && addresses.every((a) => !isBlockedIp(a.address))
  } catch {
    return false
  }
}
