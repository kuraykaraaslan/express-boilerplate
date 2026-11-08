import { runCheck } from '../server/uptime.probe.service'
import { withEgress } from '../server/probe.egress'
import type { LeaseResponse, ResultBody } from './probe-runner.protocol'

type Lease = LeaseResponse['leases'][number]

/** Runs a BROWSER check. Only the browser runner image supplies one; the plain runner has none and answers UNKNOWN for such a lease. */
export type BrowserExecutor = (check: Lease['check'], egress: LeaseResponse['egress']) => Promise<Pick<ResultBody, 'status' | 'latencyMs' | 'statusCode' | 'error' | 'browser'>>

/**
 * Run one leased check and turn it into a result (observability phase 10.2). The probes are the SAME code the control plane runs, so a
 * check means the same thing wherever it runs. A private runner runs each check inside its egress context (public addresses plus the tenant's
 * declared CIDRs); a public runner runs with none, so it keeps the strict rule and can reach public addresses only.
 *
 * BROWSER checks (D-OBS-8) are not run by `runCheck` (that code never launches a browser): they go to the executor the browser image passes in.
 */
export async function executeLease(lease: Lease, egress: LeaseResponse['egress'], extras: { browser?: BrowserExecutor } = {}): Promise<ResultBody> {
  const base = { tenantId: lease.tenantId, leaseId: lease.leaseId }
  try {
    if (lease.check.type === 'BROWSER') {
      if (!extras.browser) return { ...base, status: 'UNKNOWN', latencyMs: null, statusCode: null, error: 'this runner cannot run browser checks (it is not the browser image)' }
      const r = await extras.browser(lease.check, egress)
      return { ...base, ...r }
    }
    const monitor = { ...lease.check, monitorId: lease.monitorId } as unknown as Parameters<typeof runCheck>[0]
    const run = () => runCheck(monitor)
    const outcome = egress.cidrs.length > 0 ? await withEgress({ ipAllowlist: egress.cidrs }, run) : await run()
    return { ...base, status: outcome.status, latencyMs: outcome.latencyMs, statusCode: outcome.statusCode, error: outcome.error }
  } catch (err) {
    // The probes never throw for a down target; reaching here is the runner's own fault, and "we could not look" is UNKNOWN, never DOWN.
    return { ...base, status: 'UNKNOWN', latencyMs: null, statusCode: null, error: `runner error: ${(err instanceof Error ? err.message : String(err)).slice(0, 250)}` }
  }
}
