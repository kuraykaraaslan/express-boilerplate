import type { RetentionClass, TelemetryValue, TelemetryWriteResult } from './telemetry.contract';

/**
 * Commit listeners (docs/phases/42-telemetry/00 §0.8b, ED-11): a live publisher, a datapoint meter or a bridge hears what a wave
 * stored. They run AFTER the writer's promise resolved, from a bounded in-process queue, and are never awaited by the writer:
 * the 2026-10-24 verification found the earlier shape (awaited inside `write()`) would have put every listener's latency on
 * the device lane before its release and the entry's acknowledgement. A full queue drops the event and counts it; a listener
 * that throws is reported and never fails another.
 */
export interface TelemetryCommitted {
  tenantId: string;
  kind: string;
  lane: string;
  classDays: RetentionClass;
  /** The rows inserted (new messages), with the values as stored. */
  inserted: Array<{ entityId: string; ts: number; values: Readonly<Record<string, TelemetryValue>> }>;
  latestChanged: TelemetryWriteResult['latestChanged'];
  /** Numeric and other values in the inserted rows (the datapoints a meter counts). */
  datapoints: number;
}

export type TelemetryCommitListener = (e: TelemetryCommitted) => void | Promise<void>;

export const LISTENER_QUEUE_MAX = 1_000;
const DROP_WARN_EVERY_MS = 60_000;

const registered: TelemetryCommitListener[] = [];
const queue: Array<{ e: TelemetryCommitted; ls: readonly TelemetryCommitListener[]; warn?: (text: string) => void }> = [];
let draining: Promise<void> | null = null;
let dropped = 0;
let lastDropWarn: number | null = null;

/** Registers a listener of committed writes. Returns its removal. */
export function registerTelemetryCommitListener(l: TelemetryCommitListener): () => void {
  registered.push(l);
  return () => {
    const i = registered.indexOf(l);
    if (i >= 0) registered.splice(i, 1);
  };
}

export const telemetryCommitListeners = (): readonly TelemetryCommitListener[] => registered;

/** Queues `e` for the listeners; returns at once. Nothing is queued when there is nobody to hear it. */
export function dispatchCommitted(e: TelemetryCommitted, o: { listeners?: readonly TelemetryCommitListener[]; warn?: (text: string) => void; now?: () => number } = {}): void {
  const ls = o.listeners ?? registered;
  if (!ls.length) return;
  if (queue.length >= LISTENER_QUEUE_MAX) {
    dropped += 1;
    const now = (o.now ?? Date.now)();
    if (lastDropWarn === null || now - lastDropWarn > DROP_WARN_EVERY_MS) {
      lastDropWarn = now;
      o.warn?.(`telemetry commit listeners are behind: ${dropped} events dropped so far (queue ${LISTENER_QUEUE_MAX})`);
    }
    return;
  }
  queue.push({ e, ls, warn: o.warn });
  draining ??= drain();
}

async function drain(): Promise<void> {
  // the writer's caller resolves first (a macrotask later), then the listeners
  await new Promise<void>((r) => setImmediate(r));
  try {
    while (queue.length) {
      const { e, ls, warn } = queue.shift()!;
      for (const l of ls) {
        try {
          await l(e);
        } catch (err) {
          warn?.(`a telemetry commit listener failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  } finally {
    draining = null;
  }
}

/** Resolves when every queued event has been handed to its listeners (tests, shutdown). */
export const flushTelemetryListeners = (): Promise<void> => draining ?? Promise.resolve();

export const telemetryListenerStats = (): { queued: number; dropped: number; listeners: number } => ({ queued: queue.length, dropped, listeners: registered.length });

/** Tests: forget every listener, queued event and counter. */
export function resetTelemetryListenersForTests(): void {
  registered.splice(0);
  queue.splice(0);
  dropped = 0;
  lastDropWarn = null;
}
