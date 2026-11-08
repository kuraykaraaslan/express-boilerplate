import { IncidentUpdateStatusEnum } from './uptime.enums'

/**
 * Public update wording (observability phase 14). The defaults are in code, per status, in English; a tenant can override any of them per
 * locale, and an unknown locale falls back to the English default rather than to nothing. Substitution is a closed set of placeholders
 * (`{{title}}`, `{{components}}`, `{{severity}}`) replaced as plain text, never evaluated: a template is data, not a program.
 */
export const DEFAULT_UPDATE_TEMPLATES: Record<string, string> = {
  INVESTIGATING: 'We are investigating an issue: {{title}}. Affected: {{components}}. We will post another update shortly.',
  IDENTIFIED: 'We have identified the cause of the issue: {{title}}, and are working on a fix. Affected: {{components}}.',
  MONITORING: 'A fix has been applied for: {{title}}. We are monitoring the result. Affected: {{components}}.',
  RESOLVED: 'The issue is resolved: {{title}}. Thank you for your patience.',
}

export const TEMPLATE_VARIABLES = ['title', 'components', 'severity'] as const

export function statusKeys(): string[] { return [...IncidentUpdateStatusEnum.options] }

export function renderTemplate(body: string, vars: { title?: string; components?: string[]; severity?: string }): string {
  const values: Record<string, string> = {
    title: (vars.title ?? '').slice(0, 300),
    components: vars.components && vars.components.length > 0 ? vars.components.join(', ').slice(0, 300) : 'the service',
    severity: (vars.severity ?? '').toLowerCase(),
  }
  return body.replace(/\{\{\s*([a-z]+)\s*\}\}/g, (m, name: string) => (name in values ? values[name] : m)).slice(0, 2000)
}

/** The locale's template, then the English override, then the English default. */
export function pickTemplate(status: string, locale: string, overrides: ReadonlyArray<{ status: string; locale: string; body: string }>): string | null {
  const short = locale.toLowerCase().split('-')[0]
  return overrides.find((o) => o.status === status && o.locale === locale)?.body
    ?? overrides.find((o) => o.status === status && o.locale === short)?.body
    ?? overrides.find((o) => o.status === status && o.locale === 'en')?.body
    ?? DEFAULT_UPDATE_TEMPLATES[status] ?? null
}
