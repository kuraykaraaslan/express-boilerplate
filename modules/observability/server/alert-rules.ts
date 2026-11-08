/**
 * Prometheus recording + alerting rules over the metrics this module exports. Thresholds live HERE (one place, reviewed in a diff) and the shipped
 * `infra/prometheus/alerts.yml` is generated from them (`npm run gen:alert-rules`; `--check` fails on drift, and a unit test pins it).
 *
 * Only metrics that exist are referenced: `http_*`, `errors_total`, `uptime_status`, `plugin_executions_total`, the `app_*` default process metrics, the supervisor's `process_crash_loop`
 * and tenant_usage's `tenant_usage_unbilled_*` (lead decision D25, tenant_usage.unbilled.ts) and `tenant_usage_counter_reseeds_total` (D26, tenant_usage.reseed.ts).
 * No dependencies — plain string output, so it runs from a script without booting the app.
 */

export interface AlertThresholds {
  /** Fraction of responses that are 5xx before `HighErrorRatio` fires (0..1). */
  errorRatio: number;
  /** p99 request latency, seconds. */
  latencyP99Seconds: number;
  /** Share of plugin executions that end in error/timeout (0..1), per plugin. */
  pluginFailureRatio: number;
  /** Event-loop lag p99, seconds. */
  eventLoopLagSeconds: number;
  /** Minimum requests/s before ratio alerts may fire — keeps a single failed request on an idle instance from paging. */
  minRequestRate: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  errorRatio: 0.05,
  latencyP99Seconds: 2.5,
  pluginFailureRatio: 0.2,
  eventLoopLagSeconds: 0.5,
  minRequestRate: 0.1,
};

const pct = (r: number): number => Math.round(r * 1000) / 10;

interface Rule { kind: 'record' | 'alert'; name: string; expr: string; for?: string; severity?: 'warning' | 'critical'; summary?: string }

export function buildRules(t: AlertThresholds = DEFAULT_ALERT_THRESHOLDS): Rule[] {
  return [
    { kind: 'record', name: 'http:request_duration_seconds:p95_5m', expr: 'histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))' },
    { kind: 'record', name: 'http:request_duration_seconds:p99_5m', expr: 'histogram_quantile(0.99, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))' },
    { kind: 'record', name: 'http:requests:rate_5m', expr: 'sum(rate(http_requests_total[5m]))' },
    { kind: 'record', name: 'http:requests:error_ratio_5m', expr: 'sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))' },
    {
      kind: 'alert', name: 'HighErrorRatio', severity: 'critical', for: '10m',
      expr: `http:requests:error_ratio_5m > ${t.errorRatio} and http:requests:rate_5m > ${t.minRequestRate}`,
      summary: `More than ${pct(t.errorRatio)}% of responses are 5xx`,
    },
    {
      kind: 'alert', name: 'HighLatencyP99', severity: 'warning', for: '10m',
      expr: `histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m]))) > ${t.latencyP99Seconds} and http:requests:rate_5m > ${t.minRequestRate}`,
      summary: `p99 request latency above ${t.latencyP99Seconds}s`,
    },
    { kind: 'alert', name: 'MonitorDown', severity: 'critical', for: '5m', expr: 'uptime_status == 0', summary: 'An uptime monitor has been DOWN for 5 minutes' },
    { kind: 'alert', name: 'MonitorDegraded', severity: 'warning', for: '15m', expr: 'uptime_status == 0.5', summary: 'An uptime monitor has been DEGRADED for 15 minutes' },
    {
      kind: 'alert', name: 'PluginFailureRatio', severity: 'warning', for: '10m',
      expr: `sum by (pluginId) (rate(plugin_executions_total{outcome!="ok"}[10m])) / sum by (pluginId) (rate(plugin_executions_total[10m])) > ${t.pluginFailureRatio} and sum by (pluginId) (rate(plugin_executions_total[10m])) > ${t.minRequestRate}`,
      summary: `A plugin fails more than ${pct(t.pluginFailureRatio)}% of its executions`,
    },
    {
      kind: 'alert', name: 'EventLoopLag', severity: 'warning', for: '10m',
      expr: `app_nodejs_eventloop_lag_p99_seconds > ${t.eventLoopLagSeconds}`,
      summary: `Node event-loop lag p99 above ${t.eventLoopLagSeconds}s`,
    },
    // 07 task 6: a supervisor froze its kind's scale-up after three child crashes in 5 min (process_host supervisor metrics)
    { kind: 'alert', name: 'ProcessCrashLoop', severity: 'critical', for: '1m', expr: 'max by (kind) (process_crash_loop) == 1', summary: 'A supervised process kind is in a crash loop: scale-up frozen' },
    { kind: 'alert', name: 'MetricsTargetMissing', severity: 'critical', for: '5m', expr: 'absent(app_process_start_time_seconds)', summary: 'No process is exposing app metrics (scrape failing or app down)' },
    // D25: a quota reservation that meets a Redis error admits the units and records them for reconciliation (tenant_usage.unbilled.ts)
    {
      kind: 'alert', name: 'UsageUnbilledRecorded', severity: 'warning', for: '1m',
      expr: 'sum(increase(tenant_usage_unbilled_units_total{outcome="recorded"}[10m])) > 0',
      summary: 'Quota reservations admit usage Redis could not count: recorded unbilled, reconciled when Redis is back',
    },
    {
      kind: 'alert', name: 'UsageUnbilledLost', severity: 'critical', for: '1m',
      expr: 'sum(increase(tenant_usage_unbilled_units_total{outcome="lost"}[10m])) > 0',
      summary: 'Usage units were admitted that could not be counted (the unbilled ledger insert, or a counter Redis refused while reconciling, failed): they will not be billed',
    },
    {
      kind: 'alert', name: 'UsageUnbilledBacklog', severity: 'warning', for: '90m',
      expr: 'max(tenant_usage_unbilled_backlog_rows) > 0',
      summary: 'Unbilled usage is still pending after the usage flush job reconciled every tenant',
    },
    // D26: Redis lost usage counters (a restart with empty data, an eviction); they are re-seeded from the stored values (tenant_usage.reseed.ts)
    {
      kind: 'alert', name: 'UsageCounterReseeded', severity: 'warning', for: '1m',
      expr: 'sum(increase(tenant_usage_counter_reseeds_total{outcome="reseeded"}[10m])) > 0',
      summary: 'Redis lost usage counters: re-seeded from the stored values, usage counted since the last flush is lost',
    },
    {
      kind: 'alert', name: 'UsageCounterReseedFailed', severity: 'critical', for: '1m',
      expr: 'sum(increase(tenant_usage_counter_reseeds_total{outcome="failed"}[10m])) > 0',
      summary: 'A usage counter Redis lost could not take its stored value back: closed quotas refuse on it and the flush skips it until it settles',
    },
  ];
}

function block(expr: string, indent: string): string {
  return `${indent}expr: |\n${indent}  ${expr}`;
}

/** Render the rule file (Prometheus `rule_files` format). Deterministic: same thresholds → byte-identical output. */
export function renderPrometheusRules(t: AlertThresholds = DEFAULT_ALERT_THRESHOLDS): string {
  const rules = buildRules(t);
  const out: string[] = [
    '# GENERATED by `npm run gen:alert-rules` from modules/observability/server/alert-rules.ts — edit the thresholds there, not this file.',
    'groups:',
    '  - name: app-recording',
    '    rules:',
  ];
  for (const r of rules.filter((x) => x.kind === 'record')) out.push(`      - record: ${r.name}`, block(r.expr, '        '));
  out.push('  - name: app-alerts', '    rules:');
  for (const r of rules.filter((x) => x.kind === 'alert')) {
    out.push(`      - alert: ${r.name}`, block(r.expr, '        '));
    if (r.for) out.push(`        for: ${r.for}`);
    out.push('        labels:', `          severity: ${r.severity}`, '        annotations:', `          summary: "${r.summary}"`);
  }
  return out.join('\n') + '\n';
}
