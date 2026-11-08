/**
 * Manual spans over whichever tracing backend is live: Sentry's `startSpan` (OpenTelemetry-based since SDK v8) first, the raw OTel API second, and a
 * plain call when neither is on. The callback's result and any thrown error pass through untouched — tracing never changes control flow.
 */
import { getSentry } from './sentry.init';
import { getOtelApi } from './otel.init';

export type SpanAttributeValue = string | number | boolean;

export interface SpanHandle {
  setAttribute(key: string, value: SpanAttributeValue): void;
}

export interface SpanOptions {
  /** Sentry `op` (e.g. `db.query`, `queue.process`); recorded as an attribute on OTel. */
  op?: string;
  attributes?: Record<string, SpanAttributeValue>;
}

const NOOP_SPAN: SpanHandle = { setAttribute: () => {} };

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return !!v && typeof (v as { then?: unknown }).then === 'function';
}

export function withSpan<T>(name: string, fn: (span: SpanHandle) => T, opts: SpanOptions = {}): T {
  const sentry = getSentry();
  if (sentry && typeof sentry.startSpan === 'function') {
    return sentry.startSpan({ name, op: opts.op, attributes: opts.attributes }, (span: { setAttribute(k: string, v: SpanAttributeValue): void }) =>
      fn({ setAttribute: (k, v) => span.setAttribute(k, v) }),
    ) as T;
  }

  const otel = getOtelApi();
  if (otel?.trace) {
    const tracer = otel.trace.getTracer('observability');
    const attributes = { ...(opts.op ? { 'span.op': opts.op } : {}), ...(opts.attributes ?? {}) };
    return tracer.startActiveSpan(name, { attributes }, (span: { setAttribute(k: string, v: SpanAttributeValue): void; recordException(e: unknown): void; setStatus(s: { code: number }): void; end(): void }) => {
      const fail = (e: unknown) => { span.recordException(e); span.setStatus({ code: 2 /* ERROR */ }); span.end(); };
      let result: T;
      try {
        result = fn({ setAttribute: (k, v) => span.setAttribute(k, v) });
      } catch (e) {
        fail(e);
        throw e;
      }
      if (isThenable(result)) {
        return result.then((v) => { span.end(); return v; }, (e) => { fail(e); throw e; }) as T;
      }
      span.end();
      return result;
    });
  }

  return fn(NOOP_SPAN);
}
