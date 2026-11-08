/**
 * Runner version skew (observability phase 10.7). The runner reports its version when it enrols and on every heartbeat; the control plane
 * judges it against two numbers it owns:
 *  - `MIN_SUPPORTED_RUNNER`: below this the wire contract may differ, so the runner is refused work (426) rather than fed leases it could
 *    mis-handle: a wrong verdict from an old runner is worse than a missing one.
 *  - `CURRENT_RUNNER`: below this but supported is "outdated": it works, and the screen says to update.
 * Pure, so the screen, the lease and the tests all read the same rule. Raise MIN only together with a change of the lease or result shape.
 */
export const CURRENT_RUNNER = '1.1.0'
export const MIN_SUPPORTED_RUNNER = '1.0.0'

export type RunnerSkew = 'current' | 'outdated' | 'unsupported' | 'unknown'

function parse(v: string | null | undefined): [number, number, number] | null {
  const m = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})(?:[-+].*)?$/.exec((v ?? '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

const cmp = (a: [number, number, number], b: [number, number, number]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

export function runnerSkew(version: string | null | undefined): RunnerSkew {
  const v = parse(version)
  if (!v) return 'unknown'
  if (cmp(v, parse(MIN_SUPPORTED_RUNNER)!) < 0) return 'unsupported'
  return cmp(v, parse(CURRENT_RUNNER)!) < 0 ? 'outdated' : 'current'
}
