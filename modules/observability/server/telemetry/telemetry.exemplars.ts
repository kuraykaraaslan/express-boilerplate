/**
 * Exemplars on the request histogram (phase 17.4), opt-in. An exemplar links one bucket of `http_request_duration_seconds` to the
 * trace of a request that landed in it: the metric -> trace pivot of the metrics explorer.
 *
 * What prom-client needs (v15, checked by this folder's test against the real library): the registry must render OpenMetrics
 * (`registry.setContentType(Registry.OPENMETRICS_CONTENT_TYPE)`) BEFORE a histogram with `enableExemplars: true` is constructed (the
 * constructor throws on a classic registry), and the histogram is observed with the object form `observe({ labels, value,
 * exemplarLabels })`. The classic text format has no exemplar syntax. Prometheus must run with `--enable-feature=exemplar-storage` and
 * scrape with OpenMetrics negotiation. Switching the registry to OpenMetrics changes the whole scrape output (the metrics route
 * returns `registry.contentType`, so it follows).
 *
 * This file holds the pieces. WIRING in `metrics.ts` / `observability.service.ts` is two small edits outside this change (see the
 * README of this folder): in `initMetrics`, `const exemplarOptions = prepareExemplars(prom, registry)` right after the registry is
 * created and spread into the `http_request_duration_seconds` options; in `recordHttpRequest`, `observeRequest(...)` instead of
 * `observe(...)`. Nothing here changes behaviour unless `TELEMETRY_EXEMPLARS=true`.
 */
import { telemetryEnv } from './telemetry.env';
import { activeTraceContext, type TraceContext } from './telemetry.propagation';

export function exemplarsOptedIn(env: Record<string, string | undefined> = telemetryEnv()): boolean {
  return /^(1|true|yes)$/i.test(env.TELEMETRY_EXEMPLARS ?? '');
}

/**
 * Call once, right after the registry is created and before any histogram: when opted in, switches the registry to OpenMetrics and
 * returns the histogram option to spread into the request histogram's config; otherwise changes nothing and returns `{}`.
 */
export function prepareExemplars(prom: PromLike, registry: { setContentType(t: string): void }, env: Record<string, string | undefined> = telemetryEnv()): { enableExemplars?: true } {
  if (!exemplarsOptedIn(env)) return {};
  switchToOpenMetrics(prom, registry);
  return { enableExemplars: true };
}

/** `{ trace_id, span_id }` of the span, or `undefined` (prom-client drops an exemplar with no labels). 63 characters, below the 128 limit. */
export function exemplarLabels(ctx: TraceContext | null): Record<string, string> | undefined {
  return ctx ? { trace_id: ctx.traceId, span_id: ctx.spanId } : undefined;
}

interface HistogramLike {
  enableExemplars?: boolean;
  observe(a: unknown, b?: unknown): void;
}

/**
 * Observes `seconds`. A histogram built with exemplars only accepts the object form (its `observe(labels, value)` form throws), so that
 * form is used for it, with the active trace as the exemplar when there is one; any other histogram is observed the plain way.
 */
export function observeRequest(h: HistogramLike, labels: Record<string, string | number>, seconds: number, ctx: TraceContext | null = activeTraceContext()): void {
  if (h.enableExemplars !== true) { h.observe(labels, seconds); return; }
  const ex = exemplarLabels(ctx);
  h.observe({ labels, value: seconds, ...(ex ? { exemplarLabels: ex } : {}) });
}

interface PromLike { Registry: { OPENMETRICS_CONTENT_TYPE: string } }

/** Switches a registry to OpenMetrics output (required for exemplars to be rendered). */
export function switchToOpenMetrics(prom: PromLike, registry: { setContentType(t: string): void }): void {
  registry.setContentType(prom.Registry.OPENMETRICS_CONTENT_TYPE);
}
