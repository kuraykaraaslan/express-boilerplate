/**
 * Query seconds (phase 16 metering split): the wall-clock time the backend spent answering a tenant's reads, summed per tenant, signal and minute and
 * written as whole seconds. It wraps the backend the query routes use, so it measures the one thing that costs money (the store working) and nothing
 * the platform did around it, and no query service has to know about metering.
 */
import { querySecondsBuffer, registerUsageDrain } from '../observability.metering';
import type { TelemetryBackend } from './telemetry.backend';
import type { Signal } from './telemetry.types';

const READS: Record<string, Signal | 'arg'> = {
  queryLogs: 'logs', searchTraces: 'traces', getTrace: 'traces', queryMetrics: 'metrics', listMetricNames: 'metrics', queryRaw: 'arg',
};

const cache = new WeakMap<TelemetryBackend, TelemetryBackend>();

export function withQueryTiming(backend: TelemetryBackend): TelemetryBackend {
  const hit = cache.get(backend);
  if (hit) return hit;
  const proxy = new Proxy(backend, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      const kind = typeof prop === 'string' ? READS[prop] : undefined;
      if (!kind || typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        const started = Date.now();
        try {
          return await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        } finally {
          const tenantId = args[0];
          const signal = kind === 'arg' ? String(args[1] ?? 'raw') : kind;
          if (typeof tenantId === 'string') {
            querySecondsBuffer.add(tenantId, Math.max(1, Date.now() - started), { signal });
            void registerUsageDrain();
          }
        }
      };
    },
  });
  cache.set(backend, proxy);
  return proxy;
}
