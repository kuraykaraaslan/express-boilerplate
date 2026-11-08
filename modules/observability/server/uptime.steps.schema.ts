import { z } from 'zod'
import { AssertionListSchema, compilePattern, parseJsonPath } from './uptime.assertions'

/**
 * The multi-step check grammar (observability phase 09.5), as pure data: no I/O, no logger, no environment. The DTO, the importer and
 * the runner all read it from here, so a step list means the same thing wherever it is validated.
 */

export const MAX_STEPS = 10
export const MAX_VARIABLES = 30
export const MAX_SUBSTITUTED_LENGTH = 4000

export const VAR_NAME = /^[a-z][a-zA-Z0-9_]{0,30}$/
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,39}$/

export const StepSchema = z.object({
  name: z.string().min(1).max(60),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
  url: z.string().min(1).max(1000),
  headers: z.record(z.string().min(1).max(100), z.string().max(1000)).optional(),
  body: z.string().max(10_000).optional(),
  assertions: AssertionListSchema.optional(),
  extract: z.array(z.object({
    name: z.string().regex(VAR_NAME),
    from: z.enum(['json', 'header', 'regex']),
    /** json: a JSONPath; header: a header name; regex: a pattern whose first group is the value. */
    path: z.string().min(1).max(200),
  })).max(10).optional(),
})
export type Step = z.infer<typeof StepSchema>

export const StepListSchema = z.array(StepSchema).min(1).max(MAX_STEPS).superRefine((steps, ctx) => {
  const defined = new Set<string>()
  steps.forEach((step, i) => {
    for (const ref of referencedVariables(step)) {
      if (ref.startsWith('secret.')) continue
      if (!defined.has(ref)) ctx.addIssue({ code: 'custom', path: [i], message: `step "${step.name}" uses {{${ref}}} before any step extracts it` })
    }
    for (const ex of step.extract ?? []) {
      if (ex.from === 'json' && !parseJsonPath(ex.path)) ctx.addIssue({ code: 'custom', path: [i, 'extract'], message: `unsupported JSONPath ${ex.path}` })
      if (ex.from === 'regex') { const c = compilePattern(ex.path); if ('error' in c) ctx.addIssue({ code: 'custom', path: [i, 'extract'], message: c.error }) }
      defined.add(ex.name)
    }
  })
  if (defined.size > MAX_VARIABLES) ctx.addIssue({ code: 'custom', message: `at most ${MAX_VARIABLES} extracted variables` })
})

/** Names used as `{{name}}` in a step's url, header values and body. */
export function referencedVariables(step: Pick<Step, 'url' | 'headers' | 'body'>): string[] {
  const texts = [step.url, step.body ?? '', ...Object.values(step.headers ?? {})]
  const out = new Set<string>()
  for (const t of texts) for (const m of t.matchAll(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g)) out.add(m[1])
  return [...out]
}

