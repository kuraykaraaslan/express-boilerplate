import Logger from '@kuraykaraaslan-labs/logger'
import type { WatchdogSignal } from './watchdog'
import { loadOnCallPeer } from './peers/peers'

/**
 * What the minutely watchdog push says (observability phase 19.5 / 12.8). Normally "alive". It says "alive, and something is wrong" (`/fail`) when the
 * paging self-test has gone SILENT: a self-test that stopped running cannot raise its own alert, and the watchdog job is the one thing that still runs
 * when only the on-call worker is dead. (When the whole scheduler or Redis is dead the pushes stop altogether, and that silence is the signal.)
 * on_call is optional: a build without it, or any trouble reading it that is not a verdict, leaves the signal at "ok".
 */
export async function currentWatchdogSignal(): Promise<{ signal: WatchdogSignal; silent: string[] }> {
  let peer: Awaited<ReturnType<typeof loadOnCallPeer>> = null
  try {
    peer = await loadOnCallPeer(null, 'observability: watchdog, the paging self-test belongs to no tenant')
  } catch {
    return { signal: 'ok', silent: [] }
  }
  if (!peer) return { signal: 'ok', silent: [] }
  try {
    const silent = await peer.silentSelfTests()
    if (silent.length === 0) return { signal: 'ok', silent }
    Logger.error(`[watchdog] the paging self-test has gone silent for ${silent.length} tenant(s): reporting FAIL to the outside party`)
    return { signal: 'fail', silent }
  } catch (err) {
    Logger.error(`[watchdog] the paging self-test could not be checked: ${err instanceof Error ? err.message : String(err)}`)
    return { signal: 'fail', silent: ['check_failed'] }
  }
}
