/**
 * One live tail, independent of socket.io so it can be driven with a fake clock: `TailSession` owns the poll loop, the budgets, the
 * backpressure and the drop accounting of ONE socket. The namespace (`telemetry.tail.namespace.ts`) only connects a socket to it.
 *
 * The tenant is a constructor argument the namespace took from the verified ticket; nothing a client sends can change it, and the filter
 * a client sends is parsed with the REST API's own schema (`parseTailFilter`) before any backend call.
 *
 * Bounds (all in `TAIL_LIMITS`): one poll hands back at most `maxLinesPerPoll` lines (the poller keeps the NEWEST and counts the rest as
 * dropped), a session exports at most `maxLinesPerSession` lines and lives at most `maxSessionSeconds`, polling backs off and gives up after
 * consecutive backend failures, and while the socket cannot take more data (`isBusy`) a poll is skipped rather than buffered, so nothing
 * piles up in memory. Every loss is visible: each batch carries the running `dropped` total and `truncated` says that total is a lower bound.
 */
import { TelemetryBackendError, TelemetryUnsupportedError, type TelemetryBackend } from './telemetry.backend';
import { TAIL_EVENTS, TAIL_LIMITS, type TailEndReason, type TailErrorCode, type TailLimits } from './telemetry.tail.realtime';
import { parseTailFilter, pollLogTail } from './telemetry.tail';
import type { LogRecord, LogTailCursor, LogTailQuery } from './telemetry.types';

export interface TailSessionDeps {
  tenantId: string;
  backend: () => TelemetryBackend | null;
  emit: (event: string, payload: unknown) => void;
  /** True while the socket's outgoing buffer is not empty: the session then skips the poll. */
  isBusy: () => boolean;
  /** The session is over: close the tail (the namespace may also disconnect). */
  onEnd?: (reason: TailEndReason) => void;
  limits?: Partial<TailLimits>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface TailStats {
  delivered: number;
  dropped: number;
  truncated: boolean;
  polls: number;
  skippedPolls: number;
  failures: number;
}

export class TailSession {
  private readonly limits: TailLimits;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private filter: LogTailQuery | null = null;
  private cursor: LogTailCursor | null = null;
  private timer: unknown = null;
  private endTimer: unknown = null;
  private running = false;
  private inFlight = false;
  private consecutiveFailures = 0;
  private generation = 0;
  readonly stats: TailStats = { delivered: 0, dropped: 0, truncated: false, polls: 0, skippedPolls: 0, failures: 0 };

  constructor(private readonly deps: TailSessionDeps) {
    this.limits = { ...TAIL_LIMITS, ...(deps.limits ?? {}) };
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); (t as { unref?: () => void }).unref?.(); return t; });
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get active(): boolean { return this.running; }

  /** `tail:start`: validate, then begin (or restart with the new filter). A refused filter changes nothing about a tail already running. */
  start(rawFilter: unknown): void {
    const parsed = parseTailFilter(rawFilter);
    if (!parsed.ok) { this.error('invalid_filter', parsed.message); return; }
    const backend = this.deps.backend();
    if (!backend) { this.error('not_configured', 'Telemetry storage is not configured'); return; }
    if (!backend.capabilities.signals.logs) { this.error('unsupported', 'The configured backend does not store logs'); return; }

    this.halt();
    this.generation += 1;
    this.filter = parsed.filter;
    this.cursor = null;
    this.consecutiveFailures = 0;
    this.running = true;
    this.deps.emit(TAIL_EVENTS.STARTED, { pollSeconds: this.limits.pollSeconds, maxLinesPerPoll: this.limits.maxLinesPerPoll, maxLinesPerSession: this.limits.maxLinesPerSession });
    // The first poll establishes "now" (no backlog); lines start flowing from the next one.
    this.schedule(0);
    this.endTimer = this.setTimer(() => this.end('session_time'), this.limits.maxSessionSeconds * 1000);
  }

  /** `tail:stop`, a disconnect or the end of a session: nothing runs afterwards. Safe to call twice. */
  stop(): void {
    if (!this.running) return;
    this.end('stopped');
  }

  /** Tear down without telling the client (the socket is gone). */
  dispose(): void {
    this.halt();
  }

  /** End on the server's initiative (erasure, a budget) and say why. */
  end(reason: TailEndReason): void {
    if (!this.running) return;
    this.halt();
    this.deps.emit(TAIL_EVENTS.END, { reason, delivered: this.stats.delivered, dropped: this.stats.dropped });
    this.deps.onEnd?.(reason);
  }

  private halt(): void {
    this.running = false;
    if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
    if (this.endTimer !== null) { this.clearTimer(this.endTimer); this.endTimer = null; }
  }

  private error(code: TailErrorCode, message: string): void {
    this.deps.emit(TAIL_EVENTS.ERROR, { code, message });
  }

  private schedule(ms: number): void {
    if (!this.running) return;
    const gen = this.generation;
    this.timer = this.setTimer(() => { void this.tick(gen); }, ms);
  }

  private async tick(gen: number): Promise<void> {
    this.timer = null;
    if (!this.running || gen !== this.generation || this.inFlight) return;
    const interval = this.limits.pollSeconds * 1000;
    // Backpressure: a socket that has not drained its last batch gets no new one. Skipping is cheap and never buffers; the lines it misses
    // are still in the store and the next poll that runs reads the newest of them (the rest are counted as dropped).
    if (this.cursor && this.deps.isBusy()) {
      this.stats.skippedPolls += 1;
      this.schedule(interval);
      return;
    }
    const backend = this.deps.backend();
    if (!backend || !this.filter) { this.end('backend_unavailable'); return; }
    this.inFlight = true;
    try {
      const batch = await backend.tailLogs(this.deps.tenantId, this.filter, this.cursor, { maxBatch: this.limits.maxLinesPerPoll, now: this.now });
      this.stats.polls += 1;
      this.consecutiveFailures = 0;
      if (!this.running || gen !== this.generation) return; // stopped or restarted while the backend was answering: this batch is not for the current tail
      this.cursor = batch.cursor;
      this.stats.dropped += batch.dropped;
      this.stats.truncated = this.stats.truncated || batch.truncated;
      const room = this.limits.maxLinesPerSession - this.stats.delivered;
      const lines: LogRecord[] = batch.records.slice(0, Math.max(0, room));
      this.stats.dropped += batch.records.length - lines.length;
      if (lines.length > 0 || batch.dropped > 0) {
        this.stats.delivered += lines.length;
        this.deps.emit(TAIL_EVENTS.LINES, { lines, delivered: this.stats.delivered, dropped: this.stats.dropped, truncated: this.stats.truncated });
      }
      if (this.stats.delivered >= this.limits.maxLinesPerSession) { this.end('line_budget'); return; }
    } catch (e) {
      this.stats.failures += 1;
      this.consecutiveFailures += 1;
      if (e instanceof TelemetryUnsupportedError) { this.error('unsupported', 'The configured backend cannot tail logs'); this.end('backend_unavailable'); return; }
      if (this.running && gen === this.generation) {
        if (this.consecutiveFailures === 1 || !(e instanceof TelemetryBackendError)) this.error('backend_unavailable', 'The telemetry backend is unavailable');
        if (this.consecutiveFailures >= this.limits.maxConsecutiveFailures) { this.end('backend_unavailable'); return; }
        // exponential backoff, capped at 30 s
        this.schedule(Math.min(30_000, interval * 2 ** this.consecutiveFailures));
        return;
      }
    } finally {
      this.inFlight = false;
    }
    if (this.running && gen === this.generation) this.schedule(interval);
  }
}
