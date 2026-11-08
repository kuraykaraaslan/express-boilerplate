/**
 * Which `TelemetryBackend` this process uses. `telemetry` by default (docs/phases/42-telemetry/04 §4.2, ED-2): metrics on the Core
 * telemetry store's `otel` lane, no Prometheus to run; logs and traces answer 501 until a Loki or Tempo is configured. `off` keeps the
 * old behaviour (the ingest and query routes answer 503 and nothing is stored). `reference` takes the external stores from the URLs and
 * falls back to the Core store for metrics when no Prometheus URL is set.
 *
 * The `TELEMETRY_*` variables are declared, typed and validated in `modules/env` (`env.schema.platform.ts`); `telemetry.env.ts` hands them to
 * the readers below as a string record. `.env.example` documents them.
 *
 *   TELEMETRY_BACKEND              telemetry (default: metrics on the Core store) | off | memory | reference
 *   TELEMETRY_LOKI_URL             logs   (reference)  e.g. http://loki:3100
 *   TELEMETRY_TEMPO_URL            traces (reference)  query-frontend, e.g. http://tempo:3200
 *   TELEMETRY_TEMPO_OTLP_URL       traces ingest       default: TELEMETRY_TEMPO_URL with port 4318
 *   TELEMETRY_PROMETHEUS_URL       metrics (reference) e.g. http://prometheus:9090
 *   TELEMETRY_PROMETHEUS_ADMIN_API true when Prometheus runs with --web.enable-admin-api (enables tenant series deletion)
 *   TELEMETRY_PROMETHEUS_TENANT_HEADER  send the tenant in this header too (Mimir: X-Scope-OrgID)
 *   TELEMETRY_BACKEND_TIMEOUT_MS   per backend request, default 10000
 *
 * `reference` needs at least one of the three URLs; logs or traces without a URL are simply not served (explicit 501 at the route);
 * metrics without a Prometheus URL go to the Core store.
 */
import type { TelemetryBackend } from './telemetry.backend';
import { telemetryEnv } from './telemetry.env';
import { CompositeBackend } from './adapters/composite.adapter';
import { LokiLogBackend } from './adapters/loki.adapter';
import { MemoryTelemetryBackend } from './adapters/memory.adapter';
import { PrometheusMetricsBackend } from './adapters/prometheus.adapter';
import { TelemetryMetricsBackend } from './adapters/telemetry.adapter';
import { TempoTraceBackend } from './adapters/tempo.adapter';

type EnvLike = Record<string, string | undefined>;

export function resolveBackendFromEnv(e: EnvLike): TelemetryBackend | null {
  const mode = (e.TELEMETRY_BACKEND ?? 'telemetry').trim().toLowerCase();
  if (mode === 'memory') return new MemoryTelemetryBackend();
  if (mode === 'telemetry') return new TelemetryMetricsBackend();
  if (mode !== 'reference') return null;
  const timeoutMs = Number(e.TELEMETRY_BACKEND_TIMEOUT_MS) > 0 ? Number(e.TELEMETRY_BACKEND_TIMEOUT_MS) : 10_000;
  const t = (baseUrl: string) => ({ baseUrl, timeoutMs });
  const parts = {
    ...(e.TELEMETRY_LOKI_URL ? { logs: new LokiLogBackend(t(e.TELEMETRY_LOKI_URL)) } : {}),
    ...(e.TELEMETRY_TEMPO_URL ? { traces: new TempoTraceBackend(t(e.TELEMETRY_TEMPO_URL), e.TELEMETRY_TEMPO_OTLP_URL ? { ingestUrl: e.TELEMETRY_TEMPO_OTLP_URL } : {}) } : {}),
    metrics: e.TELEMETRY_PROMETHEUS_URL
      ? new PrometheusMetricsBackend(t(e.TELEMETRY_PROMETHEUS_URL), {
          enableAdminApi: /^(1|true|yes)$/i.test(e.TELEMETRY_PROMETHEUS_ADMIN_API ?? ''),
          ...(e.TELEMETRY_PROMETHEUS_TENANT_HEADER ? { tenantHeader: e.TELEMETRY_PROMETHEUS_TENANT_HEADER } : {}),
        })
      : new TelemetryMetricsBackend(),
  };
  return new CompositeBackend(parts);
}

let override: TelemetryBackend | null | undefined;
let resolved: TelemetryBackend | null | undefined;

/** The configured backend, or `null` when telemetry storage is off. */
export function getTelemetryBackend(): TelemetryBackend | null {
  if (override !== undefined) return override;
  if (resolved === undefined) resolved = resolveBackendFromEnv(telemetryEnv());
  return resolved;
}

/** Tests and wiring: force a backend (`null` = off). Call with `undefined` to go back to the environment. */
export function setTelemetryBackend(backend: TelemetryBackend | null | undefined): void {
  override = backend;
  if (backend === undefined) resolved = undefined;
}
