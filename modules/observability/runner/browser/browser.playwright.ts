import { createRequire } from 'node:module'

/**
 * Playwright, as an OPTIONAL runtime dependency of the browser runner image only (observability phase 09, D-OBS-8).
 *
 * `playwright-core` is not in this repository's package.json and is not in the plain runner bundle: the browser image installs it next to the bundle
 * (`infra/docker/probe-runner/browser/package.json`), and this module loads it by NAME at run time. So the types are the few structural ones the executor uses, written here,
 * and a runner without Playwright says so by reporting no browser capability instead of crashing.
 *
 * `PROBE_PLAYWRIGHT_MODULE` (an absolute path to a `playwright-core` directory) is for development and the live suite, where it lives in a scratch directory outside the repository.
 */

export interface PwLocator {
  first(): PwLocator
  click(o?: { timeout?: number }): Promise<void>
  fill(value: string, o?: { timeout?: number }): Promise<void>
  press(key: string, o?: { timeout?: number }): Promise<void>
  waitFor(o?: { state?: 'visible' | 'attached' | 'hidden'; timeout?: number }): Promise<void>
  filter(o: { hasText: string }): PwLocator
}
export interface PwResponse { status(): number; request(): PwRequest; headers(): Record<string, string> }
export interface PwRequest { isNavigationRequest(): boolean; frame(): unknown; url(): string; failure(): { errorText: string } | null }
export interface PwPage {
  goto(url: string, o?: { waitUntil?: 'load' | 'domcontentloaded'; timeout?: number }): Promise<PwResponse | null>
  locator(selector: string): PwLocator
  getByText(text: string): PwLocator
  keyboard: { press(key: string): Promise<void> }
  waitForURL(url: (u: URL) => boolean, o?: { timeout?: number }): Promise<void>
  url(): string
  mainFrame(): unknown
  /** Strings only: a function would be serialised after a transpiler (tsx adds helpers) touched it, and the page would not know them. */
  evaluate<T>(expression: string): Promise<T>
  screenshot(o: Record<string, unknown>): Promise<Buffer>
  on(event: string, cb: (arg: never) => void): void
  close(): Promise<void>
}
export interface PwContext {
  newPage(): Promise<PwPage>
  addInitScript(script: string): Promise<void>
  route(url: string | RegExp, handler: (route: { request(): { url(): string }; abort(code?: string): Promise<void>; continue(): Promise<void> }) => unknown): Promise<void>
  on(event: string, cb: (arg: never) => void): void
  close(): Promise<void>
}
export interface PwBrowser {
  newContext(o: Record<string, unknown>): Promise<PwContext>
  close(): Promise<void>
  version(): string
}
export interface PwChromium {
  launch(o: Record<string, unknown>): Promise<PwBrowser>
  executablePath(): string
}
export interface Playwright { chromium: PwChromium }

export type PlaywrightLoader = () => Promise<Playwright>

/** Load `playwright-core` by name (the image's node_modules), or from `PROBE_PLAYWRIGHT_MODULE`. Rejects with a message that says what to install. */
export const loadPlaywright: PlaywrightLoader = async () => {
  const explicit = process.env.PROBE_PLAYWRIGHT_MODULE
  try {
    if (explicit) return createRequire(`${explicit.replace(/\/+$/, '')}/package.json`)('./') as Playwright
    const name = 'playwright-core'
    const mod = await import(/* @vite-ignore */ name) as Playwright & { default?: Playwright }
    return mod.chromium ? mod : (mod.default as Playwright)
  } catch (err) {
    throw new Error(`playwright-core is not available (${err instanceof Error ? err.message.split('\n')[0] : String(err)}): the browser runner image installs it; a plain runner cannot run browser checks`)
  }
}

/**
 * Can this host really start a browser? One real launch (headless, no network, a blank page), closed again. A runner that cannot answer yes must not report the browser
 * capability, or the control plane would hand it checks it can only fail. (`executablePath()` is not asked: Playwright launches the headless shell, which has another path.)
 */
export async function chromiumAvailable(load: PlaywrightLoader = loadPlaywright, o: { noSandbox?: boolean; extraArgs?: string[] } = {}): Promise<{ ok: true; version: string } | { ok: false; reason: string }> {
  try {
    const pw = await load()
    const browser = await pw.chromium.launch({ headless: true, timeout: 20_000, chromiumSandbox: !o.noSandbox, args: ['--disable-gpu', ...(o.noSandbox ? ['--no-sandbox'] : []), ...(o.extraArgs ?? [])] })
    try { return { ok: true, version: browser.version() } } finally { await browser.close().catch(() => undefined) }
  } catch (err) { return { ok: false, reason: err instanceof Error ? err.message.split('\n')[0] : String(err) } }
}
