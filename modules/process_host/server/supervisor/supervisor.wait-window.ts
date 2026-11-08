/**
 * A rolling window of wait times and its p95, for the kinds whose signal is "how long work waits before it starts"
 * (07 task 7: the script host's `FairGate` scheduling wait, the plugin host's wait for a free sandbox). Pure, no imports,
 * so a credential-less process can load it.
 *
 * Every piece of work records its wait (0 when it started at once), so an idle child reports 0 and a child whose work
 * queues reports the p95 of the waits in the last `windowMs`. No sample in the window is also 0 (nothing waited).
 */
export class WaitWindow {
  private readonly at: number[] = [];
  private readonly ms: number[] = [];

  constructor(
    private readonly windowMs = 10_000,
    private readonly maxSamples = 4_096,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Records one wait in milliseconds (negative or non-finite values are ignored). */
  record(waitMs: number): void {
    if (!Number.isFinite(waitMs) || waitMs < 0) return;
    this.at.push(this.now());
    this.ms.push(waitMs);
    if (this.at.length > this.maxSamples) {
      this.at.shift();
      this.ms.shift();
    }
  }

  /** Samples in the window right now. */
  get size(): number {
    this.trim();
    return this.ms.length;
  }

  /** Nearest-rank p95 of the waits in the window, in ms; 0 without a sample. */
  p95(): number {
    return this.percentile(95);
  }

  percentile(p: number): number {
    this.trim();
    if (this.ms.length === 0) return 0;
    const sorted = [...this.ms].sort((a, b) => a - b);
    const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
    return sorted[rank - 1];
  }

  private trim(): void {
    const from = this.now() - this.windowMs;
    let drop = 0;
    while (drop < this.at.length && this.at[drop] < from) drop += 1;
    if (drop > 0) {
      this.at.splice(0, drop);
      this.ms.splice(0, drop);
    }
  }
}
