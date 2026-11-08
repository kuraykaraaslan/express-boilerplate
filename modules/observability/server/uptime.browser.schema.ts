import { z } from 'zod'
import { compilePattern } from './uptime.assertions'
import { SECRET_NAME } from './uptime.steps.schema'

/**
 * The BROWSER check grammar (observability phase 09, decision D-OBS-8), as pure data: no I/O, no logger, no environment. The DTO, the importer,
 * the lease service and the browser runner all read it from here, so a definition means the same thing wherever it is validated.
 *
 * The grammar is CLOSED on purpose, like the STEPS grammar: a fixed set of actions with fixed arguments, no conditionals, no loops, no
 * expressions and above all no page-side code. A step list that can run arbitrary JavaScript is a scripting language inside a probe.
 *
 *  - `goto` takes a LITERAL http(s) URL (no templates, no credentials in the URL), so the hosts a check visits first are known when it is saved and
 *    when it is leased. Everything the page then loads or navigates to is judged at connect time by the runner's forward proxy.
 *  - `{{secret.NAME}}` is accepted in `fill.value` ONLY: a secret can be typed into a field of the page under test, and nowhere else (not in a URL,
 *    not in an expectation, not in a selector), so it cannot be sent to another host or echoed into a verdict.
 *  - Caps: steps, per-step timeout, the monitor's `timeoutMs` as the whole-run budget, selector and text lengths.
 */

export const MAX_BROWSER_STEPS = 20
/** A browser is expensive: a check never runs more often than this, whatever the plan says. */
export const MIN_BROWSER_INTERVAL_SECONDS = 300
export const MIN_BROWSER_TIMEOUT_MS = 5_000
export const MAX_BROWSER_TIMEOUT_MS = 120_000
export const MAX_STEP_TIMEOUT_MS = 60_000
/** The capability a runner reports when it can run these checks. */
export const BROWSER_CAPABILITY = 'browser'

const Name = z.string().min(1).max(60)
// eslint-disable-next-line no-control-regex
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/
const Selector = z.string().min(1).max(300).regex(NO_CONTROL, 'a selector has no control characters')
const PlainText = z.string().min(1).max(200).regex(NO_CONTROL, 'text has no control characters')
const StepTimeout = z.number().int().min(100).max(MAX_STEP_TIMEOUT_MS).optional()

/** Keys a `press` step may send: a named key or a single character, with optional modifiers (`Control+A`). */
export const KEY_PATTERN = /^(?:(?:Control|Shift|Alt|Meta)\+)*(?:[A-Za-z0-9]|Enter|Tab|Escape|Backspace|Delete|Space|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|F[1-9]|F1[0-2])$/

export const BrowserStepSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('goto'), name: Name, url: z.string().min(1).max(1000), waitUntil: z.enum(['load', 'domcontentloaded']).default('load'), timeoutMs: StepTimeout }),
  z.object({ action: z.literal('click'), name: Name, selector: Selector, timeoutMs: StepTimeout }),
  z.object({ action: z.literal('fill'), name: Name, selector: Selector, value: z.string().max(1000).regex(NO_CONTROL), timeoutMs: StepTimeout }),
  z.object({ action: z.literal('press'), name: Name, selector: Selector.optional(), key: z.string().regex(KEY_PATTERN, 'not an allowed key'), timeoutMs: StepTimeout }),
  z.object({ action: z.literal('waitForSelector'), name: Name, selector: Selector, state: z.enum(['visible', 'attached', 'hidden']).default('visible'), timeoutMs: StepTimeout }),
  z.object({ action: z.literal('waitForText'), name: Name, text: PlainText, timeoutMs: StepTimeout }),
  z.object({ action: z.literal('expectText'), name: Name, selector: Selector.optional(), text: PlainText, timeoutMs: StepTimeout }),
  z.object({ action: z.literal('expectVisible'), name: Name, selector: Selector, timeoutMs: StepTimeout }),
  z.object({
    action: z.literal('expectUrl'), name: Name,
    contains: PlainText.optional(), equals: z.string().min(1).max(1000).optional(), matches: z.string().min(1).max(200).optional(), timeoutMs: StepTimeout,
  }),
])
export type BrowserStep = z.infer<typeof BrowserStepSchema>
export type BrowserStepInput = z.input<typeof BrowserStepSchema>

/** Why a goto URL is refused, or null. Pure: no DNS. */
export function gotoUrlProblem(raw: string): string | null {
  if (raw.includes('{{')) return 'a goto URL is literal: templates are not allowed in it'
  let u: URL
  try { u = new URL(raw) } catch { return 'a goto URL must be an absolute URL' }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return `a goto URL must be http or https (got ${u.protocol.replace(':', '')})`
  if (u.username || u.password) return 'a goto URL must not carry credentials; use a fill step with a secret'
  if (!u.hostname) return 'a goto URL needs a host'
  return null
}

const TEMPLATE = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g

/** Names used as `{{secret.NAME}}` in a step's value (the only field that may carry a template). */
export function referencedBrowserSecrets(step: BrowserStep): string[] {
  if (step.action !== 'fill') return []
  return [...new Set([...step.value.matchAll(TEMPLATE)].map((m) => m[1]))]
}

function stepProblem(step: BrowserStep): string | null {
  if (step.action === 'goto') return gotoUrlProblem(step.url)
  // A template anywhere but in `fill.value` is refused: it would be a way to move a secret into a place that is shown or sent elsewhere.
  for (const [k, v] of Object.entries(step)) if (typeof v === 'string' && v.includes('{{') && !(step.action === 'fill' && k === 'value')) return `"${k}" cannot contain a template`
  if (step.action === 'fill') {
    for (const ref of referencedBrowserSecrets(step)) {
      if (!ref.startsWith('secret.') || !SECRET_NAME.test(ref.slice('secret.'.length))) return `unknown variable {{${ref}}}: only {{secret.NAME}} is available`
    }
  }
  if (step.action === 'expectUrl') {
    const set = [step.contains, step.equals, step.matches].filter((x) => x !== undefined).length
    if (set !== 1) return 'expectUrl needs exactly one of contains, equals, matches'
    if (step.matches !== undefined) { const c = compilePattern(step.matches); if ('error' in c) return c.error }
  }
  return null
}

const Severity = z.enum(['DOWN', 'DEGRADED'])

/** Budgets read from the page's own performance entries. Exceeding one is DEGRADED by default (a slow page is up), DOWN when asked. */
export const BrowserVitalsBudgetSchema = z.object({
  maxLoadMs: z.number().int().min(100).max(MAX_BROWSER_TIMEOUT_MS).optional(),
  maxLcpMs: z.number().int().min(100).max(MAX_BROWSER_TIMEOUT_MS).optional(),
  maxCls: z.number().min(0).max(10).optional(),
  severity: Severity.default('DEGRADED'),
})

export const BrowserConfigSchema = z.object({
  steps: z.array(BrowserStepSchema).min(1).max(MAX_BROWSER_STEPS),
  viewport: z.object({ width: z.number().int().min(320).max(1920), height: z.number().int().min(240).max(1200) }).default({ width: 1280, height: 720 }),
  vitals: BrowserVitalsBudgetSchema.optional(),
  /** DOWN when the page threw an uncaught error (default on). */
  noPageErrors: z.boolean().default(true),
  /** DOWN when a main-document request failed or answered 4xx/5xx (default on). */
  noFailedMainRequest: z.boolean().default(true),
  screenshotOnFailure: z.boolean().default(true),
}).superRefine((cfg, ctx) => {
  cfg.steps.forEach((step, i) => {
    const problem = stepProblem(step)
    if (problem) ctx.addIssue({ code: 'custom', path: ['steps', i], message: `step "${step.name}": ${problem}` })
  })
  if (cfg.steps[0] && cfg.steps[0].action !== 'goto') ctx.addIssue({ code: 'custom', path: ['steps', 0], message: 'the first step must be a goto' })
})
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>

/** The hosts the first-class navigations name (lowercased, unique). The lease policy judges these; the runner's proxy judges everything else at connect time. */
export function browserHosts(raw: unknown): string[] {
  const steps = raw && typeof raw === 'object' && Array.isArray((raw as { steps?: unknown }).steps) ? (raw as { steps: unknown[] }).steps : []
  const hosts = new Set<string>()
  for (const s of steps) {
    const o = s as { action?: unknown; url?: unknown }
    if (o && o.action === 'goto' && typeof o.url === 'string') { try { hosts.add(new URL(o.url).hostname.replace(/^\[|\]$/g, '').toLowerCase()) } catch { /* refused at write time */ } }
  }
  return [...hosts]
}

/** The first goto URL (the monitor's display target), or null. */
export function browserStartUrl(raw: unknown): string | null {
  const steps = raw && typeof raw === 'object' && Array.isArray((raw as { steps?: unknown }).steps) ? (raw as { steps: unknown[] }).steps : []
  for (const s of steps) { const o = s as { action?: unknown; url?: unknown }; if (o?.action === 'goto' && typeof o.url === 'string') return o.url.slice(0, 500) }
  return null
}

/** Names of the secrets a config references (to check they exist on the monitor). */
export function browserSecretNames(cfg: BrowserConfig): string[] {
  return [...new Set(cfg.steps.flatMap((s) => referencedBrowserSecrets(s)).map((r) => r.replace(/^secret\./, '')))]
}

/** Replace `{{secret.NAME}}`; an unknown name is an error naming the NAME, never a value. */
export function interpolateBrowserSecrets(text: string, secrets: Readonly<Record<string, string>>): string {
  return text.replace(TEMPLATE, (_m, name: string) => {
    const key = name.startsWith('secret.') ? name.slice('secret.'.length) : ''
    const value = SECRET_NAME.test(key) ? secrets[key] : undefined
    if (value === undefined) throw new Error(`unknown secret {{${name}}}`)
    return value
  })
}

// ---- what a run reports ------------------------------------------------------------------------------------------------------

export const MAX_DETAIL_JSON_CHARS = 8_000
/** A failure screenshot is stored only when it is a JPEG at most this large (after the runner downscaled it). */
export const MAX_SCREENSHOT_BYTES = 300 * 1024

/** The bounded record of one run: per-step timings and web-vitals. Stored with the sample; every string is short and scrubbed by the runner. */
export const BrowserDetailSchema = z.object({
  v: z.literal(1),
  steps: z.array(z.object({
    name: z.string().max(60), action: z.string().max(20), ok: z.boolean(), ms: z.number().int().min(0).max(600_000), error: z.string().max(200).optional(),
  })).max(MAX_BROWSER_STEPS),
  vitals: z.object({
    loadMs: z.number().int().min(0).max(600_000).nullable().optional(),
    ttfbMs: z.number().int().min(0).max(600_000).nullable().optional(),
    fcpMs: z.number().int().min(0).max(600_000).nullable().optional(),
    lcpMs: z.number().int().min(0).max(600_000).nullable().optional(),
    cls: z.number().min(0).max(1000).nullable().optional(),
  }),
  pageErrors: z.number().int().min(0).max(1000),
  failedMainRequests: z.number().int().min(0).max(1000),
  /** Requests the runner's egress policy refused (private or reserved addresses, hosts outside the location's allow-list). */
  blockedRequests: z.number().int().min(0).max(100_000).optional(),
  /** Wall-clock time from browser launch to the first step, so a slow start is visible and is not counted against the page. */
  launchMs: z.number().int().min(0).max(120_000).optional(),
  /** The last URL without query or fragment (they can carry tokens). */
  finalUrl: z.string().max(300).nullable().optional(),
  failedStep: z.number().int().min(0).max(MAX_BROWSER_STEPS).nullable().optional(),
  /** Set when a failure screenshot accompanies the result (the bytes travel separately). */
  screenshot: z.object({
    step: z.string().max(60), bytes: z.number().int().min(1).max(MAX_SCREENSHOT_BYTES), sha256: z.string().regex(/^[0-9a-f]{64}$/),
    width: z.number().int().min(1).max(4000), height: z.number().int().min(1).max(4000),
  }).optional(),
})
export type BrowserDetail = z.infer<typeof BrowserDetailSchema>

/** Parse and bound what a runner sent. Returns null when it is not a valid, small record (the sample is kept, the detail is dropped). */
export function parseBrowserDetail(raw: unknown): BrowserDetail | null {
  const parsed = BrowserDetailSchema.safeParse(raw)
  if (!parsed.success) return null
  return JSON.stringify(parsed.data).length <= MAX_DETAIL_JSON_CHARS ? parsed.data : null
}

/** The vitals verdict, pure: which budgets the run exceeded. */
export function vitalsVerdict(
  budget: z.infer<typeof BrowserVitalsBudgetSchema> | undefined, vitals: { loadMs?: number | null; lcpMs?: number | null; cls?: number | null },
): { severity: 'DOWN' | 'DEGRADED'; reasons: string[] } | null {
  if (!budget) return null
  const reasons: string[] = []
  if (budget.maxLoadMs != null && vitals.loadMs != null && vitals.loadMs > budget.maxLoadMs) reasons.push(`load ${vitals.loadMs}ms is over the ${budget.maxLoadMs}ms budget`)
  if (budget.maxLcpMs != null && vitals.lcpMs != null && vitals.lcpMs > budget.maxLcpMs) reasons.push(`LCP ${vitals.lcpMs}ms is over the ${budget.maxLcpMs}ms budget`)
  if (budget.maxCls != null && vitals.cls != null && vitals.cls > budget.maxCls) reasons.push(`CLS ${vitals.cls.toFixed(3)} is over the ${budget.maxCls} budget`)
  return reasons.length ? { severity: budget.severity ?? 'DEGRADED', reasons } : null
}
