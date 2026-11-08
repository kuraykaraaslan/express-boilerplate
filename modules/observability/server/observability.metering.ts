/**
 * Observability usage as metered events (docs/phases/09-observability/16, task 16.3). Best-effort and optional: the store is whatever module
 * contributes to `common:usage_meter` (`metering`), a missing or failing one is never a reason to drop a probe, an alert or a telemetry batch,
 * and a usage event is recorded AFTER the work it describes.
 *
 * Volume is the design constraint: a probe per minute per monitor must not become a database write per probe. Callers pass AGGREGATES
 * (the probes one sweep ran for one tenant, the bytes of one ingest request) with a deterministic idempotency key, so a retry cannot count twice.
 */
export const OBSERVABILITY_METERS = {
  /** One unit per raw check written (`monitor_checks` row), by `checkType` and `location` in the event metadata. */
  PROBE_RUNS: { key: 'observability_probe_runs', name: 'Uptime probe runs', unit: 'runs' },
  /** One unit per NEW alert row, by `source` in the event metadata (a re-fire of an open alert is not a new alert). */
  ALERTS_INGESTED: { key: 'observability_alerts_ingested', name: 'Alerts ingested', unit: 'alerts' },
  /** Request-body bytes accepted by the telemetry ingest, by `signal`. */
  TELEMETRY_BYTES: { key: 'observability_telemetry_bytes', name: 'Telemetry ingested', unit: 'bytes' },
  /** SMS and voice pages accepted by a paging channel (`on_call:usage`), by `channel`. One event per delivery, keyed by the delivery. */
  SMS_PAGES: { key: 'observability_sms_pages', name: 'SMS pages', unit: 'messages' },
  VOICE_PAGES: { key: 'observability_voice_pages', name: 'Voice pages', unit: 'calls' },
  /** Wall-clock seconds spent answering telemetry queries (rounded up per window), by `signal`. */
  QUERY_SECONDS: { key: 'observability_query_seconds', name: 'Telemetry query time', unit: 'seconds' },
} as const

export type ObservabilityMeter = (typeof OBSERVABILITY_METERS)[keyof typeof OBSERVABILITY_METERS]

/** What an event says about itself beyond the quantity (the split): small, scalar, bounded. */
export type MeterDims = Record<string, string>

type Recorder = (tenantId: string, meter: ObservabilityMeter, quantity: number, idempotencyKey?: string, metadata?: MeterDims) => Promise<void>

const defaultRecorder: Recorder = async (tenantId, meter, quantity, idempotencyKey, metadata) => {
  // `metering` is an Enterprise module and this one is Core, so the store is reached through the `common:usage_meter` point it contributes to;
  // with no active contributor for the tenant there is nothing to record into.
  const { loadUsageMeterSink } = await import('@kuraykaraaslan-labs/common/server/common.usage-meter')
  const sink = await loadUsageMeterSink(tenantId)
  if (!sink) return
  // Priced at 0 (the sink creates it so): these meters make usage visible and limitable; what a plan charges for it is the operator's decision on the meter.
  await sink.ensureMeter(tenantId, { key: meter.key, name: meter.name, unit: meter.unit })
  await sink.record(tenantId, { meterKey: meter.key, quantity, idempotencyKey, metadata })
}

let recorder: Recorder = defaultRecorder

/** Test seam. */
export function setUsageRecorder(fn?: Recorder): void { recorder = fn ?? defaultRecorder }

const clampDim = (v: string) => v.slice(0, 64)
const cleanDims = (dims?: MeterDims): MeterDims | undefined => {
  if (!dims) return undefined
  const out: MeterDims = {}
  for (const k of Object.keys(dims).sort().slice(0, 4)) out[k.slice(0, 24)] = clampDim(dims[k])
  return out
}

/** Record `quantity` of a meter for a tenant. Never throws, never blocks the caller for long: failures are logged at debug level. */
export async function meterUsage(tenantId: string, meter: ObservabilityMeter, quantity: number, idempotencyKey?: string, dims?: MeterDims): Promise<void> {
  if (!(quantity > 0)) return
  try { await recorder(tenantId, meter, quantity, idempotencyKey, cleanDims(dims)) } catch (err) {
    // Logger is loaded here, not at the top: this module is imported by the telemetry limits, which pure unit tests load without the env.
    const { default: Logger } = await import('@kuraykaraaslan-labs/logger').catch(() => ({ default: null }))
    Logger?.debug?.(`[observability.metering] ${meter.key} not recorded for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * In-process aggregation for high-rate meters (probe runs, alerts, telemetry bytes, query time): `add` is a map update; a flush writes ONE event per
 * (tenant, dimensions, window) with a deterministic key, so a retried flush cannot count twice, and stamps the event with the START of its window, so a
 * count taken at 23:59:40 belongs to that day even when it is flushed at 00:00:05 (the daily reconciliation reads events by day).
 *
 * Only COMPLETED windows are flushed on the timer (a window that is still filling would be written twice under the same key, and the second write would
 * be dropped as a duplicate: an undercount); `flush({ all: true })` writes everything, for a shutdown or a test. A crash loses at most the windows not yet
 * flushed (the daily quota counters that enforce limits live in Redis, not here), and the daily reconciliation reports that kind of gap.
 */
export class UsageBuffer {
  private readonly pending = new Map<string, { tenantId: string; dims: MeterDims | undefined; window: number; qty: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly meter: ObservabilityMeter,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    /** Turns the summed quantity into what is written (query time is summed in ms and written in whole seconds). */
    private readonly finalise: (qty: number) => number = (q) => q,
  ) {}

  add(tenantId: string, quantity: number, dims?: MeterDims): void {
    if (!(quantity > 0)) return;
    const d = cleanDims(dims);
    const window = Math.floor(this.now() / this.windowMs);
    const key = `${tenantId}|${window}|${d ? JSON.stringify(d) : ''}`;
    const hit = this.pending.get(key);
    if (hit) hit.qty += quantity; else this.pending.set(key, { tenantId, dims: d, window, qty: quantity });
    if (!this.timer) {
      this.timer = setInterval(() => { void this.flush(); }, this.windowMs);
      this.timer.unref?.();
    }
  }

  /** Windows that are over (and everything, with `all`). Returns how many events were handed to the recorder. */
  async flush(opts: { all?: boolean; now?: number } = {}): Promise<number> {
    const current = Math.floor((opts.now ?? this.now()) / this.windowMs);
    const batch = [...this.pending].filter(([, v]) => opts.all || v.window < current);
    for (const [k] of batch) this.pending.delete(k);
    await Promise.all(batch.map(([, v]) => meterUsage(v.tenantId, this.meter, this.finalise(v.qty), `${this.meter.key}:${v.tenantId}:${v.window}${v.dims ? `:${Object.values(v.dims).join('.')}` : ''}`, v.dims)));
    return batch.length;
  }

  /** What has not been written yet (for tests and the shutdown path). */
  size(): number { return this.pending.size; }
}

/**
 * The process-wide buffers, one per high-rate meter. A window is a minute; nothing is written per probe, per alert or per request.
 * `flushAllUsage` (also run on a graceful shutdown) writes what is still pending, so a deploy does not lose the last minute.
 */
const WINDOW_MS = 60_000
export const probeRunBuffer = new UsageBuffer(OBSERVABILITY_METERS.PROBE_RUNS, WINDOW_MS)
export const alertBuffer = new UsageBuffer(OBSERVABILITY_METERS.ALERTS_INGESTED, WINDOW_MS)
export const telemetryBytesBuffer = new UsageBuffer(OBSERVABILITY_METERS.TELEMETRY_BYTES, WINDOW_MS)
/** Summed in milliseconds, written in whole seconds (at least one for a window that did any work). */
export const querySecondsBuffer = new UsageBuffer(OBSERVABILITY_METERS.QUERY_SECONDS, WINDOW_MS, Date.now, (ms) => Math.max(1, Math.ceil(ms / 1000)))
const ALL_BUFFERS = [probeRunBuffer, alertBuffer, telemetryBytesBuffer, querySecondsBuffer]

export async function flushAllUsage(opts: { all?: boolean; now?: number } = {}): Promise<number> {
  const counts = await Promise.all(ALL_BUFFERS.map((b) => b.flush(opts)))
  return counts.reduce((a, b) => a + b, 0)
}

let drainRegistered = false
/** Registered lazily by the first `add` site that runs in a process with a drain contract; harmless where there is none. */
export async function registerUsageDrain(): Promise<void> {
  if (drainRegistered) return
  drainRegistered = true
  try {
    const { registerDrainHook } = await import('@kuraykaraaslan-labs/common/server/process-hooks')
    registerDrainHook('observability-usage-flush', async () => { await flushAllUsage({ all: true }) })
  } catch { /* no process host here (a test, a serverless function): the windows are flushed by the timer */ }
}
