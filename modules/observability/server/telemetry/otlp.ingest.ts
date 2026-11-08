/**
 * The OTLP ingest pipeline: bytes in, records in the store out. Framework-free; the route files only authenticate and call it.
 *
 *   decode (JSON or protobuf)  ->  stamp the tenant (overwrites any client value)  ->  scrub PII  ->  tail-sample (traces)  ->  write
 *
 * The tenant is an argument, derived by the caller from a verified key. Nothing in the payload can change it.
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import type { TelemetryBackend } from './telemetry.backend';
import { decodeLogs, decodeMetrics, decodeTraces, OtlpDecodeError, type DecodeLimits, type Decoded } from './otlp.codec';
import { decodeLogsProto, decodeMetricsProto, decodeTracesProto } from './otlp.protobuf';
import { sampleSpans, type TailSamplingPolicy, type TraceDecisionStore } from './telemetry.sampling';
import { scrubLog, scrubMetric, scrubSpan } from './telemetry.scrub';
import { stampLog, stampMetric, stampSpan } from './telemetry.tenant';
import { capLogStreams, capMetricSeries } from './telemetry.cardinality';
import { BROWSER_METRIC_PREFIX } from './telemetry.browser-keys';
import type { Signal } from './telemetry.types';

export type OtlpEncoding = 'json' | 'protobuf';

export interface IngestInput {
  signal: Signal;
  tenantId: string;
  body: Uint8Array;
  encoding: OtlpEncoding;
  decode: DecodeLimits;
  sampling: TailSamplingPolicy;
  /** The key is a PUBLIC browser key: only metrics named `browser_*` are kept (the rest are rejected, and counted). */
  browser?: boolean;
}

export interface IngestResult {
  accepted: number;
  /** Malformed or over-limit records, plus whatever the backend refused. */
  rejected: number;
  /** Spans removed by tail sampling (a policy outcome, not a rejection). */
  sampledOut: number;
  /** Cardinality caps (phase 16): metric data points dropped because their series would exceed a cap (these are also in `rejected`), and log records whose service name was folded into `_overflow`. */
  cardinality: { dropped: number; folded: number; reasons: Record<string, number> };
  warnings: string[];
}

function parse(signal: Signal, body: Uint8Array, encoding: OtlpEncoding): unknown {
  if (encoding === 'protobuf') {
    return signal === 'traces' ? decodeTracesProto(body) : signal === 'logs' ? decodeLogsProto(body) : decodeMetricsProto(body);
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } catch {
    throw new OtlpDecodeError('request body is not valid JSON');
  }
}

export async function ingestOtlp(backend: TelemetryBackend, store: TraceDecisionStore | undefined, input: IngestInput): Promise<IngestResult> {
  const { signal, tenantId } = input;
  if (!backend.capabilities.signals[signal]) {
    throw new AppError(`This deployment does not store ${signal}`, 501, ErrorCode.FEATURE_NOT_AVAILABLE);
  }
  let doc: unknown;
  try {
    doc = parse(signal, input.body, input.encoding);
  } catch (e) {
    if (e instanceof OtlpDecodeError) throw new AppError(e.message, 400, ErrorCode.VALIDATION_ERROR);
    throw e;
  }

  let decoded: Decoded<unknown>;
  let accepted = 0;
  let rejected = 0;
  let sampledOut = 0;
  const cardinality: IngestResult['cardinality'] = { dropped: 0, folded: 0, reasons: {} };
  try {
    if (signal === 'traces') {
      const d = decodeTraces(doc, input.decode);
      decoded = d;
      const scrubbed = d.items.map((s) => scrubSpan(stampSpan(s, tenantId)));
      const sample = sampleSpans(scrubbed, input.sampling, tenantId, store);
      sampledOut = sample.dropped;
      if (sample.kept.length) {
        const w = await backend.writeSpans(tenantId, sample.kept);
        accepted = w.accepted; rejected += w.rejected;
      }
    } else if (signal === 'logs') {
      const d = decodeLogs(doc, input.decode);
      decoded = d;
      const capped = await capLogStreams(tenantId, d.items);
      cardinality.folded = capped.folded;
      if (capped.folded) d.warnings.push(`${capped.folded} log records were grouped under service "_overflow": this workspace reached its daily stream limit`);
      if (capped.records.length) {
        const w = await backend.writeLogs(tenantId, capped.records.map((r) => scrubLog(stampLog(r, tenantId))));
        accepted = w.accepted; rejected += w.rejected;
      }
    } else {
      const d = decodeMetrics(doc, input.decode);
      if (input.browser) {
        const kept = d.items.filter((p) => p.name.startsWith(BROWSER_METRIC_PREFIX));
        if (kept.length !== d.items.length) {
          d.rejected += d.items.length - kept.length;
          d.warnings.push(`a browser key may only write metrics named ${BROWSER_METRIC_PREFIX}*`);
          d.items = kept;
        }
      }
      decoded = d;
      const capped = await capMetricSeries(tenantId, d.items);
      cardinality.dropped = capped.dropped; cardinality.reasons = capped.reasons;
      if (capped.dropped) d.warnings.push(`${capped.dropped} data points were dropped: a new series would exceed this workspace's series limit (${Object.keys(capped.reasons).join(', ')})`);
      if (capped.kept.length) {
        const w = await backend.writeMetrics(tenantId, capped.kept.map((p) => scrubMetric(stampMetric(p, tenantId))));
        accepted = w.accepted; rejected += w.rejected;
      }
    }
  } catch (e) {
    if (e instanceof OtlpDecodeError) throw new AppError(e.message, 400, ErrorCode.VALIDATION_ERROR);
    throw e;
  }
  return { accepted, rejected: rejected + decoded.rejected + cardinality.dropped, sampledOut, cardinality, warnings: decoded.warnings };
}
