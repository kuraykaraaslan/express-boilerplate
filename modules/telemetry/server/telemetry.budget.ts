import { DEFAULT_BUDGET_ROWS_PER_SECOND, type TelemetryEntityKind } from './telemetry.kinds';

/**
 * The per-kind write budget (docs/phases/42-telemetry/00 §0.8b, ED-12): an in-process token bucket per tenant and kind, checked
 * ONCE PER WAVE, so a bug in a small kind's writer cannot load the shared tables. A kind with `budgetRowsPerSecond: null`
 * (`iot_device`) returns before any work: its waves are the hot path this budget protects.
 *
 * Capacity is ten seconds of the rate (a burst after a quiet spell is fine); a wave larger than the whole capacity is refused
 * as a whole rather than split, so a caller sees the refusal at once.
 */
export const BUDGET_BURST_SECONDS = 10;

interface Bucket {
  tokens: number;
  at: number;
}

export class WriteBudget {
  private readonly buckets = new Map<string, Bucket>();

  /** True when the wave may go on; false (and nothing consumed) when it would exceed the kind's budget for the tenant. */
  admit(k: TelemetryEntityKind, tenantId: string, rows: number, now: number): boolean {
    const rate = k.budgetRowsPerSecond === undefined ? DEFAULT_BUDGET_ROWS_PER_SECOND : k.budgetRowsPerSecond;
    if (rate === null) return true;
    if (!(rate > 0)) return false;
    const capacity = rate * BUDGET_BURST_SECONDS;
    const key = `${tenantId}\u0000${k.kind}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: capacity, at: now };
      this.buckets.set(key, b);
      if (this.buckets.size > 50_000) this.buckets.delete(this.buckets.keys().next().value as string);
    } else if (now > b.at) {
      b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * rate);
      b.at = now;
    }
    if (rows > b.tokens) return false;
    b.tokens -= rows;
    return true;
  }
}
