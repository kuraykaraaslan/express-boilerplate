import { safeFetch } from '@kuraykaraaslan-labs/common/server/safe-fetch'
import { egressFetchOptions } from './probe.egress'
import { decryptFieldOpt } from '@kuraykaraaslan-labs/common/server/field-encryption'
import { evaluateAssertions, needsBody, parseJsonPath, readJsonPath, compilePattern, type Assertion } from './uptime.assertions'
import { MAX_SUBSTITUTED_LENGTH, SECRET_NAME, StepListSchema, type Step } from './uptime.steps.schema'
import { readBodyCapped, type CheckOutcome } from './uptime.probe.service'
import type { Monitor } from './entities/monitor.entity'

/**
 * Multi-step API checks (observability phase 09.5).
 *
 * A short, fixed sequence of requests where a later step can use a value read from an earlier one (log in, then call with the token).
 * The grammar is CLOSED on purpose: methods, a URL, headers, a body, assertions and extractions. There are no conditionals, loops
 * or expressions — a step list that can branch is a scripting language, and a scripting language inside a probe is an attack surface.
 *
 *  - Every request goes through `safeFetch`, so each step is SSRF-guarded like a plain HTTP monitor.
 *  - Secrets are referenced as `{{secret.NAME}}`. They live encrypted on the monitor (`secrets`), never inside the step text, and a
 *    failure reason never contains a substituted value.
 *  - The whole run shares ONE time budget (`timeoutMs`) and a hard step cap.
 */

export { MAX_STEPS, SECRET_NAME, StepSchema, StepListSchema, referencedVariables, type Step } from './uptime.steps.schema'

export class StepError extends Error {}

/** Replace `{{var}}` / `{{secret.NAME}}`. Unknown names are an error, not an empty string. */
export function interpolate(text: string, vars: ReadonlyMap<string, string>, secrets: Readonly<Record<string, string>>): string {
  const out = text.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_m, name: string) => {
    let value: string | undefined
    if (name.startsWith('secret.')) {
      const key = name.slice('secret.'.length)
      value = SECRET_NAME.test(key) ? secrets[key] : undefined
    } else {
      value = vars.get(name)
    }
    if (value === undefined) throw new StepError(`unknown variable {{${name}}}`)
    return value
  })
  if (out.length > MAX_SUBSTITUTED_LENGTH + text.length) throw new StepError('a substituted value is too long')
  return out
}

/** Pure: read one extraction from a finished response. Returns null when there is nothing to extract. */
export function extractValue(
  ex: NonNullable<Step['extract']>[number], res: { header(name: string): string | null; body: string },
): string | null {
  let v: string | null = null
  if (ex.from === 'header') {
    v = res.header(ex.path)
  } else if (ex.from === 'json') {
    const segs = parseJsonPath(ex.path)
    if (!segs) return null
    let doc: unknown
    try { doc = JSON.parse(res.body) } catch { return null }
    const r = readJsonPath(doc, segs)
    if (r.found && (typeof r.value === 'string' || typeof r.value === 'number' || typeof r.value === 'boolean')) v = String(r.value)
  } else {
    const c = compilePattern(ex.path)
    if ('error' in c) return null
    const m = c.re.exec(res.body.slice(0, 100_000))
    v = m ? (m[1] ?? m[0]) : null
  }
  return v !== null && v.length <= MAX_SUBSTITUTED_LENGTH ? v : null
}

/** Decrypt the monitor's secret map. An entry that fails to decrypt is dropped so a step referencing it fails by name, not by value. */
export function readSecrets(raw: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (!SECRET_NAME.test(k)) continue
    const plain = decryptFieldOpt(v)
    if (typeof plain === 'string') out[k] = plain
  }
  return out
}

/** Remove every secret value from a message before it is stored (a transport error can quote the URL it was given). */
export function redactSecrets(message: string, secrets: Readonly<Record<string, string>>): string {
  let out = message
  for (const v of Object.values(secrets)) if (v.length >= 4) out = out.split(v).join('***')
  return out
}

type StepsMonitor = Pick<Monitor, 'timeoutMs' | 'degradedLatencyMs' | 'steps' | 'secrets'>

export async function runStepsCheck(monitor: StepsMonitor): Promise<CheckOutcome> {
  const parsed = StepListSchema.safeParse(monitor.steps)
  if (!parsed.success) {
    return { status: 'DOWN', latencyMs: null, statusCode: null, error: 'step list is invalid' }
  }
  const steps = parsed.data
  const secrets = readSecrets(monitor.secrets)
  const vars = new Map<string, string>()
  const budgetMs = monitor.timeoutMs ?? 10_000
  const started = Date.now()
  let lastStatus: number | null = null
  let degraded: string | null = null

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]
    const label = `step ${i + 1} "${step.name}"`
    const remaining = budgetMs - (Date.now() - started)
    if (remaining <= 0) return { status: 'DOWN', latencyMs: Date.now() - started, statusCode: lastStatus, error: `${label}: time budget of ${budgetMs}ms used up` }
    try {
      const url = interpolate(step.url, vars, secrets)
      const headers = Object.fromEntries(Object.entries(step.headers ?? {}).map(([k, v]) => [k, interpolate(v, vars, secrets)]))
      const body = step.body === undefined ? undefined : interpolate(step.body, vars, secrets)
      const t0 = Date.now()
      const res = await safeFetch(url, { method: step.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(remaining) }, egressFetchOptions())
      const stepLatency = Date.now() - t0
      lastStatus = res.status

      const rules: Assertion[] = step.assertions ?? []
      const wantsBody = needsBody(rules) || (step.extract?.some((e) => e.from !== 'header') ?? false)
      const read = wantsBody ? await readBodyCapped(res) : { text: '', bytes: Number(res.headers?.get?.('content-length')) || 0 }
      const rulesWithDefault: Assertion[] = rules.some((a) => a.kind === 'status') ? rules : [{ kind: 'status', in: statusRange(res.status) }, ...rules]
      const result = evaluateAssertions(rulesWithDefault, {
        statusCode: res.status, latencyMs: stepLatency, body: read.text, sizeBytes: read.bytes, header: (n) => res.headers.get(n),
      })
      if (result.down.length > 0) {
        return { status: 'DOWN', latencyMs: Date.now() - started, statusCode: res.status, error: `${label}: ${result.down[0]}`.slice(0, 300) }
      }
      if (result.degraded.length > 0 && !degraded) degraded = `${label}: ${result.degraded[0]}`.slice(0, 300)

      // Default rule when the step lists none: a 2xx or 3xx answer. (Handled above by `rulesWithDefault`.)
      for (const ex of step.extract ?? []) {
        const v = extractValue(ex, { header: (n) => res.headers.get(n), body: read.text })
        if (v === null) return { status: 'DOWN', latencyMs: Date.now() - started, statusCode: res.status, error: `${label}: could not extract "${ex.name}"` }
        vars.set(ex.name, v)
      }
    } catch (err) {
      const message = redactSecrets(err instanceof Error ? err.message : String(err), secrets)
      return { status: 'DOWN', latencyMs: Date.now() - started, statusCode: lastStatus, error: `${label}: ${message}`.slice(0, 300) }
    }
  }

  const latencyMs = Date.now() - started
  if (degraded) return { status: 'DEGRADED', latencyMs, statusCode: lastStatus, error: degraded }
  if (monitor.degradedLatencyMs != null && latencyMs > monitor.degradedLatencyMs) return { status: 'DEGRADED', latencyMs, statusCode: lastStatus, error: null }
  return { status: 'UP', latencyMs, statusCode: lastStatus, error: null }
}

/** The default "healthy" set for a step with no status assertion: the status it got if it is 2xx or 3xx, otherwise an impossible one. */
function statusRange(code: number): number[] {
  return code >= 200 && code < 400 ? [code] : [200]
}
