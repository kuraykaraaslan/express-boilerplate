import { startFromEnv, type RunnerExtras } from './probe-runner'
import { chromiumAvailable, loadPlaywright, type PlaywrightLoader } from './browser/browser.playwright'
import { runBrowserCheck } from './browser/browser.exec'
import type { BrowserExecutor } from './probe-runner.exec'
import { RUNNER_CAPABILITY_BROWSER } from './probe-runner.protocol'

/**
 * The BROWSER probe runner (observability phase 09, D-OBS-8): the plain runner plus a browser executor, built as a SEPARATE bundle for a SEPARATE image
 * (`infra/docker/probe-runner/Dockerfile.browser`). The plain runner bundle never contains this file, the Playwright wrapper or the proxy: that is what keeps a runner in a
 * customer network small, and what makes "a runner that can run a browser" a thing an operator chose.
 *
 *   PROBE_BROWSER_CONCURRENCY    browser checks at once                (default 2)
 *   PROBE_BROWSER_NO_SANDBOX=1   start Chromium without its own sandbox (only where the container cannot give it user namespaces; the container is then the sandbox)
 *   PROBE_BROWSER_MAX_RSS_MB     memory budget of one run's process tree (default 1024)
 *   PROBE_BROWSER_MAX_CPU_SECONDS  CPU-time budget of one run            (default 90)
 *   PROBE_BROWSER_MAX_PROCESSES  process budget of one run               (default 48)
 *   PROBE_BROWSER_MAX_PROXY_MB   bytes one run may pull through the egress proxy (default 40)
 *   PROBE_PLAYWRIGHT_MODULE      development only: a directory holding playwright-core
 *
 * The runner reports the `browser` capability only while a real browser launch works: it launches one at start (and again every five minutes while it does not), and withdraws
 * the capability after three launch failures in a row, so the control plane stops leasing it checks it can only fail.
 */

const n = (v: string | undefined, d: number, min: number, max: number): number => { const x = Number(v); return Number.isFinite(x) && x >= min && x <= max ? x : d }

export const RECHECK_MS = 5 * 60_000
export const WITHDRAW_AFTER_FAILURES = 3

export function createBrowserExtras(env: NodeJS.ProcessEnv = process.env, load: PlaywrightLoader = loadPlaywright, log: (m: string) => void = (m) => console.info(`[probe-runner] ${m}`)): { extras: RunnerExtras; init(): Promise<void>; state: { capable: boolean; failures: number } } {
  const state = { capable: false, failures: 0 }
  const noSandbox = env.PROBE_BROWSER_NO_SANDBOX === '1'
  const limits = {
    maxRssBytes: n(env.PROBE_BROWSER_MAX_RSS_MB, 1024, 128, 16_384) * 1024 * 1024, maxCpuSeconds: n(env.PROBE_BROWSER_MAX_CPU_SECONDS, 90, 5, 3600), maxProcesses: n(env.PROBE_BROWSER_MAX_PROCESSES, 48, 8, 512),
  }
  const maxProxyBytes = n(env.PROBE_BROWSER_MAX_PROXY_MB, 40, 1, 1024) * 1024 * 1024

  const probe = async (): Promise<void> => {
    const r = await chromiumAvailable(load, { noSandbox })
    state.capable = r.ok; state.failures = 0
    log(r.ok ? `browser capability ON (Chromium ${r.version}${noSandbox ? ', no own sandbox' : ''})` : `browser capability OFF: ${r.reason}`)
  }

  const browser: BrowserExecutor = async (check, egress) => {
    const r = await runBrowserCheck(
      { browser: check.browser, timeoutMs: check.timeoutMs, degradedLatencyMs: check.degradedLatencyMs, secrets: check.secrets },
      { egressCidrs: egress.cidrs, load, noSandbox, limits, maxProxyBytes },
    )
    // "could not run" is the runner's fault, not the page's: count it, and withdraw the capability when the browser keeps failing to start.
    if (r.status === 'UNKNOWN') {
      state.failures += 1
      if (state.failures >= WITHDRAW_AFTER_FAILURES && state.capable) { state.capable = false; log(`browser capability withdrawn after ${state.failures} failed launches: ${r.error ?? ''}`) }
    } else state.failures = 0
    return r
  }

  return {
    state,
    init: async () => {
      await probe()
      const timer = setInterval(() => { if (!state.capable) void probe().catch(() => undefined) }, RECHECK_MS)
      timer.unref()
    },
    extras: { capabilities: () => (state.capable ? [RUNNER_CAPABILITY_BROWSER] : []), browser },
  }
}

if (process.argv[1] && /probe-runner-browser\.(ts|js|mjs)$/.test(process.argv[1])) {
  const b = createBrowserExtras()
  b.init().then(() => startFromEnv(b.extras)).catch((err) => { console.error(`[probe-runner] fatal: ${err instanceof Error ? err.message : String(err)}`); process.exit(1) })
}
