/**
 * Stable machine codes for every refusal the governance layer makes (docs/phases/09-observability/16, "limit refusal messages").
 *
 * A refusal is an `AppError` whose `details` carry:
 *  - `code`        a stable machine code (`OBS_LIMIT_MONITORS`, `OBS_DATA_REGION`, ...): the contract for a UI, an SDK or an alert rule. It never changes
 *                  once shipped; the English `message` may be reworded at any time.
 *  - `messageKey`  the dictionary key (`observability.refusal.<name>`) a screen translates, with the `details` as its `{{placeholders}}`
 *                  (`{{limit}}`, `{{current}}`, `{{requested}}`, ...).
 *  - `key`, `limit`, `current`, ... as before (the LIMIT key that refused, its number, the current use).
 *
 * One table, so "every limit key has a code and a dictionary entry" is a test, not a hope.
 */
import { OBSERVABILITY_LIMIT_KEYS as K } from './observability.limit-keys'

export interface Refusal { code: string; messageKey: string }

const r = (name: string): Refusal => ({ code: `OBS_${name.toUpperCase()}`, messageKey: `observability.refusal.${name}` })

/** Refusals that are not a plan number: a region, a request budget, an unavailable type, a quota that has run out. */
export const REASON_REFUSALS = {
  data_region: r('data_region'),
  daily_quota: r('daily_quota'),
  log_volume: r('log_volume'),
  active_series: r('active_series'),
  open_alert_cap: r('open_alert_cap'),
  request_budget: r('request_budget'),
  label_set_growth: r('label_set_growth'),
  type_unavailable: r('type_unavailable'),
  retention_over_plan: r('retention_over_plan'),
  tenant_concurrency: r('tenant_concurrency'),
  browser_off: r('browser_off'),
} as const

const LIMIT_REFUSALS: Record<string, Refusal> = {
  [K.MONITORS]: r('limit_monitors'),
  [K.MIN_INTERVAL_SECONDS]: r('limit_min_interval_seconds'),
  [K.STEPS_PER_MONITOR]: r('limit_steps_per_monitor'),
  [K.TYPE_TLS]: r('limit_type_tls'),
  [K.TYPE_DOMAIN]: r('limit_type_domain'),
  [K.TYPE_HEARTBEAT]: r('limit_type_heartbeat'),
  [K.TYPE_STEPS]: r('limit_type_steps'),
  [K.LOCATIONS_PER_MONITOR]: r('limit_locations_per_monitor'),
  [K.PRIVATE_LOCATIONS]: r('limit_private_locations'),
  [K.SLOS]: r('limit_slos'),
  [K.ALERT_INTEGRATIONS]: r('limit_alert_integrations'),
  [K.OPEN_ALERTS]: r('limit_open_alerts'),
  [K.ALERT_INGEST_PER_MINUTE]: r('limit_alert_ingest_per_minute'),
  [K.HEARTBEATS_PER_MINUTE]: r('limit_heartbeats_per_minute'),
  [K.CHECK_RETENTION_DAYS]: r('limit_check_retention_days'),
  [K.TELEMETRY_MB_PER_DAY]: r('limit_telemetry_mb_per_day'),
  [K.TELEMETRY_RETENTION_DAYS]: r('limit_telemetry_retention_days'),
  [K.STATUS_PAGES]: r('limit_status_pages'),
  [K.SUBSCRIBERS]: r('limit_subscribers'),
  [K.ON_CALL_SEATS]: r('limit_on_call_seats'),
  [K.ACTIVE_SERIES]: r('limit_active_series'),
  [K.LOG_MB_PER_DAY]: r('limit_log_mb_per_day'),
  [K.TELEMETRY_RETENTION_DAYS_LOGS]: r('limit_telemetry_retention_days_logs'),
  [K.TELEMETRY_RETENTION_DAYS_TRACES]: r('limit_telemetry_retention_days_traces'),
  [K.TELEMETRY_RETENTION_DAYS_METRICS]: r('limit_telemetry_retention_days_metrics'),
  [K.ALERT_RETENTION_DAYS]: r('limit_alert_retention_days'),
  [K.INCIDENT_RETENTION_DAYS]: r('limit_incident_retention_days'),
  [K.ROLLUP_RETENTION_DAYS]: r('limit_rollup_retention_days'),
  [K.ALERT_LABEL_SETS_PER_DAY]: r('limit_alert_label_sets_per_day'),
  [K.SERIES_PER_METRIC]: r('limit_series_per_metric'),
  [K.LOG_STREAMS]: r('limit_log_streams'),
  [K.TYPE_BROWSER]: r('limit_type_browser'),
  [K.BROWSER_MONITORS]: r('limit_browser_monitors'),
  [K.RUNNER_LEASES]: r('limit_runner_leases'),
}

/** The code and dictionary key for a refusal by LIMIT key. An unknown key (a future limit) still gets a stable generic code rather than none. */
export function refusalForLimit(limitKey: string): Refusal {
  return LIMIT_REFUSALS[limitKey] ?? { code: 'OBS_LIMIT', messageKey: 'observability.refusal.limit' }
}

export function refusalForReason(reason: keyof typeof REASON_REFUSALS): Refusal { return REASON_REFUSALS[reason] }

/** Every refusal that exists, for the dictionary-completeness test and the operator documentation. */
export function allRefusals(): Refusal[] {
  return [...Object.values(LIMIT_REFUSALS), ...Object.values(REASON_REFUSALS), { code: 'OBS_LIMIT', messageKey: 'observability.refusal.limit' }]
}

/** The `details` fragment every refusal carries. */
export function refusalDetails(refusal: Refusal): { code: string; messageKey: string } { return { code: refusal.code, messageKey: refusal.messageKey } }
