import Logger from '@kuraykaraaslan-labs/logger'
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { OBSERVABILITY_SETTING_KEYS } from './observability.setting.keys'

/**
 * Watch the watcher (observability phase 19.5). A monitoring system that alerts about everything except its own death has a hole exactly where it matters, so the
 * platform pushes a heartbeat to an endpoint OUTSIDE itself (a dead-man's switch such as healthchecks.io, a partner's monitor, or another deployment's heartbeat
 * URL). When this process, its scheduler or the database stops, the pushes stop, and the outside party raises the alarm through a path that does not depend on
 * anything here.
 *
 * Configured by the ROOT tenant's setting `observabilityWatchdogUrl` (an https URL; empty = off). Conventions follow the common dead-man's-switch services:
 * `GET <url>` is "alive", `GET <url>/fail` is "I am alive and something is wrong" (healthchecks.io and Better Stack both define exactly that; the other
 * common providers differ, see PROVIDER_FAIL below and docs/guides/observability/watchdog-providers.md). The platform also HOSTS other people's heartbeats: the ordinary heartbeat
 * monitors of the ROOT tenant are exactly that, so a partner's cron job can watch this platform the same way.
 */
export type WatchdogSignal = 'ok' | 'fail'

type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<{ status: number }>
const defaultFetch: Fetcher = async (url, init) => {
  const { safeFetch } = await import('@kuraykaraaslan-labs/common/server/safe-fetch')
  const res = await safeFetch(url, { method: 'GET', redirect: 'manual', signal: init.signal, headers: { 'user-agent': 'platform-watchdog' } })
  void res.body?.cancel().catch(() => undefined)
  return { status: res.status }
}

export interface WatchdogDeps {
  url(): Promise<string | null>
  fetch: Fetcher
  now(): number
}
const defaultDeps: WatchdogDeps = {
  async url() {
    try {
      const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service')
      return (await SettingService.getValue(ROOT_TENANT_ID, OBSERVABILITY_SETTING_KEYS.WATCHDOG_URL)) || null
    } catch { return null }
  },
  fetch: defaultFetch,
  now: Date.now,
}
let deps: WatchdogDeps = defaultDeps
/** Test seam. */
export function setWatchdogDeps(d?: Partial<WatchdogDeps>): void { deps = d ? { ...defaultDeps, ...d } : defaultDeps; last.clear() }

/**
 * How a provider spells "something is wrong" (from each provider's public documentation, read 2026-10-18):
 *  - healthchecks.io (`hc-ping.com`): `<ping url>/fail`
 *  - Better Stack (`*.betterstack.com`): `<heartbeat url>/fail`
 *  - Cronitor (`cronitor.link`, `eu.cronitor.link`): `?state=fail` (a path suffix is not part of its API; a plain GET records only a "tick")
 *  - Dead Man's Snitch (`nosnch.in`): no failure signal exists; the missing check-in is the alarm, so `fail` sends nothing
 *  - anything else (a partner's monitor, another deployment's heartbeat URL): the `/fail` convention
 */
export function failStyleOf(host: string): 'path' | 'query-state' | 'none' {
  const h = host.toLowerCase()
  if (h === 'cronitor.link' || h.endsWith('.cronitor.link')) return 'query-state'
  if (h === 'nosnch.in' || h.endsWith('.nosnch.in')) return 'none'
  return 'path'
}

/** The URL to call for a signal, or null when the configured value is not acceptable (https only, no credentials) or the provider has no such signal. */
export function watchdogUrlFor(base: string | null, signal: WatchdogSignal): string | null {
  if (!base) return null
  let u: URL
  try { u = new URL(base) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password) return null
  if (signal === 'fail') {
    const style = failStyleOf(u.hostname)
    if (style === 'none') return null
    if (style === 'query-state') u.searchParams.set('state', 'fail')
    else u.pathname = `${u.pathname.replace(/\/+$/, '')}/fail`
  }
  return u.toString()
}

const last = new Map<WatchdogSignal, number>()
/** A failure is pushed at most this often however many failing checks report it; the periodic "ok" is its own cadence. */
const MIN_GAP_MS = 20_000

/** Push one signal. Never throws: the watchdog is the last thing that may take anything down. */
export async function pushWatchdog(signal: WatchdogSignal): Promise<{ pushed: boolean; reason?: string }> {
  const now = deps.now()
  if (now - (last.get(signal) ?? 0) < MIN_GAP_MS) return { pushed: false, reason: 'rate-limited' }
  const url = watchdogUrlFor(await deps.url(), signal)
  if (!url) return { pushed: false, reason: 'not configured' }
  last.set(signal, now)
  try {
    const res = await deps.fetch(url, { signal: AbortSignal.timeout(5000) })
    if (res.status >= 400) { Logger.warn(`[watchdog] ${signal} answered ${res.status}`); return { pushed: false, reason: `status ${res.status}` } }
    return { pushed: true }
  } catch (err) {
    Logger.warn(`[watchdog] ${signal} not delivered: ${err instanceof Error ? err.message : String(err)}`)
    return { pushed: false, reason: 'unreachable' }
  }
}
