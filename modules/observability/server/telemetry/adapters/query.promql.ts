/** Structured `MetricQuery` to PromQL. Tenant-supplied strings appear only as quoted label values; names are validated. */
import { METRIC_NAME, TENANT_LABEL, type MetricQuery } from '../telemetry.types';
import { labelName, quote } from './query.logql';

export function buildPromQL(tenantId: string, q: MetricQuery): string {
  if (!METRIC_NAME.test(q.metric)) throw new Error('invalid metric name');
  const quantile = /^p(\d+)$/.exec(q.aggregation);
  const name = quantile ? `${q.metric}_bucket` : q.metric;
  const matchers = [`${TENANT_LABEL}=${quote(tenantId)}`];
  for (const f of q.filters) matchers.push(`${labelName(f.field)}${f.op === 'eq' ? '=' : '!='}${quote(f.value)}`);
  const selector = `${name}{${matchers.join(', ')}}`;
  const w = `${q.windowSeconds}s`;
  const by = (extra: string[] = []) => {
    const labels = [...extra, ...q.groupBy.map(labelName)];
    return labels.length ? ` by (${labels.join(', ')})` : '';
  };
  const raw = /^q(\d+)$/.exec(q.aggregation);
  // Per-sample gauges (one value per event): the quantile and the sum are taken over the samples of the window, per series, then combined by label.
  if (raw) return `max${by()} (quantile_over_time(${Number(raw[1]) / 100}, ${selector}[${w}]))`;
  if (q.aggregation === 'total') return `sum${by()} (sum_over_time(${selector}[${w}]))`;
  if (quantile) return `histogram_quantile(${Number(quantile[1]) / 100}, sum${by(['le'])} (rate(${selector}[${w}])))`;
  switch (q.aggregation) {
    case 'rate': return `sum${by()} (rate(${selector}[${w}]))`;
    case 'increase': return `sum${by()} (increase(${selector}[${w}]))`;
    case 'sum': case 'avg': case 'min': case 'max': case 'count': return `${q.aggregation}${by()} (${selector})`;
    default: throw new Error('unsupported aggregation');
  }
}

/** A series selector that matches everything one tenant wrote (for listing names and for deletion). */
export function tenantSelector(tenantId: string): string {
  return `{${TENANT_LABEL}=${quote(tenantId)}}`;
}

/**
 * The series selector `query_exemplars` takes for a metric query: the metric (its `_bucket` series for a histogram quantile), the tenant
 * matcher and the filters, and no function (exemplars hang on series, not on expressions).
 */
export function buildExemplarSelector(tenantId: string, q: MetricQuery): string {
  if (!METRIC_NAME.test(q.metric)) throw new Error('invalid metric name');
  const name = /^p\d+$/.test(q.aggregation) ? `${q.metric}_bucket` : q.metric;
  const matchers = [`${TENANT_LABEL}=${quote(tenantId)}`];
  for (const f of q.filters) matchers.push(`${labelName(f.field)}${f.op === 'eq' ? '=' : '!='}${quote(f.value)}`);
  return `${name}{${matchers.join(', ')}}`;
}
