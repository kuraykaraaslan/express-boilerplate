/** One signal per adapter: logs to Loki, traces to Tempo, metrics to Prometheus (the reference set), or any other mix. */
import type { TelemetryBackend } from '../telemetry.backend';
import { TelemetryUnsupportedError } from '../telemetry.backend';
import type {
  BackendCapabilities, DeleteResult, Exemplar, LogQuery, LogQueryResult, LogRecord, LogTailBatch, LogTailCursor, LogTailQuery, MetricPoint, MetricQuery, MetricSeries, RetentionPolicy, Signal, SpanRecord,
  TimeRange, TraceSearch, TraceSummary, WriteResult,
} from '../telemetry.types';
import type { TailOptions } from '../telemetry.tail';
import { SIGNALS } from '../telemetry.types';

export interface CompositeParts {
  logs?: TelemetryBackend;
  traces?: TelemetryBackend;
  metrics?: TelemetryBackend;
}

export class CompositeBackend implements TelemetryBackend {
  readonly id: string;
  readonly capabilities: BackendCapabilities;

  constructor(private readonly parts: CompositeParts) {
    this.id = `composite(${SIGNALS.map((s) => `${s}:${parts[s]?.id ?? '-'}`).join(',')})`;
    const owned = SIGNALS.filter((s) => parts[s]);
    const deletable = owned.filter((s) => parts[s]!.capabilities.deletableSignals.includes(s));
    this.capabilities = {
      signals: { logs: !!parts.logs, traces: !!parts.traces, metrics: !!parts.metrics },
      perTenantRetention: owned.length > 0 && owned.every((s) => parts[s]!.capabilities.perTenantRetention),
      deletion: deletable.length ? 'tenant' : 'none',
      deletableSignals: deletable,
      rawQuery: owned.some((s) => parts[s]!.capabilities.rawQuery),
      exemplars: parts.metrics?.capabilities.exemplars ?? false,
    };
  }

  private part(signal: Signal): TelemetryBackend {
    const p = this.parts[signal];
    if (!p) throw new TelemetryUnsupportedError(`${signal} (no backend configured)`, this.id);
    return p;
  }

  async writeLogs(t: string, r: LogRecord[]): Promise<WriteResult> { return this.part('logs').writeLogs(t, r); }
  async writeSpans(t: string, s: SpanRecord[]): Promise<WriteResult> { return this.part('traces').writeSpans(t, s); }
  async writeMetrics(t: string, p: MetricPoint[]): Promise<WriteResult> { return this.part('metrics').writeMetrics(t, p); }
  async queryLogs(t: string, q: LogQuery): Promise<LogQueryResult> { return this.part('logs').queryLogs(t, q); }
  async tailLogs(t: string, f: LogTailQuery, c: LogTailCursor | null, o?: TailOptions): Promise<LogTailBatch> { return this.part('logs').tailLogs(t, f, c, o); }
  async searchTraces(t: string, q: TraceSearch): Promise<TraceSummary[]> { return this.part('traces').searchTraces(t, q); }
  async getTrace(t: string, id: string): Promise<SpanRecord[] | null> { return this.part('traces').getTrace(t, id); }
  async queryMetrics(t: string, q: MetricQuery): Promise<MetricSeries[]> { return this.part('metrics').queryMetrics(t, q); }
  async listMetricNames(t: string, r: TimeRange): Promise<string[]> { return this.part('metrics').listMetricNames(t, r); }
  async queryExemplars(t: string, q: MetricQuery): Promise<Exemplar[]> { return this.part('metrics').queryExemplars(t, q); }

  async queryRaw(t: string, signal: Signal, text: string, range: TimeRange, limit: number): Promise<unknown> {
    const p = this.part(signal);
    if (!p.queryRaw) throw new TelemetryUnsupportedError(`raw ${signal} query`, p.id);
    return p.queryRaw(t, signal, text, range, limit);
  }

  /** Applies to every configured signal; refuses up front (nothing is changed) when one of them cannot take a per-tenant policy. */
  async setRetention(t: string, policy: RetentionPolicy): Promise<void> {
    const wanted = (Object.keys(policy.days) as Signal[]).filter((s) => policy.days[s] !== undefined);
    for (const s of wanted) {
      const p = this.part(s);
      if (!p.capabilities.perTenantRetention || !p.setRetention) throw new TelemetryUnsupportedError(`per-tenant retention for ${s}`, p.id);
    }
    for (const s of wanted) await this.part(s).setRetention!(t, { days: { [s]: policy.days[s] } });
  }

  /** All-or-nothing check first: a signal whose adapter cannot erase refuses the whole call before anything is deleted. */
  async deleteTenantData(t: string, signals?: Signal[]): Promise<DeleteResult> {
    const which = signals ?? SIGNALS.filter((sig) => this.parts[sig]);
    for (const s of which) {
      const p = this.part(s);
      if (!p.capabilities.deletableSignals.includes(s) || !p.deleteTenantData) throw new TelemetryUnsupportedError(`deleting ${s}`, p.id);
    }
    let state: DeleteResult['state'] = 'done';
    let removed = 0;
    let counted = false;
    for (const s of which) {
      const r = await this.part(s).deleteTenantData!(t, [s]);
      if (r.state === 'scheduled') state = 'scheduled';
      if (r.removed !== undefined) { removed += r.removed; counted = true; }
    }
    return { state, ...(counted ? { removed } : {}) };
  }

  /** Health of each configured signal's store, by signal (the aggregate `health()` joins them into one message). */
  async healthBySignal(): Promise<Partial<Record<Signal, { ok: boolean; detail?: string; id?: string }>>> {
    const checks = await Promise.all(SIGNALS.filter((s) => this.parts[s]).map(async (s) => [s, { id: this.parts[s]!.id, ...(await this.parts[s]!.health().catch((e: unknown) => ({ ok: false, detail: e instanceof Error ? e.message : 'unreachable' }))) }] as const));
    return Object.fromEntries(checks)
  }

  async health() {
    const checks = await Promise.all(SIGNALS.filter((s) => this.parts[s]).map(async (s) => [s, await this.parts[s]!.health()] as const));
    const bad = checks.filter(([, h]) => !h.ok);
    return { ok: bad.length === 0, ...(bad.length ? { detail: bad.map(([s, h]) => `${s}: ${h.detail ?? 'down'}`).join('; ') } : {}) };
  }
}
