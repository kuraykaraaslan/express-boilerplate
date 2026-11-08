import type { BoardTemplate, TemplatePlacement } from '@kuraykaraaslan-labs/dashboard/server/board-templates';

/**
 * `dashboard:board_template` contribution (phase 18.4): three ready boards for the signals every service owner asks about, wired to the
 * `telemetry` data source of this module (`telemetry.dashboard-source.ts`). Type-only import of the host's shapes, so the contribution is
 * inert while `dashboard` is off and adds no edge onto it (EXT-14). The dashboard validates each template with the same schemas a manual
 * placement passes and re-resolves every widget for the person applying it, so a person who may not read telemetry gets cards that refuse.
 *
 *  - RED: Rate, Errors, Duration, for one service or all. The three stat cards and the Services table come from traces (no metric names to
 *    know); the charts come from the metric names the board asks for, whose defaults are the ones NB's own metrics use.
 *  - USE: Utilization, Saturation, Errors, for one host. Defaults are the OpenTelemetry host-metrics names as Prometheus spells them.
 *  - Golden signals: latency, traffic, errors, saturation, on one board.
 *
 * Every metric name, the service and the host are board PARAMETERS with defaults (`*` for the service and the host means "all": the dashboard
 * refuses the cards of a parameter left empty, so "all" has to be a value), so one template fits another naming scheme without a
 * copy. The names are checked by `telemetry.board-templates.test.ts` against the data source's real queries.
 */

const SOURCE = 'telemetry';
const param = (key: string) => ({ $param: key });
const bind = (queryKey: string, params: Record<string, unknown>) => ({ sourceKey: SOURCE, queryKey, params });

const serviceParam = {
  key: 'service', label: 'Service', default: '*',
  field: { label: 'Service', type: 'text' as const, placeholder: '* = all services', description: 'The service.name resource attribute.', required: false },
};
const hostParam = {
  key: 'host', label: 'Host', default: '*',
  field: { label: 'Host', type: 'text' as const, placeholder: '* = every host', description: 'The host.name resource attribute.', required: false },
};
const metricParam = (key: string, label: string, def: string) => ({
  key, label, default: def, field: { label, type: 'text' as const, description: `The metric name as it is stored. Default: ${def}`, required: true },
});

/**
 * Phase 29 (docs/phases/07-dashboard/29): a Service page opened from a row. `focus` is the service the page shows, set
 * by the row click; `service` stays the overview's own filter (default `*`), so drilling into one service never narrows
 * the overview behind it.
 */
const focusParam = {
  key: 'focus', label: 'Service shown',
  field: { label: 'Service shown', type: 'text' as const, placeholder: 'service.name', description: 'The service the Service page shows; a click on a row sets it.', required: false },
};
const servicePage = {
  key: 'service', title: 'Service {{param_focus}}', icon: 'server', hidden: true,
  inputs: [{ param: 'focus', required: true }], opensAs: 'panel' as const, size: 'lg' as const,
};
/** A table row opens the Service page for the service in `column`. */
const opensService = (column = 'service') => ({
  v: 2 as const,
  sources: { rowClick: [{ id: 'open-service', name: '', action: { kind: 'openPage' as const, page: 'service', set: { focus: { $row: column } } } }] },
});
/** The Service page: one service's figures, its traffic and latency over time, its errors and failing traces. */
const serviceDetail = (requestMetric: string, durationMetric: string): TemplatePlacement[] => [
  stat(0, 0, 'Requests per second', 'service_red_value', { service: param('focus'), measure: 'ratePerSecond' }, 'Requests per second'),
  stat(3, 0, 'Error rate', 'service_red_value', { service: param('focus'), measure: 'errorRate' }, 'Error rate'),
  stat(6, 0, 'p95 duration (ms)', 'service_red_value', { service: param('focus'), measure: 'p95Ms' }, 'p95 (ms)'),
  stat(9, 0, 'Errors', 'service_red_value', { service: param('focus'), measure: 'errors' }, 'Errors'),
  line(0, 3, 6, 'Requests of {{param_focus}}', { series: bind('metric_series', { metric: param(requestMetric), aggregation: 'rate', filterField: 'service.name', filterValue: param('focus') }) }),
  line(6, 3, 6, 'p95 duration of {{param_focus}}', { series: bind('metric_series', { metric: param(durationMetric), aggregation: 'p95', filterField: 'service.name', filterValue: param('focus') }) }),
  table(0, 9, 6, 'Errors of {{param_focus}}', 'recent_errors', { service: param('focus') }),
  table(6, 9, 6, 'Failing traces of {{param_focus}}', 'failing_traces', { service: param('focus') }),
].map((p) => ({ ...p, pageKey: 'service' }));

const stat = (x: number, y: number, title: string, queryKey: string, params: Record<string, unknown>, label: string): TemplatePlacement => ({
  widgetRef: 'builtin:stat.value', x, y, w: 3, h: 3, title, refreshSeconds: 30, settings: { label },
  dataBinding: { value: bind(queryKey, params) },
});
const line = (x: number, y: number, w: number, title: string, series: Record<string, ReturnType<typeof bind>>): TemplatePlacement => ({
  widgetRef: 'builtin:chart.line', x, y, w, h: 6, title, refreshSeconds: 30, dataBinding: series,
});
const gauge = (x: number, y: number, title: string, params: Record<string, unknown>): TemplatePlacement => ({
  widgetRef: 'builtin:gauge', x, y, w: 3, h: 4, title, refreshSeconds: 30, dataBinding: { value: bind('metric_value', params) },
});
const table = (x: number, y: number, w: number, title: string, queryKey: string, params: Record<string, unknown>): TemplatePlacement => ({
  widgetRef: 'builtin:data.table', x, y, w, h: 6, title, refreshSeconds: 60, dataBinding: { rows: bind(queryKey, params) },
});

const red: BoardTemplate = {
  key: 'observability-red',
  title: 'RED: rate, errors, duration',
  description: 'Requests per second, error rate and latency of one service (or all), with the services table, recent errors and failing traces.',
  anchor: { moduleId: 'observability' },
  timeWindow: { mode: 'relative', last: '1h' },
  params: [serviceParam, metricParam('requestMetric', 'Request counter', 'http_requests_total'), metricParam('durationMetric', 'Duration histogram', 'http_request_duration_seconds'), focusParam],
  mainPage: { title: 'All services', icon: 'chart-line' },
  pages: [servicePage],
  placements: [
    stat(0, 0, 'Requests per second', 'service_red_value', { service: param('service'), measure: 'ratePerSecond' }, 'Requests per second'),
    stat(3, 0, 'Error rate', 'service_red_value', { service: param('service'), measure: 'errorRate' }, 'Error rate'),
    stat(6, 0, 'p95 duration (ms)', 'service_red_value', { service: param('service'), measure: 'p95Ms' }, 'p95 (ms)'),
    stat(9, 0, 'Errors', 'service_red_value', { service: param('service'), measure: 'errors' }, 'Errors'),
    line(0, 3, 6, 'Request rate', { series: bind('metric_series', { metric: param('requestMetric'), aggregation: 'rate', groupBy: 'route' }) }),
    line(6, 3, 6, 'Duration (p50, p95, p99)', {
      series: bind('metric_series', { metric: param('durationMetric'), aggregation: 'p50' }),
      'series#2': bind('metric_series', { metric: param('durationMetric'), aggregation: 'p95' }),
      'series#3': bind('metric_series', { metric: param('durationMetric'), aggregation: 'p99' }),
    }),
    { ...table(0, 9, 12, 'Services', 'service_red', {}), actions: opensService() },
    { ...table(0, 15, 6, 'Recent errors', 'recent_errors', { service: param('service') }), actions: opensService() },
    { ...table(6, 15, 6, 'Failing traces', 'failing_traces', { service: param('service') }), actions: opensService() },
    ...serviceDetail('requestMetric', 'durationMetric'),
  ],
};

const use: BoardTemplate = {
  key: 'observability-use',
  title: 'USE: utilization, saturation, errors',
  description: 'For one host: how busy each resource is, how much work is waiting, and what is failing.',
  anchor: { moduleId: 'observability' },
  timeWindow: { mode: 'relative', last: '1h' },
  params: [
    hostParam,
    metricParam('cpuMetric', 'CPU utilization (0 to 1)', 'system_cpu_utilization'),
    metricParam('memoryMetric', 'Memory utilization (0 to 1)', 'system_memory_utilization'),
    metricParam('diskMetric', 'Disk utilization (0 to 1)', 'system_filesystem_utilization'),
    metricParam('loadMetric', 'Run queue (load average)', 'system_cpu_load_average_1m'),
    metricParam('errorMetric', 'Network errors counter', 'system_network_errors_total'),
  ],
  placements: [
    gauge(0, 0, 'CPU utilization (%)', { metric: param('cpuMetric'), aggregation: 'avg', filterField: 'host.name', filterValue: param('host'), scale: 100 }),
    gauge(3, 0, 'Memory utilization (%)', { metric: param('memoryMetric'), aggregation: 'avg', filterField: 'host.name', filterValue: param('host'), scale: 100 }),
    gauge(6, 0, 'Disk utilization (%)', { metric: param('diskMetric'), aggregation: 'max', filterField: 'host.name', filterValue: param('host'), scale: 100 }),
    stat(9, 0, 'Network errors', 'metric_value', { metric: param('errorMetric'), aggregation: 'increase', filterField: 'host.name', filterValue: param('host') }, 'Network errors'),
    // Phase 29, another way to use pages: the figures now on the main page, their history on its own page.
    ...[
      line(0, 0, 6, 'Utilization over time', {
        series: bind('metric_series', { metric: param('cpuMetric'), aggregation: 'avg', filterField: 'host.name', filterValue: param('host') }),
        'series#2': bind('metric_series', { metric: param('memoryMetric'), aggregation: 'avg', filterField: 'host.name', filterValue: param('host') }),
      }),
      line(6, 0, 6, 'Saturation: run queue', { series: bind('metric_series', { metric: param('loadMetric'), aggregation: 'avg', filterField: 'host.name', filterValue: param('host') }) }),
      line(0, 6, 12, 'Errors over time', { series: bind('metric_series', { metric: param('errorMetric'), aggregation: 'increase', filterField: 'host.name', filterValue: param('host') }) }),
    ].map((p) => ({ ...p, pageKey: 'trends' })),
  ],
  mainPage: { title: 'Now', icon: 'gauge' },
  pages: [{ key: 'trends', title: 'Over time', icon: 'chart-line' }],
};

const golden: BoardTemplate = {
  key: 'observability-golden-signals',
  title: 'Golden signals',
  description: 'Latency, traffic, errors and saturation of one service on one board.',
  anchor: { moduleId: 'observability' },
  timeWindow: { mode: 'relative', last: '1h' },
  params: [
    serviceParam,
    metricParam('requestMetric', 'Traffic: request counter', 'http_requests_total'),
    metricParam('durationMetric', 'Latency: duration histogram', 'http_request_duration_seconds'),
    metricParam('saturationMetric', 'Saturation metric', 'system_cpu_utilization'),
    focusParam,
  ],
  mainPage: { title: 'Golden signals', icon: 'chart-line' },
  pages: [servicePage],
  placements: [
    stat(0, 0, 'Latency p95 (ms)', 'service_red_value', { service: param('service'), measure: 'p95Ms' }, 'Latency p95 (ms)'),
    stat(3, 0, 'Traffic (requests per second)', 'service_red_value', { service: param('service'), measure: 'ratePerSecond' }, 'Requests per second'),
    stat(6, 0, 'Errors (rate)', 'service_red_value', { service: param('service'), measure: 'errorRate' }, 'Error rate'),
    gauge(9, 0, 'Saturation (%)', { metric: param('saturationMetric'), aggregation: 'avg', scale: 100 }),
    line(0, 4, 6, 'Latency (p50, p95, p99)', {
      series: bind('metric_series', { metric: param('durationMetric'), aggregation: 'p50' }),
      'series#2': bind('metric_series', { metric: param('durationMetric'), aggregation: 'p95' }),
      'series#3': bind('metric_series', { metric: param('durationMetric'), aggregation: 'p99' }),
    }),
    line(6, 4, 6, 'Traffic', { series: bind('metric_series', { metric: param('requestMetric'), aggregation: 'rate' }) }),
    line(0, 10, 12, 'Saturation over time', { series: bind('metric_series', { metric: param('saturationMetric'), aggregation: 'avg' }) }),
    { ...table(0, 16, 6, 'Recent errors', 'recent_errors', { service: param('service') }), actions: opensService() },
    { ...table(6, 16, 6, 'Failing traces', 'failing_traces', { service: param('service') }), actions: opensService() },
    ...serviceDetail('requestMetric', 'durationMetric'),
  ],
};

/**
 * D118 (e): the dictionary keys of the words these templates store, by their English text (e2e run 1, V2-WC2: the starters stayed English in a
 * Turkish workspace). A text missing here keeps its English; `telemetry.board-templates.test.ts` holds every text of the three to a key.
 */
const WORDS: Record<string, string> = {
  Service: 'service', 'Request counter': 'requestCounter', 'Duration histogram': 'durationHistogram', 'Service shown': 'serviceShown',
  'All services': 'allServices', 'Service {{param_focus}}': 'servicePage',
  'Requests per second': 'requestsPerSecond', 'Error rate': 'errorRate', 'p95 duration (ms)': 'p95Duration', 'p95 (ms)': 'p95', Errors: 'errors',
  'Request rate': 'requestRate', 'Duration (p50, p95, p99)': 'durationPercentiles', Services: 'services', 'Recent errors': 'recentErrors',
  'Failing traces': 'failingTraces', 'Requests of {{param_focus}}': 'requestsOfService', 'p95 duration of {{param_focus}}': 'p95DurationOfService',
  'Errors of {{param_focus}}': 'errorsOfService', 'Failing traces of {{param_focus}}': 'failingTracesOfService',
  Host: 'host', 'CPU utilization (0 to 1)': 'cpuMetric', 'Memory utilization (0 to 1)': 'memoryMetric', 'Disk utilization (0 to 1)': 'diskMetric',
  'Run queue (load average)': 'loadMetric', 'Network errors counter': 'errorMetric', 'CPU utilization (%)': 'cpu', 'Memory utilization (%)': 'memory',
  'Disk utilization (%)': 'disk', 'Network errors': 'networkErrors', 'Utilization over time': 'utilizationOverTime',
  'Saturation: run queue': 'runQueue', 'Errors over time': 'errorsOverTime', Now: 'now', 'Over time': 'overTime',
  'Traffic: request counter': 'trafficMetric', 'Latency: duration histogram': 'latencyMetric', 'Saturation metric': 'saturationMetric',
  'Golden signals': 'goldenSignals', 'Latency p95 (ms)': 'latencyP95', 'Traffic (requests per second)': 'trafficRate', 'Errors (rate)': 'errorsRate',
  'Saturation (%)': 'saturation', 'Latency (p50, p95, p99)': 'latencyPercentiles', Traffic: 'traffic', 'Saturation over time': 'saturationOverTime',
};
const wordKey = (text: string | null | undefined): string | undefined => (text && Object.hasOwn(WORDS, text) ? `observability.boardTemplate.word.${WORDS[text]}` : undefined);
const keyed = (entries: Array<[string, string | undefined]>): Record<string, string> =>
  Object.fromEntries(entries.filter((e): e is [string, string] => e[1] !== undefined));

/** The template with the keys of its title, description, pages, parameters and cards (`board-template.texts.ts` stores them translated). */
function withTextKeys(t: BoardTemplate, id: string): BoardTemplate {
  const label = (p: TemplatePlacement) => (typeof p.settings?.label === 'string' ? wordKey(p.settings.label) : undefined);
  return {
    ...t,
    titleKey: `observability.boardTemplate.${id}.title`,
    descriptionKey: `observability.boardTemplate.${id}.description`,
    textKeys: {
      ...(wordKey(t.mainPage?.title) ? { mainPage: wordKey(t.mainPage?.title) } : {}),
      pages: keyed((t.pages ?? []).map((pg) => [pg.key, wordKey(pg.title)])),
      params: keyed((t.params ?? []).map((pr) => [pr.key, wordKey(pr.label)])),
    },
    placements: (t.placements ?? []).map((p) => {
      const titleKey = wordKey(p.title);
      const labelKey = label(p);
      return { ...p, ...(titleKey ? { titleKey } : {}), ...(labelKey ? { textKeys: { settings: { label: labelKey } } } : {}) };
    }),
  };
}

/** The default export is an array: the board registry takes one template or many. */
const templates: BoardTemplate[] = [withTextKeys(red, 'red'), withTextKeys(use, 'use'), withTextKeys(golden, 'golden')];
export default templates;
