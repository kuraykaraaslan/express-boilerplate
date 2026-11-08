import { IPC_TAG, type ChildToParentMessage, type DrainReason, type ParentToChildMessage, type Tagged } from './supervisor.types';

/**
 * The child's end of the supervisor IPC channel (07 "Roles"). No Redis, no logger: this file is loaded by every child
 * and by `startProcessHost` in child mode.
 *
 * child → parent: `ready`, `signal`, `health`, `drained`, `metrics` (reply).
 * parent → child: `drain`, `metrics?`.
 */

export const tag = <T extends object>(m: T): Tagged<T> => ({ ...m, [IPC_TAG]: 1 }) as Tagged<T>;
export const isTagged = (m: unknown): m is Tagged<{ type: string }> =>
  typeof m === 'object' && m !== null && (m as Record<string, unknown>)[IPC_TAG] === 1 && typeof (m as { type?: unknown }).type === 'string';

/** The process channel, replaceable in tests. */
export interface ProcessChannel {
  send?: (message: unknown, callback?: (error: Error | null) => void) => boolean;
  on(event: 'message', listener: (m: unknown) => void): unknown;
  once(event: 'disconnect', listener: () => void): unknown;
  connected?: boolean;
}

/** What a drain request carries (07 task 7); a request without them is a shutdown. */
export interface DrainRequest {
  reason: DrainReason;
  /** The supervisor's grace for this drain (its policy's `drain.graceMs`). */
  graceMs?: number;
  /** False: the supervisor never cuts this scale-down short (the child decides when it is done). */
  force?: boolean;
}

type DrainHandler = (request: DrainRequest) => Promise<void> | void;
type MetricsProvider = () => Promise<unknown[] | null> | unknown[] | null;

export interface ChildIpc {
  /** True when a parent channel exists. */
  readonly attached: boolean;
  send(message: ChildToParentMessage): void;
  /** Sends and resolves once the message is handed to the channel (use before exiting). */
  sendAsync(message: ChildToParentMessage): Promise<void>;
  /**
   * The one drain handler (the last registration wins). Without one, a drain request is acknowledged at once. It runs
   * once per drain; the one exception is a `shutdown` request during a `scale-down` drain, which calls it again (without a
   * second acknowledgement) so the handler can cut its long drain short.
   */
  onDrain(handler: DrainHandler): void;
  onMetricsRequest(provider: MetricsProvider): void;
  /**
   * Called once when the parent channel is lost (the supervisor died). The disconnect is watched from the moment the
   * channel is created, so a handler registered later (after a slow start) still runs: at once, when the channel is
   * already gone. Only a forked child gets here: a `node:cluster` worker is exited by Node itself on an unexpected
   * disconnect, before any handler of ours (its connections came through the primary, which is gone).
   */
  onDisconnect(handler: () => void): void;
}

export function createChildIpc(channel: ProcessChannel = process as unknown as ProcessChannel): ChildIpc {
  let drain: DrainHandler | null = null;
  let metrics: MetricsProvider | null = null;
  let draining: DrainReason | null = null;
  /** `drained` goes out once: the handler may acknowledge itself before it exits (the shared drain sequence does). */
  let acknowledged = false;
  const attached = typeof channel.send === 'function';
  // watched from the start: a supervisor that dies while the child is still starting must not leave an orphan behind
  let disconnected = attached && channel.connected === false;
  const onLost: Array<() => void> = [];
  const fire = (handler: () => void) => { try { handler(); } catch { /* a handler never breaks the others */ } };
  if (attached && !disconnected) {
    channel.once('disconnect', () => {
      disconnected = true;
      for (const handler of onLost.splice(0)) fire(handler);
    });
  }

  const sendAsync = (message: ChildToParentMessage): Promise<void> => new Promise((resolve) => {
    if (message.type === 'drained') {
      if (acknowledged) { resolve(); return; }
      acknowledged = true;
    }
    if (!attached || channel.connected === false) { resolve(); return; }
    try {
      channel.send!(tag(message), () => resolve());
    } catch {
      resolve();
    }
  });

  if (attached) {
    channel.on('message', (raw: unknown) => {
      if (!isTagged(raw)) return;
      const m = raw as unknown as ParentToChildMessage;
      if (m.type === 'drain') {
        const request: DrainRequest = {
          reason: m.reason === 'scale-down' ? 'scale-down' : 'shutdown',
          ...(typeof m.graceMs === 'number' && { graceMs: m.graceMs }),
          ...(typeof m.force === 'boolean' && { force: m.force }),
        };
        if (draining) {
          // escalation: a shutdown while a scale-down drain is still running
          if (draining === 'scale-down' && request.reason === 'shutdown') {
            draining = 'shutdown';
            void (async () => { try { await drain?.(request); } catch { /* the first call acknowledges */ } })();
          }
          return;
        }
        draining = request.reason;
        void (async () => {
          try { await drain?.(request); } catch { /* the parent stops us anyway */ }
          await sendAsync({ type: 'drained' });
        })();
      } else if (m.type === 'metrics?') {
        void (async () => {
          let out: unknown[] | null = null;
          try { out = metrics ? await metrics() : null; } catch { out = null; }
          await sendAsync({ type: 'metrics', id: m.id, metrics: out });
        })();
      }
    });
  }

  return {
    attached,
    send(message) { void sendAsync(message); },
    sendAsync,
    onDrain(handler) { drain = handler; },
    onMetricsRequest(provider) { metrics = provider; },
    onDisconnect(handler) {
      if (!attached) return;
      if (disconnected || channel.connected === false) { disconnected = true; queueMicrotask(() => fire(handler)); return; }
      onLost.push(handler);
    },
  };
}

let shared: ChildIpc | null = null;
/** The process-wide child channel (created on first use). */
export function childIpc(): ChildIpc {
  shared ??= createChildIpc();
  return shared;
}
