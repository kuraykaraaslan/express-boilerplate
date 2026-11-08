// A single V8 isolate running one plugin version's bundle for one tenant (the pool
// keys sandboxes by tenant and version). Handles ONE call at a time (the pool holds
// the borrow lock); per-call tenant context lives host-side in `_ctx`, set under the
// lock so the plugin can never read or spoof it.
import ivm from 'isolated-vm';
import type { Capability, Json } from '../../sdk/types';
import { buildBootstrap } from './isolate-bootstrap';
import { SandboxViolationError, noteViolation, type CallCtx, type HostDispatch, type SandboxLimits } from './isolate.types';

/**
 * Bounds of one call, enforced host-side (risk register plugin_runtime.11–.15, phase 33/27.C):
 *  - a WALL clock around every run: isolated-vm's `timeout` covers only the synchronous part, so a spin after the first
 *    `await` (a microtask loop) or a promise that never settles held a plugin-host thread or the sandbox forever; on
 *    expiry the isolate is disposed and the call fails (the pool replaces the sandbox);
 *  - the size of what a call returns and of every host-call payload;
 *  - how many host calls one run may have in flight, and that `args` is an array.
 */
export const SANDBOX_LIMITS = {
  wallGraceMs: 250,
  resultMaxBytes: 4 * 1024 * 1024,
  hostPayloadMaxBytes: 8 * 1024 * 1024,
  hostCallsInFlightMax: 64,
} as const;

/** Race `work` against a wall clock; on expiry `onExpire` runs (it disposes the isolate) and the call fails. */
async function withWallClock<T>(timeoutMs: number, onExpire: () => void, work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const running = work();
  running.catch(() => { /* settled by the race below; a late rejection after disposal is expected */ });
  const watchdog = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onExpire();
      reject(new SandboxViolationError('timeout', `plugin call timed out after ${timeoutMs} ms`));
    }, timeoutMs + SANDBOX_LIMITS.wallGraceMs);
  });
  try {
    return await Promise.race([running, watchdog]);
  } finally {
    clearTimeout(timer);
  }
}

function capResult<T>(value: T): T {
  if (typeof value === 'string' && value.length > SANDBOX_LIMITS.resultMaxBytes) {
    throw new SandboxViolationError('result_too_large', `plugin result too large (over ${SANDBOX_LIMITS.resultMaxBytes} bytes)`);
  }
  return value;
}

export class Sandbox {
  /** Host calls of the current run still in flight (bounded by SANDBOX_LIMITS.hostCallsInFlightMax). */
  private hostCallsInFlight = 0;
  private readonly isolate: ivm.Isolate;
  private readonly context: ivm.Context;
  private _ctx: CallCtx | null = null;
  busy = false;

  private constructor(isolate: ivm.Isolate, context: ivm.Context) {
    this.isolate = isolate;
    this.context = context;
  }

  static async create(
    pluginId: string,
    capabilities: Capability[],
    bundleCode: string,
    dispatch: HostDispatch,
    limits: SandboxLimits,
  ): Promise<Sandbox> {
    const isolate = new ivm.Isolate({ memoryLimit: limits.memoryMb });
    // A half-built isolate is nobody's to dispose (the bridge keeps it alive), so a
    // failed bootstrap or bundle disposes it here before rethrowing.
    try {
      const context = await isolate.createContext();
      const sandbox = new Sandbox(isolate, context);

      await context.global.set('global', context.global.derefInto());

      // The single host bridge. Reads sandbox._ctx (bound per call under the lock).
      // Pass the PLAIN function; evalClosure's `reference: true` references it as $0.
      const hostFn = async (payloadJson: string): Promise<string> => {
        try {
          if (typeof payloadJson !== 'string') return JSON.stringify({ error: 'host call payload must be a string' });
          if (payloadJson.length > SANDBOX_LIMITS.hostPayloadMaxBytes) {
            noteViolation(sandbox._ctx, 'host_payload_too_large');
            return JSON.stringify({ error: 'host call payload too large' });
          }
          const { cap, method, args } = JSON.parse(payloadJson) as { cap: string; method: string; args: Json[] };
          if (!sandbox._ctx) return JSON.stringify({ error: 'no active call context' });
          if (typeof cap !== 'string' || typeof method !== 'string') return JSON.stringify({ error: 'malformed host call' });
          if (args !== undefined && !Array.isArray(args)) return JSON.stringify({ error: 'host call args must be an array' });
          if (sandbox.hostCallsInFlight >= SANDBOX_LIMITS.hostCallsInFlightMax) {
            noteViolation(sandbox._ctx, 'host_calls_in_flight');
            return JSON.stringify({ error: 'too many host calls in flight' });
          }
          if (!sandbox._ctx.capabilities.includes(cap as Capability)) {
            return JSON.stringify({ error: `capability not granted: ${cap}` });
          }
          sandbox.hostCallsInFlight++;
          try {
            const value = await dispatch(sandbox._ctx, cap, method, args ?? []);
            return JSON.stringify({ value: value ?? null });
          } finally {
            sandbox.hostCallsInFlight--;
          }
        } catch (e: any) {
          return JSON.stringify({ error: e?.message ?? 'host call failed' });
        }
      };

      await context.evalClosure(
        `globalThis.__hostCall = function (payload) {
           return $0.apply(undefined, [payload], { result: { promise: true, copy: true }, arguments: { copy: true } });
         };`,
        [hostFn],
        { arguments: { reference: true } },
      );

      // Install the host shim, then run the (untrusted) bundle which assigns __plugin.
      await (await isolate.compileScript(buildBootstrap(pluginId, capabilities))).run(context, { timeout: limits.timeoutMs });
      // The bundle's top level can schedule microtasks the sync timeout does not cover: a wall clock bounds the load too.
      await withWallClock(limits.timeoutMs, () => { try { if (!isolate.isDisposed) isolate.dispose(); } catch { /* gone */ } },
        async () => (await isolate.compileScript(bundleCode)).run(context, { timeout: limits.timeoutMs }));
      return sandbox;
    } catch (e) {
      try { if (!isolate.isDisposed) isolate.dispose(); } catch { /* already gone */ }
      throw e;
    }
  }

  /** Run an HTTP handler. One call at a time (caller holds the borrow lock). */
  async runHttp(ctx: CallCtx, routeKey: string, reqJson: string, timeoutMs: number): Promise<string> {
    this._ctx = ctx;
    try {
      await this.context.global.set('__call_route', routeKey);
      await this.context.global.set('__call_req', reqJson);
      const script = await this.isolate.compileScript('__invokeHttp(__call_route, __call_req)');
      return capResult(await withWallClock(timeoutMs, () => this.dispose(),
        async () => (await script.run(this.context, { timeout: timeoutMs, promise: true, copy: true })) as string));
    } finally {
      this._ctx = null;
    }
  }

  /** Run a provider op (point#op). One call at a time (caller holds the borrow lock). */
  async runProvider(ctx: CallCtx, point: string, op: string, payloadJson: string, timeoutMs: number): Promise<string> {
    this._ctx = ctx;
    try {
      await this.context.global.set('__prov_point', point);
      await this.context.global.set('__prov_op', op);
      await this.context.global.set('__prov_payload', payloadJson);
      const script = await this.isolate.compileScript('__invokeProvider(__prov_point, __prov_op, __prov_payload)');
      return capResult(await withWallClock(timeoutMs, () => this.dispose(),
        async () => (await script.run(this.context, { timeout: timeoutMs, promise: true, copy: true })) as string));
    } finally {
      this._ctx = null;
    }
  }

  async runEvent(ctx: CallCtx, name: string, payloadJson: string, timeoutMs: number): Promise<void> {
    this._ctx = ctx;
    try {
      await this.context.global.set('__evt_name', name);
      await this.context.global.set('__evt_payload', payloadJson);
      const script = await this.isolate.compileScript('__invokeEvent(__evt_name, __evt_payload)');
      await withWallClock(timeoutMs, () => this.dispose(), async () => { await script.run(this.context, { timeout: timeoutMs, promise: true, copy: true }); });
    } finally {
      this._ctx = null;
    }
  }

  dispose(): void {
    try { this.context.release(); } catch { /* already gone */ }
    try { if (!this.isolate.isDisposed) this.isolate.dispose(); } catch { /* already gone */ }
  }
}
