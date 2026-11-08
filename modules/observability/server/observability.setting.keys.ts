import { z } from 'zod';

// Canonical per-tenant setting keys for observability. Centralised so the
// settings UI and runtime readers never drift apart.
export const ObservabilitySettingKeySchema = z.enum([
  'observabilityStatusPageEnabled',
  'observabilityUptimeCheckRetentionDays',
  'observabilityExcludeMaintenanceFromUptime',
  'observabilityIncidentOnCritical',
  'observabilityIncidentOnMajor',
  'observabilityIncidentOnMinor',
  'observabilityIncidentOnWarning',
  'observabilityIncidentOnInfo',
  'observabilityDataRegion',
  'observabilityWatchdogUrl',
  'observabilityAlertRetentionDays',
  'observabilityIncidentRetentionDays',
  'observabilityRollupRetentionDays',
  'observabilityLegalHold',
  'observabilityBrowserChecksEnabled',
]);
export type ObservabilitySettingKey = z.infer<typeof ObservabilitySettingKeySchema>;
export const OBSERVABILITY_SETTING_KEY_LIST = ObservabilitySettingKeySchema.options;

export const OBSERVABILITY_SETTING_KEYS = {
  // Public /status page + API. Default OFF (locked decision): a page that
  // ships enabled could leak internal service names before anyone reviews it.
  STATUS_PAGE_ENABLED: 'observabilityStatusPageEnabled',
  // Raw monitor_checks retention in days (phase 0.4; the plan's
  // `uptimeCheckRetentionDays`, carried in the module's key convention).
  // Default 30, clamped 2..365 — daily rollups are NEVER pruned, so uptime
  // percentages survive any value here.
  UPTIME_CHECK_RETENTION_DAYS: 'observabilityUptimeCheckRetentionDays',
  /**
   * Keep planned maintenance out of the uptime percentage. Default ON: counting
   * a scheduled window as downtime makes the SLA number a lie about UNPLANNED
   * availability, which is the only kind anybody reading a status page is
   * asking about. Applied at write time, so flipping it never rewrites history.
   */
  EXCLUDE_MAINTENANCE_FROM_UPTIME: 'observabilityExcludeMaintenanceFromUptime',
  // What a group of alerts of this severity does about the incident: `auto` opens one, `never` only records. Defaults reproduce the
  // behaviour from before the alert layer (see alert.policy.ts). A route can override per alert.
  INCIDENT_ON_CRITICAL: 'observabilityIncidentOnCritical',
  INCIDENT_ON_MAJOR: 'observabilityIncidentOnMajor',
  INCIDENT_ON_MINOR: 'observabilityIncidentOnMinor',
  INCIDENT_ON_WARNING: 'observabilityIncidentOnWarning',
  INCIDENT_ON_INFO: 'observabilityIncidentOnInfo',
  /**
   * The one region this workspace's observability data may live in (phase 16.6). Empty = no constraint. Telemetry arriving at a deployment in
   * another region is refused, never copied across: the placement itself is the fleet's (docs/phases/02-fleet/05-tenancy-and-routing.md).
   */
  DATA_REGION: 'observabilityDataRegion',
  /** ROOT tenant only: an https URL the platform pushes a heartbeat to every minute (a dead-man's switch OUTSIDE the platform; phase 19.5). Empty = off. */
  WATCHDOG_URL: 'observabilityWatchdogUrl',
  /** Days RESOLVED alerts are kept (default 180, clamped 7..3650, then capped by the plan). Open alerts are never pruned. */
  ALERT_RETENTION_DAYS: 'observabilityAlertRetentionDays',
  /** Days RESOLVED incidents and their post-mortems are kept (default 730, clamped 90..3650, then capped by the plan). Open incidents and held ones never. */
  INCIDENT_RETENTION_DAYS: 'observabilityIncidentRetentionDays',
  /** Days daily rollups are kept (clamped 365..3650, then capped by the plan). EMPTY (the default) keeps them for good. */
  ROLLUP_RETENTION_DAYS: 'observabilityRollupRetentionDays',
  /** `true` puts the whole workspace under a legal hold: no alert, incident or post-mortem is pruned until it is cleared (a per-incident hold also exists). */
  LEGAL_HOLD: 'observabilityLegalHold',
  /**
   * BROWSER checks (D-OBS-8) are OFF until a workspace admin switches them on, whatever the plan says: an undeclared plan limit is "unlimited" by this
   * module's rule, so the plan alone could not keep a headless browser from being offered by accident. Default off.
   */
  BROWSER_CHECKS_ENABLED: 'observabilityBrowserChecksEnabled',
} as const satisfies Record<string, ObservabilitySettingKey>;
