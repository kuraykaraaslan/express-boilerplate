import type { TelemetryWriter } from './telemetry.contract';
import { TelemetryCoalescer, type TelemetryCoalescerOptions } from './telemetry.coalesce';

/**
 * A projection of counters onto the store (docs/phases/42-telemetry/00 §0.3, 06): a module that counts things one increment at a time
 * (a metering ledger row, a usage counter) never writes one row per increment. It folds every increment of one entity and key inside a
 * window (one minute by default) into ONE value — summed, the highest or the latest — and writes one row per window, entity and key
 * with the window's END as `ts`, through the coalescer (one writer call per tenant per flush). A window still open at flush time is
 * written as it stands; a later increment of the same window adds another row for the same `ts` (a different message hash), so a
 * series summed over the window still equals the counter: the store carries deltas, the ledger stays the truth.
 */
export type ProjectionReducer = 'sum' | 'max' | 'last';

export interface MinuteProjectionOptions extends Omit<TelemetryCoalescerOptions, 'writer'> {
  kind: string;
  writer: () => TelemetryWriter;
  /** The window every increment is folded into; default one minute. */
  windowMs?: number;
}

export const PROJECTION_WINDOW_MS = 60_000;

interface Fold { tenantId: string; entityId: string; ts: number; values: Record<string, number>; lastAt: Record<string, number> }

export class MinuteProjection {
  private readonly c: TelemetryCoalescer;
  private readonly folds = new Map<string, Fold>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly windowMs: number;

  constructor(private readonly o: MinuteProjectionOptions) {
    this.c = new TelemetryCoalescer({ writer: o.writer, flushMs: o.flushMs, maxRows: o.maxRows, warn: o.warn });
    this.windowMs = o.windowMs ?? PROJECTION_WINDOW_MS;
  }

  /** The end of the window `at` falls in. */
  windowEnd(at: number): number {
    return Math.floor(at / this.windowMs) * this.windowMs + this.windowMs;
  }

  add(tenantId: string, entityId: string, key: string, value: number, at: number, reducer: ProjectionReducer = 'sum'): void {
    if (!Number.isFinite(value)) return;
    const ts = this.windowEnd(at);
    const k = `${tenantId}|${entityId}|${ts}`;
    const f = this.folds.get(k) ?? this.folds.set(k, { tenantId, entityId, ts, values: {}, lastAt: {} }).get(k)!;
    const have = f.values[key];
    if (have === undefined) f.values[key] = value;
    else if (reducer === 'sum') f.values[key] = have + value;
    else if (reducer === 'max') f.values[key] = Math.max(have, value);
    else if (at >= (f.lastAt[key] ?? -Infinity)) f.values[key] = value;
    if (reducer === 'last') f.lastAt[key] = Math.max(f.lastAt[key] ?? -Infinity, at);
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.o.flushMs ?? 1_000);
      this.timer.unref?.();
    }
  }

  /** Windows folded and not yet handed to the store. */
  get pending(): number {
    return this.folds.size;
  }

  /** Hands every fold to the store (one row per window and entity, one writer call per tenant). Returns the rows the store took. */
  async flush(): Promise<number> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const folds = [...this.folds.values()];
    this.folds.clear();
    for (const f of folds) this.c.add(f.tenantId, this.o.kind, { entityId: f.entityId, ts: f.ts, values: f.values });
    return this.c.flush();
  }
}
