/**
 * Restart back-off and the crash-loop freeze (07 "When to scale", last bullet), pure: the clock is passed in.
 *
 *  - a child that exits unexpectedly is restarted after 1 s, 2 s, 4 s … capped at 60 s (per slot; the level resets once
 *    the slot's child has run for `stableMs`);
 *  - three crashes of the kind within 5 min freeze scale-up and raise `process_crash_loop`;
 *  - the freeze clears after 15 min without a crash.
 */

export const BACKOFF_MAX_MS = 60_000;
export const CRASH_WINDOW_MS = 5 * 60_000;
export const CRASH_LIMIT = 3;
export const FREEZE_QUIET_MS = 15 * 60_000;
export const STABLE_MS = 60_000;

/** `attempt` is 1 for the first restart. */
export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, 1_000 * 2 ** Math.max(0, attempt - 1));
}

export interface CrashLoopOptions {
  windowMs?: number;
  limit?: number;
  quietMs?: number;
}

export class CrashLoop {
  private crashes: number[] = [];
  private lastCrashAt: number | null = null;
  frozenSince: number | null = null;
  private readonly windowMs: number;
  private readonly limit: number;
  private readonly quietMs: number;

  constructor(o: CrashLoopOptions = {}) {
    this.windowMs = o.windowMs ?? CRASH_WINDOW_MS;
    this.limit = o.limit ?? CRASH_LIMIT;
    this.quietMs = o.quietMs ?? FREEZE_QUIET_MS;
  }

  /** Records a crash; returns true when this crash froze the kind. */
  crash(now: number): boolean {
    this.lastCrashAt = now;
    this.crashes = this.crashes.filter((t) => now - t < this.windowMs);
    this.crashes.push(now);
    if (this.frozenSince === null && this.crashes.length >= this.limit) {
      this.frozenSince = now;
      return true;
    }
    return false;
  }

  /** Returns true when the freeze cleared at this check. */
  check(now: number): boolean {
    if (this.frozenSince !== null && this.lastCrashAt !== null && now - this.lastCrashAt >= this.quietMs) {
      this.frozenSince = null;
      this.crashes = [];
      return true;
    }
    return false;
  }

  get frozen(): boolean {
    return this.frozenSince !== null;
  }

  /** Crashes inside the window. */
  recent(now: number): number {
    return this.crashes.filter((t) => now - t < this.windowMs).length;
  }

  clearsAt(): number | null {
    return this.frozenSince === null || this.lastCrashAt === null ? null : this.lastCrashAt + this.quietMs;
  }
}
