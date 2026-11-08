/**
 * Prometheus rules for the PLATFORM SLOs (observability phase 13.4): recording rules for the error ratio over every window the burn tiers use, an
 * error-budget gauge, and the multiwindow, multi-burn-rate alerts. The shipped `infra/prometheus/slo-rules.yml` is generated from this file by the
 * same script and the same drift test as `alerts.yml` (`npm run gen:alert-rules` / `check:alert-rules`).
 *
 * The tiers, thresholds, minimum-bad-events guard and the "burn = error ratio / allowed error ratio" definition are IMPORTED from `slo.budget.ts`,
 * the module the in-product evaluation (`evaluateTier`) uses, so the two cannot drift: change a tier there and this file's output changes with it
 * (and the drift test fails until the YAML is regenerated).
 *
 * Only metrics that exist are referenced (`http_requests_total{status}`, `http_request_duration_seconds_{bucket,count}`, see `metrics.ts`; the
 * test reads that file and checks the names, the labels and the bucket used here).
 *
 * What this is not: it does not evaluate METRIC_RATIO SLOs of the product. Those stay ROOT-only and read `NO_DATA` until a telemetry backend is
 * wired (phase 17); this file is how the PLATFORM's own request SLOs are alerted on by a Prometheus the operator runs, independently of the app.
 *
 * Plain string output with no I/O so a script can run it without booting the app.
 */
import { BURN_TIERS, MIN_BAD_EVENTS_IN_SHORT_WINDOW, allowedErrorRate, tierBurnRate, type BurnTier } from './slo.budget'

export interface PlatformSlo {
  /** Stable id: the `slo` label of every series and alert this SLO generates. */
  id: string
  title: string
  objectivePercent: number
  windowDays: 7 | 28 | 30 | 90
  /** PromQL (a scalar-valued vector) for the error ratio over `window`. */
  errorRatio: (window: string) => string
  /** PromQL for the number of bad events over `window` (used for the minimum-bad-events guard). */
  badEvents: (window: string) => string
}

/** The latency threshold of the latency SLO. It MUST be one of the histogram's bucket bounds (the test checks it against `metrics.ts`). */
export const LATENCY_SLO_LE_SECONDS = 1

export const PLATFORM_SLOS: readonly PlatformSlo[] = [
  {
    id: 'platform-api-availability',
    title: 'API availability: share of HTTP responses that are not 5xx',
    objectivePercent: 99.9,
    windowDays: 30,
    // `or vector(0)`: a process that has never answered with a 5xx has no 5xx series at all; that is a ratio of zero, not an empty result.
    errorRatio: (w) => `(sum(rate(http_requests_total{status=~"5.."}[${w}])) or vector(0)) / sum(rate(http_requests_total[${w}]))`,
    badEvents: (w) => `sum(increase(http_requests_total{status=~"5.."}[${w}]))`,
  },
  {
    id: 'platform-api-latency',
    title: `API latency: share of HTTP responses answered within ${LATENCY_SLO_LE_SECONDS}s`,
    objectivePercent: 99,
    windowDays: 30,
    errorRatio: (w) => `1 - (sum(rate(http_request_duration_seconds_bucket{le="${LATENCY_SLO_LE_SECONDS}"}[${w}])) / sum(rate(http_request_duration_seconds_count[${w}])))`,
    badEvents: (w) => `sum(increase(http_request_duration_seconds_count[${w}])) - sum(increase(http_request_duration_seconds_bucket{le="${LATENCY_SLO_LE_SECONDS}"}[${w}]))`,
  },
]

/** A duration in hours as a PromQL range: 5/60 -> 5m, 0.5 -> 30m, 1 -> 1h, 6 -> 6h, 72 -> 3d. */
export function windowLabel(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours % 24 === 0) return `${hours / 24}d`
  return `${hours}h`
}

/** Render a number the way it is written in the rule: no float noise (14.4 not 14.400000000000002). */
export function num(n: number): string {
  return String(Number(n.toPrecision(12)))
}

export interface SloAlertCondition {
  tier: BurnTier['id']
  action: BurnTier['action']
  slo: string
  longWindow: string
  shortWindow: string
  /** The burn rate both windows must reach (`tierBurnRate` of the tier at the SLO's window). */
  thresholdBurnRate: number
  /** The allowed error ratio the error ratio is divided by (1 - objective). */
  allowedErrorRatio: number
  minBadEvents: number
}

export type SloRule =
  | { kind: 'record'; name: string; expr: string; labels: Record<string, string> }
  | { kind: 'alert'; name: string; expr: string; labels: Record<string, string>; annotations: Record<string, string>; condition: SloAlertCondition }

/** The windows every SLO needs a ratio for: the long and short window of each tier, plus the SLO window itself (for the budget). */
export function ratioWindows(slo: PlatformSlo): string[] {
  const hours = new Set<number>([slo.windowDays * 24])
  for (const t of BURN_TIERS) { hours.add(t.longHours); hours.add(t.shortHours) }
  return [...hours].sort((a, b) => a - b).map(windowLabel)
}

export const ratioRecordName = (window: string): string => `slo:sli_error:ratio_rate${window}`
export const BUDGET_RECORD_NAME = 'slo:error_budget_remaining:ratio'

/** The alert condition text of one tier: both windows at or above the burn rate, and enough bad events in the short window. */
export function alertExpr(slo: PlatformSlo, c: SloAlertCondition): string {
  const burn = (w: string) => `${ratioRecordName(w)}{slo="${slo.id}"} / ${num(c.allowedErrorRatio)} >= ${num(c.thresholdBurnRate)}`
  // `and on()`: the guard is an aggregate with no labels, so it is matched against the whole left side, not label by label.
  return `${burn(c.longWindow)}\nand\n${burn(c.shortWindow)}\nand on()\n${slo.badEvents(c.shortWindow)} >= ${c.minBadEvents}`
}

export function buildSloRules(slos: readonly PlatformSlo[] = PLATFORM_SLOS): SloRule[] {
  const rules: SloRule[] = []
  for (const slo of slos) {
    const allowed = allowedErrorRate(slo.objectivePercent)
    const windowRange = windowLabel(slo.windowDays * 24)
    for (const w of ratioWindows(slo)) {
      rules.push({ kind: 'record', name: ratioRecordName(w), expr: slo.errorRatio(w), labels: { slo: slo.id } })
    }
    // What is left of the budget over the SLO window: 1 - errors / allowed errors (the same `remainingFraction` the product shows).
    rules.push({ kind: 'record', name: BUDGET_RECORD_NAME, expr: `1 - (${ratioRecordName(windowRange)}{slo="${slo.id}"} / ${num(allowed)})`, labels: { slo: slo.id } })
    for (const tier of BURN_TIERS) {
      const condition: SloAlertCondition = {
        tier: tier.id, action: tier.action, slo: slo.id,
        longWindow: windowLabel(tier.longHours), shortWindow: windowLabel(tier.shortHours),
        thresholdBurnRate: tierBurnRate(tier, slo.windowDays), allowedErrorRatio: allowed, minBadEvents: MIN_BAD_EVENTS_IN_SHORT_WINDOW,
      }
      rules.push({
        kind: 'alert', name: 'SloBurn', condition, expr: alertExpr(slo, condition),
        labels: { severity: tier.action === 'page' ? 'critical' : 'warning', slo: slo.id, tier: tier.id, action: tier.action },
        annotations: {
          summary: `${slo.id}: error budget burning at ${num(condition.thresholdBurnRate)}x or faster over ${condition.longWindow} and ${condition.shortWindow} (objective ${num(slo.objectivePercent)}% over ${slo.windowDays} days)`,
        },
      })
    }
  }
  return rules
}

/** Render the rule file (Prometheus `rule_files` format). Deterministic: same SLOs and tiers give byte-identical output. */
export function renderSloRules(slos: readonly PlatformSlo[] = PLATFORM_SLOS): string {
  const rules = buildSloRules(slos)
  const out: string[] = [
    '# GENERATED by `npm run gen:alert-rules` from modules/observability/server/slo-rules.ts (tiers from slo.budget.ts) — edit those, not this file.',
    'groups:',
  ]
  for (const slo of slos) {
    out.push(`  - name: slo-${slo.id}-recording`, '    rules:')
    for (const r of rules.filter((x) => x.kind === 'record' && x.labels.slo === slo.id)) {
      out.push(`      - record: ${r.name}`, `        expr: |`, `          ${r.expr}`, '        labels:', ...Object.entries(r.labels).map(([k, v]) => `          ${k}: ${v}`))
    }
    out.push(`  - name: slo-${slo.id}-alerts`, '    rules:')
    for (const r of rules.filter((x) => x.kind === 'alert' && x.labels.slo === slo.id)) {
      out.push(`      - alert: ${r.name}`, '        expr: |', ...r.expr.split('\n').map((l) => `          ${l}`))
      out.push('        labels:', ...Object.entries(r.labels).map(([k, v]) => `          ${k}: ${v}`))
      if (r.kind === 'alert') out.push('        annotations:', ...Object.entries(r.annotations).map(([k, v]) => `          ${k}: "${v.replace(/"/g, '\\"')}"`))
    }
  }
  return out.join('\n') + '\n'
}
