/**
 * Observability facade — single entry point that callers use without knowing
 * whether Sentry, Prometheus, or OTel is wired up. Every method is a no-op
 * when the relevant backend isn't initialised.
 *
 * The Logger AsyncLocalStorage context ([modules/logger]) is the source of
 * truth for the active tenantId/requestId — both `setTags()` and
 * `recordError()` enrich their payload from there. No user identifier is sent
 * to Sentry (docs/phases/02-fleet/01-data-classification).
 */
import Logger from '@kuraykaraaslan-labs/logger';
import { initSentry, getSentry } from './sentry.init';
import { initMetrics, getMetrics } from './metrics';
import { initOtel } from './otel.init';
import { setTracesSampleRateOverride } from './sentry.filters';
import { withSpan, type SpanHandle, type SpanOptions } from './tracing';
import { rollUpPluginExecution } from './observability.plugin-stats';
import {
  defineCounter, defineGauge, defineHistogram,
  type CounterHandle, type CustomMetricSpec, type GaugeHandle, type HistogramHandle,
} from './metrics.custom';
import { observeRequest } from './telemetry/telemetry.exemplars';
import type {
  HttpRequestSample,
  ObservabilityTags,
  PluginExecutionSample,
  RecordErrorOptions,
  TenantUsageSample,
} from './observability.types';

// Structural view of the lazily-imported Sentry scope — keeps `@sentry/nextjs`
// out of the compile-time dependency set (same contract as metrics.ts's types).
interface SentryScopeLike {
  setTag: (key: string, value: string) => void;
  setFingerprint: (fingerprint: string[]) => void;
  setLevel: (level: string) => void;
  setExtra: (key: string, value: unknown) => void;
}

export default class ObservabilityService {
  private static _initStarted = false;

  // ── Label-cardinality guard ────────────────────────────────────────────
  // Prometheus time-series count multiplies per distinct label value. An
  // unbounded `tenantId` label (thousands of tenants) explodes memory. We cap
  // the number of distinct tenant labels; overflow collapses to `other`.
  private static readonly _MAX_TENANT_LABELS = 2000;
  private static readonly _seenTenantLabels = new Set<string>();

  /** Bound the tenantId label to a safe cardinality. */
  static boundTenantLabel(tenantId: string | null | undefined): string {
    if (!tenantId) return 'none';
    const id = String(tenantId);
    if (ObservabilityService._seenTenantLabels.has(id)) return id;
    if (ObservabilityService._seenTenantLabels.size >= ObservabilityService._MAX_TENANT_LABELS) return 'other';
    ObservabilityService._seenTenantLabels.add(id);
    return id;
  }

  // ── PII redaction ──────────────────────────────────────────────────────
  // Sentry `extra` is forwarded to a third-party processor; scrub obvious PII /
  // secrets so they never leave the platform, even if a caller is careless.
  private static readonly _PII_KEY = /pass|secret|token|authorization|cookie|api[-_]?key|email|phone|ssn|card|cvv|iban|otp|seed|private[-_]?key/i;
  private static readonly _EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

  /** Redact PII/secret values from an `extra` bag before it reaches Sentry. */
  static redactExtra(extra: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(extra)) {
      if (ObservabilityService._PII_KEY.test(k)) { out[k] = '[redacted]'; continue; }
      out[k] = typeof v === 'string' ? v.replace(ObservabilityService._EMAIL_RE, '[email]') : v;
    }
    return out;
  }

  /**
   * Boot Sentry + Prometheus. Safe to call repeatedly — first call wins.
   * Called from `instrumentation.ts` (Next.js server boot) and from tests
   * that want to assert behaviour with backends enabled.
   */
  static async init(): Promise<void> {
    if (ObservabilityService._initStarted) return;
    ObservabilityService._initStarted = true;
    // The API error boundary (common, a leaf that cannot import this module) hands its 5xx outcomes here. Loaded on demand:
    // the boundary imports next/server, which the worker process (a caller of init) has no other reason to load.
    try {
      const { setUnhandledErrorSink } = await import('@kuraykaraaslan-labs/common/server/route-error');
      setUnhandledErrorSink((err) => ObservabilityService.recordError(err));
    } catch (err) {
      Logger.warn(`[observability] unhandled-error sink not registered: ${err instanceof Error ? err.message : String(err)}`);
    }
    await Promise.all([initSentry(), initMetrics(), initOtel()]);
    // Opt-in GenAI tracing of NB's own model calls (phase 20.6): installs nothing unless the deployment flag GENAI_TRACING=true is set.
    void import('./genai/genai.tracing').then((m) => m.installGenAiTracing()).catch(() => undefined);
  }

  /**
   * Tag the events Sentry captures for the rest of the open request with `tenantId` and `requestId` (R-class). A user id is
   * accepted by the type for the callers that still pass one and is ignored: nothing identifying a person goes to Sentry.
   *
   * The tags are written to the Logger context, not to a Sentry scope. A scope set here is forked away by the time an
   * error is captured, which made the earlier `withScope` version tag nothing; `beforeSendHook` (sentry.init.ts) reads
   * this context when the event is sent, so the tags follow the async chain that raised the error. No-op when Sentry is
   * off, and when no Logger context is open.
   */
  static setTags(tags: ObservabilityTags): void {
    if (!getSentry()) return;
    const values: { tenantId?: string; requestId?: string } = {};
    if (tags.tenantId) values.tenantId = String(tags.tenantId);
    if (tags.requestId) values.requestId = String(tags.requestId);
    if (values.tenantId || values.requestId) Logger.annotateContext(values);
  }

  /**
   * Record an HTTP request observation. Bumps the request counter and the
   * latency histogram. No-op when metrics aren't initialised.
   */
  static recordHttpRequest(sample: HttpRequestSample): void {
    const m = getMetrics();
    if (!m) return;
    // `route` and `metric` values must stay low-cardinality (typed HttpRequestSample
    // enforces this today). If a non-trusted caller is ever introduced, bound these
    // to a known set before passing to Prometheus to prevent label-cardinality blowup.
    const labels = {
      method: sample.method,
      route: sample.route,
      status: String(sample.status),
    };
    m.httpRequests.inc({ ...labels, tenantId: ObservabilityService.boundTenantLabel(sample.tenantId) });
    // The histogram multiplies every series by its 11 buckets, so it carries no tenant label.
    observeRequest(m.httpDuration, labels, sample.latencyMs / 1000);
  }

  /**
   * Capture an error to Sentry and bump the error counter. Tenant + user
   * context is pulled from Logger ALS unless overridden in `opts`.
   */
  static recordError(err: Error, opts: RecordErrorOptions = {}): void {
    const sentry = getSentry();
    if (sentry) {
      sentry.withScope((scope: SentryScopeLike) => {
        const ctx = Logger.getContext();
        const tenantId = opts.tenantId ?? ctx.tenantId;
        if (tenantId) scope.setTag('tenantId', String(tenantId));
        if (ctx.requestId) scope.setTag('requestId', String(ctx.requestId));
        if (opts.fingerprint) scope.setFingerprint(opts.fingerprint);
        if (opts.level) scope.setLevel(opts.level);
        // Defense-in-depth: PII/secret keys and emails are redacted before send.
        if (opts.extra) Object.entries(ObservabilityService.redactExtra(opts.extra)).forEach(([k, v]) => scope.setExtra(k, v));
        sentry.captureException(err);
      });
    }
    const m = getMetrics();
    if (m) {
      const tenantId = opts.tenantId ?? Logger.getContext().tenantId;
      m.errors.inc({ tenantId: ObservabilityService.boundTenantLabel(tenantId as string | undefined), errorClass: err.constructor.name });
    }
  }

  /**
   * Record per-tenant usage on the Prometheus counter. Persistence still
   * lives in `TenantUsageService` — this is for real-time observability
   * dashboards (Grafana) not billing reconciliation.
   */
  static recordTenantUsage(sample: TenantUsageSample): void {
    const m = getMetrics();
    if (!m) return;
    m.tenantUsage.inc({ tenantId: ObservabilityService.boundTenantLabel(sample.tenantId), metric: sample.metric }, sample.value);
  }

  /** Count a rate-limit rejection for Grafana/alerting. Best-effort. */
  static recordRateLimitHit(scope: string, tenantId?: string | null): void {
    const m = getMetrics();
    if (!m) return;
    m.rateLimitHits.inc({ scope, tenantId: ObservabilityService.boundTenantLabel(tenantId) });
  }

  /**
   * Record one sandboxed-plugin execution (marketplace §6D): latency + outcome
   * go to Prometheus; an error/timeout also ships to Sentry, fingerprinted per
   * plugin so one broken plugin groups as ONE issue instead of flooding.
   * The platform's own observability is the plugin APM — the marketplace never
   * grows a telemetry store (locked alignment, phase-6 table).
   */
  static recordPluginExecution(sample: PluginExecutionSample): void {
    // The in-product read model (a publisher's own reliability panel): a daily
    // roll-up, independent of whether Prometheus/Sentry are configured.
    rollUpPluginExecution(sample);
    const m = getMetrics();
    if (m) {
      const labels = {
        tenantId: ObservabilityService.boundTenantLabel(sample.tenantId),
        pluginId: sample.pluginId,
        kind: sample.kind,
      };
      m.pluginExecutions.inc({ ...labels, outcome: sample.outcome });
      m.pluginDuration.observe(labels, sample.durationMs / 1000);
    }
    if (sample.outcome !== 'ok') {
      ObservabilityService.recordError(sample.error ?? new Error(`plugin ${sample.outcome}`), {
        tenantId: sample.tenantId,
        fingerprint: ['plugin', sample.pluginId, sample.outcome],
        level: 'error',
        extra: {
          pluginId: sample.pluginId,
          pluginVersionId: sample.pluginVersionId,
          kind: sample.kind,
          target: sample.target,
          durationMs: sample.durationMs,
        },
      });
    }
  }

  /** Change the base trace sampling rate at runtime for THIS process (`null` restores the env value). Per-tenant rates and untraced routes still win. */
  static setTracesSampleRate(rate: number | null): void {
    setTracesSampleRateOverride(rate);
  }

  // ── Manual spans ───────────────────────────────────────────────────────
  /** Run `fn` inside a span (Sentry, else OTel, else a plain call). Return value and errors pass through; async functions are awaited by the span. */
  static withSpan<T>(name: string, fn: (span: SpanHandle) => T, opts?: SpanOptions): T {
    return withSpan(name, fn, opts);
  }

  // ── Custom business metrics ────────────────────────────────────────────
  // Define once (module scope is fine), use anywhere. Handles no-op until/unless METRICS_ENABLED; see metrics.custom.ts for the guards.

  /** Define (or fetch) a custom counter in the shared registry. A `tenantId` label is cardinality-bounded automatically. */
  static counter(spec: CustomMetricSpec): CounterHandle {
    return defineCounter(spec, ObservabilityService.boundTenantLabel);
  }

  static gauge(spec: CustomMetricSpec): GaugeHandle {
    return defineGauge(spec, ObservabilityService.boundTenantLabel);
  }

  static histogram(spec: CustomMetricSpec): HistogramHandle {
    return defineHistogram(spec, ObservabilityService.boundTenantLabel);
  }

  /**
   * Return the Prometheus registry for the scrape endpoint. `null` when
   * METRICS_ENABLED is off.
   */
  static getMetricsRegistry() {
    return getMetrics()?.registry ?? null;
  }

  /**
   * Flush in-flight Sentry events. Useful at process shutdown.
   */
  static async flush(timeoutMs = 2000): Promise<void> {
    const sentry = getSentry();
    if (!sentry) return;
    try {
      await sentry.flush(timeoutMs);
    } catch {
      // best effort — don't crash shutdown on Sentry's own failure
    }
  }
}
