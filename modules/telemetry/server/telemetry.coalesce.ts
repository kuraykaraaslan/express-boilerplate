import type { TelemetryWriteRow, TelemetryWriter } from './telemetry.contract';

/**
 * One writer call per flush interval per (tenant, kind) for every reading a module collected meanwhile (docs/phases/42-telemetry/00
 * ED-12): a heartbeat handler, a probe sweep or a metering projection that stores one reading at a time would make one transaction
 * and one WAL flush per reading; coalesced, the whole process makes one wave per second per tenant and kind. A refused row or a
 * failing store is reported through `warn`, never thrown to the caller: the caller's own record (a column, a ledger row) is the
 * fallback, and the store is the history.
 *
 * Bounded: when more than `maxRows` wait, the buffer flushes at once (memory), and a flush that is still running does not block new
 * rows (they start the next wave). The timer never keeps the process alive.
 */
export interface TelemetryCoalescerOptions {
  writer: () => TelemetryWriter;
  flushMs?: number;
  /** Flush immediately above this many waiting rows. */
  maxRows?: number;
  warn?: (text: string) => void;
}

export const COALESCE_FLUSH_MS = 1_000;
export const COALESCE_MAX_ROWS = 50_000;

export class TelemetryCoalescer {
  private readonly waves = new Map<string, { tenantId: string; kind: string; rows: TelemetryWriteRow[] }>();
  private size = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly o: TelemetryCoalescerOptions) {}

  add(tenantId: string, kind: string, row: TelemetryWriteRow): void {
    const k = `${tenantId}|${kind}`;
    const w = this.waves.get(k) ?? this.waves.set(k, { tenantId, kind, rows: [] }).get(k)!;
    w.rows.push(row);
    this.size += 1;
    if (this.size >= (this.o.maxRows ?? COALESCE_MAX_ROWS)) {
      void this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.o.flushMs ?? COALESCE_FLUSH_MS);
      this.timer.unref?.();
    }
  }

  /** Rows waiting for the next wave. */
  get pending(): number {
    return this.size;
  }

  /** Writes every waiting wave, one `write()` per (tenant, kind); a failure is reported, never thrown. Returns the rows the store took. */
  async flush(): Promise<number> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const waves = [...this.waves.values()];
    this.waves.clear();
    this.size = 0;
    let written = 0;
    for (const w of waves) {
      try {
        const r = await this.o.writer().write(w.tenantId, w.kind, w.rows);
        written += r.written;
        if (r.errors.length) {
          this.o.warn?.(`${w.kind}: ${r.errors.length} of ${w.rows.length} rows refused by the telemetry store (${[...new Set(r.errors.map((e) => e.reason))].join(', ')})`);
        }
      } catch (e) {
        this.o.warn?.(`${w.kind}: ${w.rows.length} rows not stored: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return written;
  }
}
