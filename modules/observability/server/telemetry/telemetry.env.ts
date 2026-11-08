/**
 * The telemetry settings as the string record the readers (`resolveBackendFromEnv`, `logExportConfigFromEnv`, `exemplarsOptedIn`) take.
 * The values come from the validated schema of `modules/env` (names, types, defaults and the secret classification live there), never from
 * `process.env` directly: a bad value fails at boot with the schema's message instead of silently turning telemetry off.
 */
import { env } from '@kuraykaraaslan-labs/env';

const flag = (v: boolean | undefined): string | undefined => (v === undefined ? undefined : String(v));
const num = (v: number | undefined): string | undefined => (v === undefined ? undefined : String(v));

export function telemetryEnv(): Record<string, string | undefined> {
  return {
    TELEMETRY_BACKEND: env.TELEMETRY_BACKEND,
    TELEMETRY_LOKI_URL: env.TELEMETRY_LOKI_URL,
    TELEMETRY_TEMPO_URL: env.TELEMETRY_TEMPO_URL,
    TELEMETRY_TEMPO_OTLP_URL: env.TELEMETRY_TEMPO_OTLP_URL,
    TELEMETRY_PROMETHEUS_URL: env.TELEMETRY_PROMETHEUS_URL,
    TELEMETRY_PROMETHEUS_ADMIN_API: flag(env.TELEMETRY_PROMETHEUS_ADMIN_API),
    TELEMETRY_PROMETHEUS_TENANT_HEADER: env.TELEMETRY_PROMETHEUS_TENANT_HEADER,
    TELEMETRY_BACKEND_TIMEOUT_MS: num(env.TELEMETRY_BACKEND_TIMEOUT_MS),
    TELEMETRY_LOG_EXPORT: flag(env.TELEMETRY_LOG_EXPORT),
    TELEMETRY_LOG_EXPORT_URL: env.TELEMETRY_LOG_EXPORT_URL,
    TELEMETRY_LOG_EXPORT_KEY: env.TELEMETRY_LOG_EXPORT_KEY,
    TELEMETRY_EXEMPLARS: flag(env.TELEMETRY_EXEMPLARS),
    OTEL_SERVICE_NAME: env.OTEL_SERVICE_NAME,
  };
}
