/**
 * The limits observability declares for the tenancy governance phase (docs/phases/09-observability/16): names only, no enforcement here.
 *
 * Phase 09 declares the keys its features need so the gate names are fixed before anything checks them. Each is a LIMIT for
 * `feature_gate`; the number comes from the tenant's plan, never from this module. A feature that is simply unavailable on a plan
 * is the same key with a limit of 0.
 */
export const OBSERVABILITY_LIMIT_KEYS = {
  /** How many monitors a tenant may have. */
  MONITORS: 'observability.limit.monitors',
  /** The shortest allowed `intervalSeconds`. A LOWER bound, so the gate compares it the other way round. */
  MIN_INTERVAL_SECONDS: 'observability.limit.min_interval_seconds',
  /** Steps per STEPS monitor (0 = the type is not available on the plan). */
  STEPS_PER_MONITOR: 'observability.limit.steps_per_monitor',
  /** Check types a plan may create. 0 = unavailable. */
  TYPE_TLS: 'observability.limit.type_tls',
  TYPE_DOMAIN: 'observability.limit.type_domain',
  TYPE_HEARTBEAT: 'observability.limit.type_heartbeat',
  TYPE_STEPS: 'observability.limit.type_steps',
  /** BROWSER checks (D-OBS-8). 0 = not in the plan; undeclared is unlimited by this module's rule, which is why the explicit tenant setting `observabilityBrowserChecksEnabled` ALSO has to be on. */
  TYPE_BROWSER: 'observability.limit.type_browser',
  /** How many BROWSER monitors a tenant may have (a browser run is expensive, so this is separate from the monitor count). */
  BROWSER_MONITORS: 'observability.limit.browser_monitors',
  /** Locations one monitor may run from (the implicit `local` counts). */
  LOCATIONS_PER_MONITOR: 'observability.limit.locations_per_monitor',
  /** Private probe locations (runners inside the tenant's own network) a tenant may create. */
  PRIVATE_LOCATIONS: 'observability.limit.private_locations',
  /**
   * Probe-runner leases one tenant may have outstanding at once (handed out, not yet resulted or expired), across all its locations. Past it the control
   * plane sheds the tenant's lowest-priority due checks (they stay due). Unlike the other keys, `0` here means NO cap (a cap of zero would stop all probing),
   * and an undeclared key falls back to the deployment default `OBSERVABILITY_PROBE_TENANT_LEASE_CAP`.
   */
  RUNNER_LEASES: 'observability.limit.runner_leases',
  /** SLOs a tenant may define. */
  SLOS: 'observability.limit.slos',
  /** Alert ingest keys a tenant may hold. */
  ALERT_INTEGRATIONS: 'observability.limit.alert_integrations',
  /** Alerts that may be open (firing or muted) at once: a cap on what one tenant can make the pipeline hold. */
  OPEN_ALERTS: 'observability.limit.open_alerts',
  /** Requests per minute a tenant's alert ingest keys may make in total (the per-address limit still applies first). */
  ALERT_INGEST_PER_MINUTE: 'observability.limit.alert_ingest_per_minute',
  /** Heartbeat pings per minute a tenant's monitors may receive in total. */
  HEARTBEATS_PER_MINUTE: 'observability.limit.heartbeats_per_minute',
  /** Days raw probe checks are kept. Caps the tenant's own retention setting; rollups are never pruned. */
  CHECK_RETENTION_DAYS: 'observability.limit.check_retention_days',
  /** Telemetry the tenant may send per UTC day, in megabytes (the request bodies as sent). */
  TELEMETRY_MB_PER_DAY: 'observability.limit.telemetry_mb_per_day',
  /** Days telemetry is kept (passed to the backend's per-tenant retention). */
  TELEMETRY_RETENTION_DAYS: 'observability.limit.telemetry_retention_days',

  // ── Phase 16 leftovers (work order 2, govern) ───────────────────────────────────────────────────────────────────────────────────────
  /** Status pages a tenant may create (the implicit default page counts). */
  STATUS_PAGES: 'observability.limit.status_pages',
  /** Status-page subscribers a tenant may hold (pending and verified together: an unverified address is still a row and still a mail we may send). */
  SUBSCRIBERS: 'observability.limit.subscribers',
  /** On-call seats: distinct people in the participant lists of a tenant's schedule layers. Enforced by `on_call` through its `on_call:limit` contract. */
  ON_CALL_SEATS: 'observability.limit.on_call_seats',
  /** Distinct metric series a tenant's ingested metrics may create per UTC day (the ingest pipeline counts them in Redis). */
  ACTIVE_SERIES: 'observability.limit.active_series',
  /** Log volume per UTC day in megabytes (request bodies of the logs signal). A part of, not in addition to, TELEMETRY_MB_PER_DAY. */
  LOG_MB_PER_DAY: 'observability.limit.log_mb_per_day',
  /** Per-signal telemetry retention caps. A signal without its own key falls back to TELEMETRY_RETENTION_DAYS. */
  TELEMETRY_RETENTION_DAYS_LOGS: 'observability.limit.telemetry_retention_days_logs',
  TELEMETRY_RETENTION_DAYS_TRACES: 'observability.limit.telemetry_retention_days_traces',
  TELEMETRY_RETENTION_DAYS_METRICS: 'observability.limit.telemetry_retention_days_metrics',
  /** Days resolved alerts are kept. Caps the tenant's own setting; open alerts are never pruned. */
  ALERT_RETENTION_DAYS: 'observability.limit.alert_retention_days',
  /** Days resolved incidents (and their post-mortems) are kept. Open incidents and incidents under legal hold are never pruned. */
  INCIDENT_RETENTION_DAYS: 'observability.limit.incident_retention_days',
  /** Days daily rollups are kept. Without a cap and without a tenant setting, rollups are kept for good. */
  ROLLUP_RETENTION_DAYS: 'observability.limit.rollup_retention_days',
  /** Distinct alert label sets (= alert fingerprints) a tenant's SENDERS may introduce per UTC day. */
  ALERT_LABEL_SETS_PER_DAY: 'observability.limit.alert_label_sets_per_day',
  /** Distinct series one ingested metric name may have per tenant per UTC day. */
  SERIES_PER_METRIC: 'observability.limit.series_per_metric',
  /** Distinct log streams (`service.name` values, which become the store's stream labels) a tenant may introduce per UTC day. */
  LOG_STREAMS: 'observability.limit.log_streams',
} as const

export type ObservabilityLimitKey = (typeof OBSERVABILITY_LIMIT_KEYS)[keyof typeof OBSERVABILITY_LIMIT_KEYS]

/** The limit key that decides whether a monitor type may be created at all, or null when the type is on every plan. */
export function typeLimitKey(type: string): ObservabilityLimitKey | null {
  switch (type) {
    case 'TLS': return OBSERVABILITY_LIMIT_KEYS.TYPE_TLS
    case 'DOMAIN': return OBSERVABILITY_LIMIT_KEYS.TYPE_DOMAIN
    case 'HEARTBEAT': return OBSERVABILITY_LIMIT_KEYS.TYPE_HEARTBEAT
    case 'STEPS': return OBSERVABILITY_LIMIT_KEYS.TYPE_STEPS
    case 'BROWSER': return OBSERVABILITY_LIMIT_KEYS.TYPE_BROWSER
    default: return null
  }
}
