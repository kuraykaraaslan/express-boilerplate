/**
 * NB's own logs as OTLP logs (phase 17.3), opt-in. Every line `Logger` writes can also be sent to an OTLP endpoint (NB's own ingest, or
 * a collector) with the active span's `trace_id` / `span_id` and the tenant and request ids as RESOURCE attributes.
 *
 *   TELEMETRY_LOG_EXPORT=true            switch on (default off)
 *   TELEMETRY_LOG_EXPORT_URL             OTLP/HTTP logs endpoint, e.g. https://platform.example/api/telemetry/otlp/v1/logs
 *   TELEMETRY_LOG_EXPORT_KEY             a tenant ingest key (scope telemetry:write), sent as a Bearer token
 *   OTEL_SERVICE_NAME                    service.name (default next-boilerplate)
 *
 * Privacy: the user id is NEVER exported (the existing rule: user ids stay out of third-party telemetry). The body is the line the logger
 * itself composes, so its redaction rules apply, and it is scrubbed again on ingest. Lines of telemetry class `X` (restricted content) are not
 * exported. The tenant and request ids use the names `nb.subject.tenant` / `request.id`, NOT `tenant.id`: ingest overwrites every
 * tenant-like key with the tenant of the ingest key, which would erase which tenant a platform log line belongs to.
 *
 * How it attaches: `startLogExport` wraps the static `info`, `event`, `warn` and `error` of the `Logger` class (debug stays local). That works for
 * the module instance the boot task runs in; a bundle that loads its own copy of the logger is not covered. The durable fix is a sink hook in
 * the logger module (follow-up in docs/phases/09-observability/17).
 *
 * The exporter is bounded (a queue cap, oldest dropped and counted), batches, backs off after a failure, and never logs its own failures
 * (that would feed itself): see `stats()`.
 */
import { randomUUID } from 'node:crypto';
import Logger from '@kuraykaraaslan-labs/logger';
import { telemetryEnv } from './telemetry.env';
import { encodeLogsJson } from './otlp.codec';
import { activeTraceContext, traceIdFromRequestId, type TraceContext } from './telemetry.propagation';
import { msToNs } from './telemetry.util';
import type { LogRecord, SeverityText } from './telemetry.types';
import { scrubText } from '../sentry.scrub';

export interface LogExportConfig {
  endpoint: string;
  key?: string;
  serviceName: string;
  batchSize: number;
  flushIntervalMs: number;
  maxQueue: number;
  timeoutMs: number;
}

type SendFn = (body: string, headers: Record<string, string>) => Promise<void>;

export function logExportConfigFromEnv(env: Record<string, string | undefined> = telemetryEnv()): LogExportConfig | null {
  if (!/^(1|true|yes)$/i.test(env.TELEMETRY_LOG_EXPORT ?? '')) return null;
  const endpoint = env.TELEMETRY_LOG_EXPORT_URL;
  if (!endpoint || !/^https?:\/\//i.test(endpoint)) return null;
  return {
    endpoint, ...(env.TELEMETRY_LOG_EXPORT_KEY ? { key: env.TELEMETRY_LOG_EXPORT_KEY } : {}), serviceName: env.OTEL_SERVICE_NAME || 'next-boilerplate',
    batchSize: 200, flushIntervalMs: 2000, maxQueue: 2000, timeoutMs: 5000,
  };
}

export interface LineContext {
  tenantId?: string;
  requestId?: string;
  [k: string]: string | number | boolean | undefined;
}

const INSTANCE_ID = randomUUID();

/** One log line as an OTLP record. `userId` in the context is ignored by construction. */
export function buildLogRecord(level: SeverityText, text: string, ctx: LineContext, serviceName: string, active: TraceContext | null, nowMs: number = Date.now()): LogRecord {
  const resource: LogRecord['resource'] = { 'service.name': serviceName, 'service.instance.id': INSTANCE_ID };
  if (ctx.tenantId) resource['nb.subject.tenant'] = ctx.tenantId;
  if (ctx.requestId) resource['request.id'] = ctx.requestId;
  // A line inside a span carries that span; a line inside only a request carries the trace id derived from the request id.
  const traceId = active?.traceId ?? (ctx.requestId ? traceIdFromRequestId(ctx.requestId) : undefined);
  return {
    timeNs: msToNs(nowMs), severity: level, body: text, attributes: typeof ctx.nodeId === 'string' ? { 'nb.node.id': ctx.nodeId } : {}, resource,
    ...(traceId ? { traceId } : {}), ...(active ? { spanId: active.spanId } : {}),
  };
}

export class OtlpLogExporter {
  private queue: LogRecord[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private failures = 0;
  private pausedUntil = 0;
  private exported = 0;
  private dropped = 0;
  private failedBatches = 0;

  constructor(private readonly cfg: LogExportConfig, private readonly send: SendFn = defaultSend(cfg), private readonly now: () => number = Date.now) {}

  enqueue(record: LogRecord): void {
    this.queue.push(record);
    if (this.queue.length > this.cfg.maxQueue) { this.queue.splice(0, this.queue.length - this.cfg.maxQueue); this.dropped++; }
    if (this.queue.length >= this.cfg.batchSize) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing || !this.queue.length || this.now() < this.pausedUntil) return;
    this.flushing = true;
    const batch = this.queue.splice(0, this.cfg.batchSize);
    try {
      await this.send(JSON.stringify(encodeLogsJson(batch)), { 'Content-Type': 'application/json', ...(this.cfg.key ? { Authorization: `Bearer ${this.cfg.key}` } : {}) });
      this.exported += batch.length;
      this.failures = 0;
    } catch {
      // The batch is lost (logs are best-effort); back off exponentially up to a minute.
      this.failedBatches++;
      this.dropped += batch.length;
      this.failures++;
      this.pausedUntil = this.now() + Math.min(60_000, 1000 * 2 ** Math.min(this.failures, 6));
    } finally {
      this.flushing = false;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.flush(); }, this.cfg.flushIntervalMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.pausedUntil = 0;
    await this.flush();
  }

  stats(): { queued: number; exported: number; dropped: number; failedBatches: number } {
    return { queued: this.queue.length, exported: this.exported, dropped: this.dropped, failedBatches: this.failedBatches };
  }
}

function defaultSend(cfg: LogExportConfig): SendFn {
  return async (body, headers) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(cfg.endpoint, { method: 'POST', headers, body, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } finally {
      clearTimeout(t);
    }
  };
}

// ── attaching to the Logger ────────────────────────────────────────────────────

type LogFn = (message: string, ...args: unknown[]) => void;
const WRAPPED: Array<[keyof typeof LEVELS, SeverityText]> = [['info', 'INFO'], ['event', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR']];
const LEVELS = { info: 'INFO', event: 'INFO', warn: 'WARN', error: 'ERROR' } as const;

let attached: { exporter: OtlpLogExporter; originals: Map<string, LogFn> } | null = null;

/** The text the logger itself would write for the line: its own redaction applies (it is `private` in TypeScript, a plain static at runtime). */
function composeLine(message: string, args: unknown[]): string {
  const compose = (Logger as unknown as { compose?: (m: string, a: unknown[], redact: boolean) => string }).compose;
  try {
    return typeof compose === 'function' ? compose.call(Logger, message, args, true) : scrubText(String(message));
  } catch {
    return scrubText(String(message));
  }
}

/** Starts the exporter and wraps the Logger. Returns false (and does nothing) when export is not opted in or already running. */
export function startLogExport(cfg: LogExportConfig | null = logExportConfigFromEnv(), send?: SendFn): boolean {
  if (!cfg || attached) return false;
  const exporter = new OtlpLogExporter(cfg, send);
  const originals = new Map<string, LogFn>();
  const target = Logger as unknown as Record<string, LogFn>;
  for (const [name, level] of WRAPPED) {
    const original = target[name];
    if (typeof original !== 'function') continue;
    originals.set(name, original);
    target[name] = function wrapped(this: unknown, message: string, ...args: unknown[]) {
      original.call(Logger, message, ...args);
      try {
        const ctx = Logger.getContext() as LineContext & { class?: string };
        if (ctx.class === 'X') return;
        const text = composeLine(message, args);
        if (text.startsWith('[telemetry]')) return;
        exporter.enqueue(buildLogRecord(level, text, ctx, cfg.serviceName, activeTraceContext()));
      } catch {
        // exporting never changes logging
      }
    };
  }
  exporter.start();
  attached = { exporter, originals };
  return true;
}

export async function stopLogExport(): Promise<void> {
  if (!attached) return;
  const target = Logger as unknown as Record<string, LogFn>;
  for (const [name, fn] of attached.originals) target[name] = fn;
  const { exporter } = attached;
  attached = null;
  await exporter.stop();
}

export function logExportStats(): ReturnType<OtlpLogExporter['stats']> | null {
  return attached?.exporter.stats() ?? null;
}

/** `common:boot_task` entry (phase `scheduler`: the always-on `consumer` phase of this module is pinned to the extension-health observer by a test, so the export starts where background jobs run). */
export async function startTelemetryLogExport(): Promise<void> {
  startLogExport();
}
