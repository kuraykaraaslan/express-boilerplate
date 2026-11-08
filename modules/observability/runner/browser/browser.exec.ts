import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { lookup as dnsLookup } from 'node:dns'
import {
  BrowserConfigSchema, MAX_BROWSER_TIMEOUT_MS, MAX_SCREENSHOT_BYTES, MIN_BROWSER_TIMEOUT_MS, gotoUrlProblem, interpolateBrowserSecrets, vitalsVerdict,
  type BrowserConfig, type BrowserDetail, type BrowserStep,
} from '../../server/uptime.browser.schema'
import { compilePattern } from '../../server/uptime.assertions'
import { EgressProxy, PROXY_USER, type BlockedRequest } from './browser.proxy'
import { DEFAULT_LIMITS, killTree, startWatchdog, type RunLimits } from './browser.watchdog'
import { loadPlaywright, type PlaywrightLoader, type PwBrowser, type PwPage, type PwResponse } from './browser.playwright'

/**
 * Run ONE BROWSER check (observability phase 09, D-OBS-8). This file runs ONLY in the browser runner image; the app process and the plain runner never import it.
 *
 * What stands between the page and the network is not Chromium's good behaviour but this layout:
 *  1. Chromium is launched PER CHECK with `--proxy-server` pointing at an `EgressProxy` on 127.0.0.1 (same connection guard as every probe, `public_or_listed` mode, pinned addresses)
 *     and `--host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"`, so it cannot resolve or reach anything by itself. `<-loopback>` removes Chromium's implicit
 *     "localhost is never proxied", so even http://127.0.0.1 goes through the guard.
 *  2. WebRTC cannot use direct UDP, QUIC is off, DNS-over-HTTPS is off, service workers are blocked, downloads are refused, popups are closed.
 *  3. A fresh context per check (nothing shared: cookies, storage, cache), a fresh process per check, a fresh profile directory that is deleted afterwards.
 *  4. Only the closed step grammar runs. The only script injected into a page is a constant that reads performance entries (below); tenant text is never evaluated.
 *  5. The whole process tree is measured and killed on memory, CPU time, process count or the wall-clock budget (`browser.watchdog.ts`).
 *  6. Secrets: typed into a field by a `fill` step, masked out of the failure screenshot, and removed from every message before it leaves this function.
 * No platform code is imported (no env, no logger): the runner bundle stays free of the platform's configuration.
 */

export interface BrowserCheckInput {
  browser: unknown
  timeoutMs: number | null
  degradedLatencyMs: number | null
  /** Decrypted secrets, present only for a PRIVATE location. */
  secrets?: Record<string, string>
}

export interface BrowserRunOptions {
  /** The location's CIDRs (private runner); empty = public addresses only. */
  egressCidrs: string[]
  load?: PlaywrightLoader
  /** Test seam for the proxy's resolver (DNS rebinding). */
  resolve?: typeof dnsLookup
  limits?: Partial<RunLimits>
  /** Run Chromium without its own sandbox: only for a container that cannot give it user namespaces (the container is then the sandbox). */
  noSandbox?: boolean
  extraArgs?: string[]
  /** Hard cap on bytes relayed through the proxy (default 40 MB). */
  maxProxyBytes?: number
}

export interface BrowserRunResult {
  status: 'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN'
  latencyMs: number | null
  statusCode: number | null
  error: string | null
  browser?: { detail: BrowserDetail; screenshotJpegBase64?: string }
}

/** How long past the budget a stuck run is left before its process tree is killed (time for the failing step to time out and be photographed). */
export const KILL_GRACE_MS = 6_000
const DEFAULT_STEP_TIMEOUT_MS = 15_000
const SCREENSHOT_QUALITIES = [55, 35, 20] as const

/** Read once per document, by our own constant script: LCP, CLS and FCP from the page's performance entries. */
export const VITALS_INIT_SCRIPT = `(() => {
  const v = { lcp: null, cls: 0, fcp: null };
  try { new PerformanceObserver((l) => { const e = l.getEntries(); const x = e[e.length - 1]; if (x) v.lcp = Math.round(x.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) v.cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') v.fcp = Math.round(e.startTime); }).observe({ type: 'paint', buffered: true }); } catch (e) {}
  try { Object.defineProperty(window, '__probeVitals', { value: () => ({ lcp: v.lcp, cls: v.cls, fcp: v.fcp }), configurable: false }); } catch (e) {}
})();`

const READ_VITALS = `(() => {
  const n = performance.getEntriesByType('navigation')[0];
  const v = typeof window.__probeVitals === 'function' ? window.__probeVitals() : { lcp: null, cls: 0, fcp: null };
  const r = (x) => (typeof x === 'number' && isFinite(x) && x >= 0 ? Math.round(x) : null);
  return { loadMs: n && n.loadEventEnd > 0 ? r(n.loadEventEnd - n.startTime) : null, ttfbMs: n ? r(n.responseStart - n.startTime) : null, lcpMs: r(v.lcp), fcpMs: r(v.fcp), cls: typeof v.cls === 'number' && isFinite(v.cls) ? Math.round(v.cls * 10000) / 10000 : null };
})()`

/** Chromium's flags. Every one of them is a statement about what the page may NOT do or reach. */
export function chromiumArgs(opts: { marker: string; noSandbox: boolean; extra?: string[] }): string[] {
  return [
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
    '--proxy-bypass-list=<-loopback>',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--disable-quic',
    '--disable-features=DnsOverHttps,AsyncDns,NetworkTimeServiceQuerying,OptimizationHints,MediaRouter,Translate,InterestFeedContentSuggestions,CertificateTransparencyComponentUpdater',
    '--disable-background-networking', '--disable-component-update', '--disable-domain-reliability', '--disable-sync', '--disable-default-apps', '--disable-extensions',
    '--disable-client-side-phishing-detection', '--disable-breakpad', '--disable-crash-reporter', '--disable-notifications', '--disable-speech-api', '--disable-print-preview',
    '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--no-pings', '--mute-audio', '--metrics-recording-only',
    '--block-new-web-contents', '--deny-permission-prompts', '--autoplay-policy=user-gesture-required',
    '--js-flags=--max-old-space-size=384', '--renderer-process-limit=2',
    `--probe-run-id=${opts.marker}`,
    ...(opts.noSandbox ? ['--no-sandbox'] : []),
    ...(opts.extra ?? []),
  ]
}

/** A launch environment that carries none of the runner's own (the enrolment token file path, the control-plane URL). */
function minimalEnv(home: string): Record<string, string> {
  const env: Record<string, string> = { HOME: home, TMPDIR: home, LANG: 'C.UTF-8', TZ: 'UTC', PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin' }
  for (const k of ['LD_LIBRARY_PATH', 'FONTCONFIG_PATH', 'FONTCONFIG_FILE', 'XDG_DATA_DIRS']) if (process.env[k]) env[k] = process.env[k] as string
  return env
}

/** The first line of an error, with every secret value removed (Playwright's call log quotes the text a `fill` typed). */
export function cleanError(err: unknown, secrets: Readonly<Record<string, string>>): string {
  let m = (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? ''
  for (const v of Object.values(secrets)) if (v.length >= 3) m = m.split(v).join('***')
  return m.replace(/\s+/g, ' ').trim().slice(0, 180)
}

/** Resolve with `p`, or reject after `ms`: for calls on a page that may be wedged. */
function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => { setTimeout(() => reject(new Error('timed out')), ms).unref?.() })])
}

const stripQuery = (u: string): string | null => { try { const x = new URL(u); return `${x.origin}${x.pathname}`.slice(0, 300) } catch { return null } }

function urlMatches(step: Extract<BrowserStep, { action: 'expectUrl' }>, url: string): boolean {
  if (step.equals !== undefined) return url === step.equals
  if (step.contains !== undefined) return url.includes(step.contains)
  if (step.matches !== undefined) { const c = compilePattern(step.matches); return 're' in c && c.re.test(url.slice(0, 2000)) }
  return false
}

/** Playwright's net error for a refused tunnel or proxy hop: the egress policy said no. */
const POLICY_ERRORS = /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_NON_HTTP_PROXY_CONNECT_FAILED|ERR_UNEXPECTED_PROXY_AUTH|ERR_BLOCKED_BY_CLIENT/

export async function runBrowserCheck(check: BrowserCheckInput, opts: BrowserRunOptions): Promise<BrowserRunResult> {
  const parsed = BrowserConfigSchema.safeParse(check.browser)
  if (!parsed.success) return { status: 'DOWN', latencyMs: null, statusCode: null, error: 'browser definition is invalid' }
  const cfg: BrowserConfig = parsed.data
  const secrets = check.secrets ?? {}
  const budgetMs = Math.min(MAX_BROWSER_TIMEOUT_MS, Math.max(MIN_BROWSER_TIMEOUT_MS, check.timeoutMs ?? 30_000))
  const limits: RunLimits = { ...DEFAULT_LIMITS, ...(opts.limits ?? {}) }

  const marker = randomUUID()
  const profile = mkdtempSync(join(tmpdir(), 'probe-browser-'))
  const token = randomBytes(24).toString('hex')
  const proxy = new EgressProxy({
    allowlist: opts.egressCidrs, token, resolve: opts.resolve, maxBytes: opts.maxProxyBytes,
    onExhausted: (what) => kill(what === 'bytes' ? 'the page pulled more data through the runner than one check may; the check was stopped' : 'the page made more requests than one check may; the check was stopped'),
  })

  const steps: BrowserDetail['steps'] = []
  const pageErrors: string[] = []
  const failedMain: string[] = []
  let policyViolations = 0
  let mainStatus: number | null = null
  let browser: PwBrowser | null = null
  let killed: string | null = null
  /** True when the kill came while no step had failed yet: then the kill IS the explanation. A kill after a step already failed (the backstop) is not. */
  let killedBeforeFailure = false
  const kill = (why: string): void => { if (killed) return; killed = why; killedBeforeFailure = stepError === null; killTree(marker) }
  let watchdog: ReturnType<typeof startWatchdog> | null = null
  let killTimer: NodeJS.Timeout | null = null
  const t0 = Date.now()
  let runStart = t0
  let launchMs = 0
  const vitals = { loadMs: null as number | null, ttfbMs: null as number | null, fcpMs: null as number | null, lcpMs: null as number | null, cls: null as number | null }
  let screenshot: { bytes: Buffer; width: number; height: number; step: string } | null = null
  let finalUrl: string | null = null
  let failedStep: number | null = null
  let stepError: string | null = null
  const secretSelectors: string[] = []

  const finish = (): BrowserRunResult => {
    const blocked = proxy.blocked.filter((b) => b.kind !== 'auth')
    const detail: BrowserDetail = {
      v: 1, steps, vitals: { ...vitals }, pageErrors: pageErrors.length, failedMainRequests: failedMain.length, blockedRequests: blocked.length + policyViolations, launchMs,
      finalUrl, failedStep,
      ...(screenshot ? { screenshot: { step: screenshot.step, bytes: screenshot.bytes.length, sha256: createHash('sha256').update(screenshot.bytes).digest('hex'), width: screenshot.width, height: screenshot.height } } : {}),
    }
    const latencyMs = Date.now() - runStart
    const out = (status: BrowserRunResult['status'], error: string | null): BrowserRunResult => ({
      status, latencyMs, statusCode: mainStatus, error: error ? error.slice(0, 300) : null,
      browser: { detail, ...(screenshot ? { screenshotJpegBase64: screenshot.bytes.toString('base64') } : {}) },
    })

    if (killed && killedBeforeFailure) return out('DOWN', killed)
    if (stepError) return out('DOWN', stepError)
    if (killed) return out('DOWN', killed)
    if (cfg.noPageErrors && pageErrors.length > 0) return out('DOWN', `${pageErrors.length} uncaught page error(s): ${pageErrors[0]}`)
    if (cfg.noFailedMainRequest && failedMain.length > 0) return out('DOWN', `main document request failed: ${failedMain[0]}`)
    const refused = blocked.length + policyViolations
    const budget = vitalsVerdict(cfg.vitals, vitals)
    if (budget?.severity === 'DOWN') return out('DOWN', budget.reasons[0])
    if (budget) return out('DEGRADED', budget.reasons[0])
    if (refused > 0) return out('DEGRADED', `${refused} request(s) were refused by the runner's egress policy${blocked[0] ? ` (first: ${blocked[0].host}:${blocked[0].port})` : ''}`)
    if (check.degradedLatencyMs != null && latencyMs > check.degradedLatencyMs) return out('DEGRADED', `the run took ${latencyMs}ms, over the ${check.degradedLatencyMs}ms budget`)
    return out('UP', null)
  }

  const cleanup = async (): Promise<void> => {
    if (killTimer) clearTimeout(killTimer)
    watchdog?.stop()
    try { await Promise.race([browser?.close() ?? Promise.resolve(), new Promise((r) => setTimeout(r, 3000))]) } catch { /* it is going away anyway */ }
    killTree(marker)
    await proxy.stop().catch(() => undefined)
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* tmpfs */ }
  }

  try {
    const pw = await (opts.load ?? loadPlaywright)()
    const { port } = await proxy.start()
    const launchAt = Date.now()
    browser = await pw.chromium.launch({
      headless: true, timeout: 20_000, env: minimalEnv(profile), handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false, chromiumSandbox: !opts.noSandbox,
      args: chromiumArgs({ marker, noSandbox: !!opts.noSandbox, extra: opts.extraArgs }),
      proxy: { server: `http://127.0.0.1:${port}`, username: PROXY_USER, password: token, bypass: '<-loopback>' },
    })
    launchMs = Date.now() - launchAt
    runStart = Date.now()
    const deadline = runStart + budgetMs

    // The wall-clock and resource limits: the steps carry their own timeouts, so this only fires for a page that wedges the browser.
    watchdog = startWatchdog(marker, limits, (reason) => kill(`${reason}; the check was stopped`))
    killTimer = setTimeout(() => kill(`time budget of ${budgetMs}ms used up; the check was stopped`), budgetMs + KILL_GRACE_MS)
    killTimer.unref?.()

    const context = await browser.newContext({
      viewport: cfg.viewport, acceptDownloads: false, serviceWorkers: 'block', permissions: [], ignoreHTTPSErrors: false, bypassCSP: false, locale: 'en-US', timezoneId: 'UTC',
      javaScriptEnabled: true, offline: false,
    })
    await context.addInitScript(VITALS_INIT_SCRIPT)
    // Only http(s), data:, blob: and about:blank are navigable or loadable. file://, chrome://, ftp:, javascript: and the rest are refused before they leave the page.
    await context.route(/^(?!https?:\/\/|data:|blob:|about:blank)/i, async (route) => { policyViolations += 1; await route.abort('blockedbyclient') })
    const page: PwPage = await context.newPage()
    context.on('page', ((p: PwPage) => { if (p !== page) void p.close().catch(() => undefined) }) as never)
    page.on('pageerror', ((e: Error) => { if (pageErrors.length < 20) pageErrors.push(cleanError(e, secrets).slice(0, 120)) }) as never)
    page.on('dialog', ((d: { dismiss(): Promise<void> }) => { void d.dismiss().catch(() => undefined) }) as never)
    page.on('download', ((d: { cancel(): Promise<void> }) => { void d.cancel().catch(() => undefined) }) as never)
    page.on('requestfailed', ((r: { isNavigationRequest(): boolean; frame(): unknown; url(): string; failure(): { errorText: string } | null }) => {
      if (r.isNavigationRequest() && r.frame() === page.mainFrame() && failedMain.length < 20) failedMain.push(`${(r.failure()?.errorText ?? 'failed').replace(/^net::/, '')}`.slice(0, 100))
    }) as never)
    page.on('response', ((r: PwResponse) => {
      const req = r.request()
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        mainStatus = r.status()
        if (r.status() >= 400 && failedMain.length < 20) failedMain.push(`HTTP ${r.status()}`)
      }
    }) as never)

    const readVitals = async (): Promise<void> => {
      try {
        // Bounded: a page stuck mid-navigation never gives `evaluate` an execution context, and a hung read must not eat the rest of the budget.
        const v = await within(page.evaluate<{ loadMs: number | null; ttfbMs: number | null; lcpMs: number | null; fcpMs: number | null; cls: number | null }>(READ_VITALS), 1500)
        // load time is the SLOWEST navigation the run made; LCP, FCP and CLS describe the last document.
        if (v.loadMs != null) vitals.loadMs = Math.max(vitals.loadMs ?? 0, v.loadMs)
        vitals.ttfbMs = v.ttfbMs ?? vitals.ttfbMs; vitals.lcpMs = v.lcpMs; vitals.fcpMs = v.fcpMs; vitals.cls = v.cls
      } catch { /* a page that is gone has no vitals */ }
    }

    for (let i = 0; i < cfg.steps.length; i += 1) {
      const step = cfg.steps[i]
      const started = Date.now()
      const remaining = deadline - started
      if (remaining <= 0) { stepError = `step ${i + 1} "${step.name}": time budget of ${budgetMs}ms used up`; failedStep = i; steps.push({ name: step.name, action: step.action, ok: false, ms: 0, error: 'time budget used up' }); break }
      const timeout = Math.max(100, Math.min(step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS, remaining))
      try {
        await runStep(step, page, { timeout, secrets, secretSelectors })
        steps.push({ name: step.name, action: step.action, ok: true, ms: Date.now() - started })
        if (step.action === 'goto') await readVitals()
      } catch (err) {
        let msg = cleanError(err, secrets)
        const policy = proxy.blocked.find((b) => b.kind !== 'auth')
        if (policy && (POLICY_ERRORS.test(msg) || /HTTP 403/.test(msg))) msg = `the runner's egress policy refused ${policy.host}:${policy.port} (${policy.reason})`
        steps.push({ name: step.name, action: step.action, ok: false, ms: Date.now() - started, error: msg.slice(0, 200) })
        stepError = `step ${i + 1} "${step.name}": ${msg}`
        failedStep = i
        break
      }
    }
    await readVitals()
    try { finalUrl = stripQuery(page.url()) } catch { /* closed */ }

    if (stepError && cfg.screenshotOnFailure && !killed) {
      screenshot = await takeScreenshot(page, cfg, secretSelectors, steps[steps.length - 1]?.name ?? 'run', Math.max(1000, Math.min(3000, deadline + KILL_GRACE_MS - Date.now() - 1500)))
    }
    return finish()
  } catch (err) {
    // The runner's own fault (Playwright missing, Chromium could not start): "we could not look" is UNKNOWN, never DOWN.
    if (killed) return finish()
    return { status: 'UNKNOWN', latencyMs: null, statusCode: null, error: `browser could not run: ${cleanError(err, secrets)}`.slice(0, 300) }
  } finally {
    await cleanup()
  }
}

async function runStep(step: BrowserStep, page: PwPage, ctx: { timeout: number; secrets: Record<string, string>; secretSelectors: string[] }): Promise<void> {
  const { timeout } = ctx
  switch (step.action) {
    case 'goto': {
      // The grammar already refused anything but a literal http(s) URL; this is the second lock, for a lease that was altered on the way.
      const problem = gotoUrlProblem(step.url)
      if (problem) throw new Error(problem)
      const res = await page.goto(step.url, { waitUntil: step.waitUntil, timeout })
      if (res && res.headers()['x-probe-blocked']) throw new Error('HTTP 403 from the egress policy')
      return
    }
    case 'click': return page.locator(step.selector).first().click({ timeout })
    case 'fill': {
      const value = interpolateBrowserSecrets(step.value, ctx.secrets)
      if (value !== step.value) ctx.secretSelectors.push(step.selector)
      return page.locator(step.selector).first().fill(value, { timeout })
    }
    case 'press': return step.selector ? page.locator(step.selector).first().press(step.key, { timeout }) : page.keyboard.press(step.key)
    case 'waitForSelector': return page.locator(step.selector).first().waitFor({ state: step.state, timeout })
    case 'waitForText': return page.getByText(step.text).first().waitFor({ state: 'visible', timeout })
    case 'expectText': return page.locator(step.selector ?? 'body').filter({ hasText: step.text }).first().waitFor({ state: 'attached', timeout })
    case 'expectVisible': return page.locator(step.selector).first().waitFor({ state: 'visible', timeout })
    case 'expectUrl': {
      try { await page.waitForURL((u) => urlMatches(step, u.toString()), { timeout }) } catch { throw new Error('the URL did not match') }
      return
    }
  }
}

/** A JPEG of the viewport that fits the cap, with typed secrets and password fields painted over. Null when no quality fits or the page cannot be photographed. */
async function takeScreenshot(page: PwPage, cfg: BrowserConfig, secretSelectors: string[], step: string, timeout: number): Promise<{ bytes: Buffer; width: number; height: number; step: string } | null> {
  const mask = [...new Set(secretSelectors)].slice(0, 20).map((s) => page.locator(s)).concat([page.locator('input[type="password"]')])
  for (const quality of SCREENSHOT_QUALITIES) {
    try {
      // Bounded twice: Playwright's own timeout, and a race, because a page stuck mid-navigation can ignore the first.
      const bytes = await Promise.race([
        page.screenshot({ type: 'jpeg', quality, scale: 'css', animations: 'disabled', caret: 'hide', fullPage: false, mask, maskColor: '#333333', timeout }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('screenshot timed out')), timeout + 500).unref?.()),
      ])
      if (bytes.length <= MAX_SCREENSHOT_BYTES) return { bytes, width: cfg.viewport.width, height: cfg.viewport.height, step: step.slice(0, 60) }
    } catch { return null }
  }
  return null
}

export type { BlockedRequest }
