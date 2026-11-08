/**
 * Public types for the observability facade. Kept dependency-free so callers
 * can import them without dragging Sentry / prom-client into client bundles.
 */

export interface ObservabilityTags {
  tenantId?: string;
  /** Accepted for existing callers and ignored: no user identifier is sent to Sentry. */
  userId?: string;
  requestId?: string;
  [k: string]: string | number | boolean | undefined;
}

export interface HttpRequestSample {
  tenantId?: string;
  route: string;
  method: string;
  status: number;
  latencyMs: number;
}

export interface TenantUsageSample {
  tenantId: string;
  metric: 'apiCalls' | 'aiTokens' | 'storageBytes' | 'emailSends' | 'smsSends' | (string & {});
  value: number;
}

export interface RecordErrorOptions {
  tenantId?: string;
  fingerprint?: string[];
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  extra?: Record<string, unknown>;
}

/**
 * One sandboxed-plugin execution (marketplace §6D wiring): the platform's OWN
 * observability carries plugin crash/latency telemetry — the marketplace never
 * builds a telemetry store of its own. `pluginId` label cardinality is bounded
 * by the installed catalog.
 */
export interface PluginExecutionSample {
  tenantId: string;
  pluginId: string;
  pluginVersionId?: string;
  kind: 'http' | 'event' | 'provider';
  /** Route key / event name / point#op — Sentry extra only, never a metric label. */
  target?: string;
  durationMs: number;
  outcome: 'ok' | 'error' | 'timeout';
  error?: Error;
}
