import { createServer, type Server } from 'node:http'
import { hostname } from 'node:os'
import { readFileSync } from 'node:fs'
import { loadOrCreateIdentity, saveRunnerId, type RunnerIdentity } from './probe-runner.keys'
import { PROBE_API_PATH, RUNNER_CAPABILITY_BROWSER, signedHeaders, type LeaseResponse, type ResultBody } from './probe-runner.protocol'
import { executeLease, type BrowserExecutor } from './probe-runner.exec'

/**
 * The probe runner (observability phase 10.2): a small process that runs inside any network, pulls the checks of ONE location from the control
 * plane and posts the results back. It needs no inbound port and no platform secrets: only the control-plane URL, its own key and (first start only) a
 * single-use enrolment token.
 *
 *   PROBE_CONTROL_URL   https://<app>/api/public/probe (path-mode installs carry the tenant prefix)  (shown with the enrolment token)
 *   PROBE_ENROL_TOKEN   pe_...                                            (first start only, then it can be removed)
 *   PROBE_ENROL_TOKEN_FILE  a file holding the token (a container secret); used when PROBE_ENROL_TOKEN is unset
 *   PROBE_KEY_DIR       directory for the key and runner id               (default ./probe-runner-data)
 *   PROBE_RUNNER_NAME   a label                                           (default: the host name)
 *   PROBE_CONCURRENCY   checks run at once                                (default 10)
 *   PROBE_HEALTH_PORT   serves /healthz and /metrics                      (default 9111, 0 = off)
 *   PROBE_BROWSER_CONCURRENCY  browser checks run at once (browser image only)  (default 2)
 *
 * Why not `process_host`: its heartbeat goes to the platform's Redis, which a runner in a customer network cannot and should not reach. The
 * runner's heartbeat is a signed request to the control plane instead, and `/healthz` is local.
 */
/** 1.1.0: capabilities (additive: `browser`). A 1.0.0 runner still works against this control plane and simply never reports one. */
export const RUNNER_VERSION = '1.1.0'

export interface RunnerConfig {
  controlUrl: string; enrolToken: string | null; keyDir: string; name: string; concurrency: number; healthPort: number
  /** Browser checks run at once (only used when the runner has a browser executor). */
  browserConcurrency: number
}

/** What the browser image hands the runner: the executor and the capabilities it can honestly report (`browser` only once a real launch worked). */
export interface RunnerExtras { capabilities?: () => string[]; browser?: BrowserExecutor }

export function readConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  const controlUrl = (env.PROBE_CONTROL_URL ?? '').replace(/\/+$/, '')
  if (!/^https?:\/\/.+\/api\/public\/probe$/i.test(controlUrl)) throw new Error('PROBE_CONTROL_URL must end with /api/public/probe (the enrolment screen shows the full URL)')
  const n = (v: string | undefined, d: number, min: number, max: number) => { const x = Number(v); return Number.isInteger(x) && x >= min && x <= max ? x : d }
  return {
    controlUrl, enrolToken: env.PROBE_ENROL_TOKEN?.trim() || readTokenFile(env.PROBE_ENROL_TOKEN_FILE), keyDir: env.PROBE_KEY_DIR ?? './probe-runner-data',
    name: env.PROBE_RUNNER_NAME?.trim() || hostname(), concurrency: n(env.PROBE_CONCURRENCY, 10, 1, 100), healthPort: n(env.PROBE_HEALTH_PORT, 9111, 0, 65535),
    browserConcurrency: n(env.PROBE_BROWSER_CONCURRENCY, 2, 1, 8),
  }
}

function readTokenFile(path: string | undefined): string | null {
  if (!path) return null
  try { return readFileSync(path, 'utf8').trim() || null } catch { return null }
}

type Fetch = typeof fetch

export class ProbeRunner {
  private stopping = false
  private identity: RunnerIdentity
  private lastPollOk = 0
  private ran = 0
  private failed = 0
  private shed = 0
  private lastShedLog = 0
  private health: Server | null = null

  constructor(
    private readonly cfg: RunnerConfig, private readonly doFetch: Fetch = fetch, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly extras: RunnerExtras = {},
  ) {
    this.identity = loadOrCreateIdentity(cfg.keyDir)
  }

  /** What this runner can do right now. Empty for the plain runner: it never sends the field, so it is indistinguishable from a 1.0.0 runner. */
  private get capabilities(): string[] { return this.extras.capabilities?.() ?? [] }

  private get base(): string { return this.cfg.controlUrl }
  /** The signed path is the LOGICAL route, not the URL as a proxy or a tenant prefix rewrote it: the runner id already fixes the tenant. */
  private pathOf(suffix: string): string { return `${PROBE_API_PATH}${suffix}` }

  async enrol(): Promise<void> {
    if (this.identity.runnerId) return
    if (!this.cfg.enrolToken) throw new Error('This runner is not enrolled: set PROBE_ENROL_TOKEN for the first start')
    const res = await this.doFetch(`${this.base}/enrol`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: this.cfg.enrolToken, publicKey: this.identity.publicKeyPem, name: this.cfg.name, version: RUNNER_VERSION, ...(this.capabilities.length ? { capabilities: this.capabilities } : {}) }),
    })
    if (!res.ok) throw new Error(`enrolment refused (${res.status}): the token may be used, expired or for another location`)
    const { runnerId } = await res.json() as { runnerId: string }
    saveRunnerId(this.cfg.keyDir, runnerId)
    this.identity = { ...this.identity, runnerId }
    console.info(`[probe-runner] enrolled as ${runnerId} (key ${this.identity.fingerprint})`)
  }

  private async signedPost<T>(suffix: string, body: unknown): Promise<{ status: number; json: T | null }> {
    const text = JSON.stringify(body)
    const res = await this.doFetch(`${this.base}${suffix}`, {
      method: 'POST', body: text,
      headers: signedHeaders({ privateKeyPem: this.identity.privateKeyPem, runnerId: this.identity.runnerId as string, method: 'POST', path: this.pathOf(suffix), body: text }),
    })
    return { status: res.status, json: res.ok ? await res.json().catch(() => null) as T | null : null }
  }

  /** One poll: lease, run with bounded concurrency, post each result. Returns how many checks ran. */
  async pollOnce(): Promise<{ ran: number; pollSeconds: number }> {
    // A runner that can browse says how many browser checks it can take; the control plane never hands out more (a browser is the expensive thing here).
    const canBrowse = !!this.extras.browser && this.capabilities.includes(RUNNER_CAPABILITY_BROWSER)
    const { status, json } = await this.signedPost<LeaseResponse>('/lease', { max: this.cfg.concurrency * 2, ...(canBrowse ? { browserSlots: this.cfg.browserConcurrency } : {}) })
    if (status === 401) throw new Error('the control plane refused this runner (revoked, or the clock is more than five minutes off)')
    if (!json) throw new Error(`lease failed (${status})`)
    this.lastPollOk = Date.now()
    if (json.shed && json.shed > 0) {
      this.shed += json.shed
      // at most one line a minute: a sustained shed is one line, not one per poll
      if (Date.now() - this.lastShedLog >= 60_000) { this.lastShedLog = Date.now(); console.warn(`[probe-runner] the control plane shed ${json.shed} due check(s) on this poll (a lease cap is in force); they stay due and are leased later`) }
    }
    // Browser checks run in their OWN small pool so they can neither starve the base checks nor exceed the browser concurrency.
    const browserQueue = json.leases.filter((l) => l.check.type === 'BROWSER')
    const queue = json.leases.filter((l) => l.check.type !== 'BROWSER')
    const run = async (lease: LeaseResponse['leases'][number]) => {
      const result: ResultBody = await executeLease(lease, json.egress, { browser: this.extras.browser })
      const r = await this.signedPost('/results', result).catch(() => ({ status: 0, json: null }))
      // 409 = the lease expired or was consumed: nothing to retry. Anything else is retried by the next lease after the visibility timeout.
      if (r.status === 200 || r.status === 409) this.ran += 1; else this.failed += 1
    }
    const worker = (q: typeof queue) => async () => { for (let lease = q.shift(); lease && !this.stopping; lease = q.shift()) await run(lease) }
    await Promise.all([
      ...Array.from({ length: Math.min(this.cfg.concurrency, queue.length) }, worker(queue)),
      ...Array.from({ length: Math.min(this.cfg.browserConcurrency, browserQueue.length) }, worker(browserQueue)),
    ])
    await this.signedPost('/heartbeat', { version: RUNNER_VERSION, ...(this.extras.browser ? { capabilities: this.capabilities } : {}) }).catch(() => {})
    return { ran: json.leases.length, pollSeconds: json.pollSeconds }
  }

  async run(): Promise<void> {
    await this.enrol()
    this.startHealth()
    let delayMs = 10_000
    while (!this.stopping) {
      try { const r = await this.pollOnce(); delayMs = r.ran > 0 ? 1000 : Math.max(2, r.pollSeconds) * 1000 }
      catch (err) {
        console.warn(`[probe-runner] ${err instanceof Error ? err.message : String(err)}`)
        // back off on trouble, bounded: a control-plane outage must not turn every runner into a retry storm
        delayMs = Math.min(60_000, delayMs * 2)
      }
      await this.sleep(delayMs)
    }
  }

  private startHealth(): void {
    if (this.cfg.healthPort === 0) return
    this.health = createServer((req, res) => {
      const healthy = Date.now() - this.lastPollOk < 120_000
      if (req.url === '/healthz') { res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: healthy ? 'ok' : 'degraded', version: RUNNER_VERSION })); return }
      if (req.url === '/metrics') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`probe_runner_checks_total ${this.ran}\nprobe_runner_post_failures_total ${this.failed}\nprobe_runner_leases_shed_total ${this.shed}\nprobe_runner_last_poll_seconds ${Math.round((Date.now() - this.lastPollOk) / 1000)}\n`); return }
      res.writeHead(404); res.end()
    }).listen(this.cfg.healthPort)
    this.health.unref()
  }

  stop(): void { this.stopping = true; this.health?.close() }
}

/** Start a runner from the environment: shared by the plain entry below and the browser image's own entry (`probe-runner.browser.ts`). */
export function startFromEnv(extras: RunnerExtras = {}): void {
  let config: RunnerConfig
  try { config = readConfig() } catch (err) { console.error(`[probe-runner] ${err instanceof Error ? err.message : String(err)}`); process.exit(2) }
  const runner = new ProbeRunner(config, fetch, undefined, extras)
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { console.info(`[probe-runner] ${sig}: draining`); runner.stop(); setTimeout(() => process.exit(0), 5000).unref() })
  runner.run().catch((err) => { console.error(`[probe-runner] fatal: ${err instanceof Error ? err.message : String(err)}`); process.exit(1) })
}

// The plain bundle (`probe-runner.mjs`) and a direct `tsx probe-runner.ts` start here. The browser image's bundle is `probe-runner-browser.mjs` and starts from its own entry.
if (process.argv[1] && /probe-runner\.(ts|js|mjs)$/.test(process.argv[1])) startFromEnv()
