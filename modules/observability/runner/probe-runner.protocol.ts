/**
 * The wire contract between a probe runner and the control plane (observability phase 10.2), as pure data and pure functions: no environment, no logger,
 * no database. The runner imports only this file and the probe code itself, so a runner inside a tenant's network needs no platform secrets.
 */
import { generateNonce, sha256Hex, signRequest } from '../server/probe.signing'

/** The logical route prefix every signed request is bound to (the tenant and any proxy rewriting are not part of what is signed). */
export const PROBE_API_PATH = '/api/public/probe'

export const RUNNER_HEADER = {
  runner: 'x-probe-runner', timestamp: 'x-probe-timestamp', nonce: 'x-probe-nonce', signature: 'x-probe-signature',
} as const

export interface LeaseResponse {
  leases: Array<{
    leaseId: string; tenantId: string; monitorId: string; locationKey: string; deadline: string
    check: {
      type: string; target: string; timeoutMs: number | null; expectedStatus: number | null; expectedBodyContains: string | null
      degradedLatencyMs: number | null; headers: Record<string, string> | null; assertions: unknown; certWarnDays: number | null
      certCriticalDays: number | null; steps: unknown; secrets?: Record<string, string>
      /** BROWSER only: the closed step grammar. Only a runner that reported the `browser` capability is ever leased one. */
      browser?: unknown
    }
  }>
  /** PRIVATE locations: the CIDRs this runner may reach in addition to public addresses. Empty for a public runner. */
  egress: { cidrs: string[] }
  pollSeconds: number
  /** Due checks the control plane did not lease on this poll because a lease cap was hit. They stay due; absent from an older control plane. */
  shed?: number
}

export interface ResultBody {
  tenantId: string; leaseId: string; status: 'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN'; latencyMs: number | null; statusCode: number | null; error: string | null
  /** BROWSER only (additive: a control plane that does not know it drops it): the bounded run record and, for a failed run, one JPEG (base64, at most 300 KB). */
  browser?: { detail: unknown; screenshotJpegBase64?: string }
}

/** What a runner can do beyond the base checks. Reported when it enrols and on every heartbeat; the control plane leases a capability's checks only to runners that report it. */
export const RUNNER_CAPABILITY_BROWSER = 'browser'

/** Headers for one signed request. `path` is the URL path exactly as the server will see it. */
export function signedHeaders(opts: { privateKeyPem: string; runnerId: string; method: string; path: string; body: string; now?: Date }): Record<string, string> {
  const timestamp = (opts.now ?? new Date()).getTime()
  const nonce = generateNonce()
  const signature = signRequest(opts.privateKeyPem, { method: opts.method, path: opts.path, timestamp, nonce, bodySha256: sha256Hex(opts.body) })
  return {
    'content-type': 'application/json',
    [RUNNER_HEADER.runner]: opts.runnerId, [RUNNER_HEADER.timestamp]: String(timestamp), [RUNNER_HEADER.nonce]: nonce, [RUNNER_HEADER.signature]: signature,
  }
}
