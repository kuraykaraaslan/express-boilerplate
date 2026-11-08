// The V8-isolate runtime for untrusted plugin code. Runs ONLY in the standalone
// plugin-host process (never imported by app/ or the broker — keeps the isolated-vm
// native addon out of the Next bundle and the broker tier).
//
// Isolation model: one pool of warm sandboxes per (tenant, plugin VERSION); each
// sandbox is its own Isolate and handles ONE call at a time (no shared mutable
// global races), concurrency per pool = pool size. Tenants never share an isolate:
// a continuation a plugin leaves pending in tenant A's run can only ever resume in
// A's isolate, never inside tenant B's run (plugin_runtime.10). The number of pooled
// isolates is capped (MAX_POOLED_ISOLATES), least recently used idle ones are
// disposed first. The Sandbox itself lives in ./sandbox; this file owns the pools
// (borrow/release, recreate-on-fault, eviction).

import type { Capability } from '../../sdk/types';
import { Sandbox } from './sandbox';
import { DEFAULT_LIMITS, type CallCtx, type HostDispatch, type SandboxLimits } from './isolate.types';

export type { CallCtx, HostDispatch, SandboxLimits } from './isolate.types';

/** Default ceiling on the isolates kept across every tenant and version of one plugin-host process. */
export const MAX_POOLED_ISOLATES = 64;

/** A registered plugin version: what each of its sandboxes is built from. */
interface VersionEntry {
  pluginId: string;
  capabilities: Capability[];
  bundleCode: string;
  limits: SandboxLimits;
}

/** The sandboxes of one tenant on one plugin version. */
interface PoolEntry {
  key: string;
  pluginVersionId: string;
  sandboxes: Sandbox[];
  /** Sandboxes being created right now; they count against poolSize and the isolate cap. */
  creating: number;
  waiters: Waiter[];
}

/** A call queued behind a full pool. Each settles once: a sandbox it can no longer take goes back to the pool. */
interface Waiter {
  /** False when the waiter has already given up (its borrow timeout fired first). */
  give: (s: Sandbox) => boolean;
  fail: (e: unknown) => void;
}

/**
 * Thrown when no sandbox of a plugin version frees up within the borrow
 * timeout. The plugin-host answers it with a 503 so the caller can retry,
 * instead of queueing the request behind every other call to that version.
 */
export class SandboxBusyError extends Error {
  constructor(pluginVersionId: string, waitedMs: number) {
    super(`plugin sandboxes busy: no free sandbox for ${pluginVersionId} within ${waitedMs} ms`);
    this.name = 'SandboxBusyError';
  }
}

/**
 * Manages warm sandboxes per (tenant, plugin version). `register` pins a version's
 * bundle; `runHttp`/`runProvider`/`runEvent` borrow a free sandbox of the call's
 * tenant (creating up to `poolSize`), run, and return it. A crashed/timed-out
 * sandbox is disposed and recreated, never reused.
 */
export interface SandboxManagerOptions {
  /**
   * Called once per call with how long it waited for a sandbox, in ms: 0 when one was free or could be created, the queue
   * time when the pool was full, the borrow timeout when none freed up (or the isolate cap left no room). The plugin host's
   * scaling signal is the p95 of these (docs/phases/14-docker/07 task 7).
   */
  onWait?: (waitMs: number) => void;
  now?: () => number;
  /** Ceiling on the isolates kept across all pools (default MAX_POOLED_ISOLATES); idle ones are evicted LRU first. */
  maxIsolates?: number;
}

export class SandboxManager {
  private readonly versions = new Map<string, VersionEntry>(); // key: pluginVersionId
  /** key: poolKey(tenantId, configTenantId, pluginVersionId); iteration order is least recently used first. */
  private readonly pools = new Map<string, PoolEntry>();
  private inflightCalls = 0;

  constructor(
    private readonly dispatch: HostDispatch,
    private readonly poolSize = 4,
    /**
     * How long a call may wait for a busy pool before it fails with
     * SandboxBusyError. Without it the FIFO queue was unbounded, so short calls
     * (getFileUrl, delete) waited behind every queued upload with no end.
     */
    private readonly borrowTimeoutMs = 10_000,
    private readonly opts: SandboxManagerOptions = {},
  ) {}

  /** Calls borrowing or holding a sandbox right now (a draining plugin host waits for 0). */
  get inflight(): number {
    return this.inflightCalls;
  }

  private waited(ms: number): void {
    if (!this.opts.onWait) return;
    try { this.opts.onWait(Math.max(0, ms)); } catch { /* a metric never fails a call */ }
  }

  register(pluginVersionId: string, pluginId: string, capabilities: Capability[], bundleCode: string, limits?: Partial<SandboxLimits>): void {
    // A re-registered version starts over: sandboxes built from the old bundle are not reused.
    this.unregister(pluginVersionId);
    this.versions.set(pluginVersionId, { pluginId, capabilities, bundleCode, limits: { ...DEFAULT_LIMITS, ...limits } });
  }

  isRegistered(pluginVersionId: string): boolean {
    return this.versions.has(pluginVersionId);
  }

  /** Drops a version and disposes the sandboxes of every tenant on it. */
  unregister(pluginVersionId: string): void {
    if (!this.versions.delete(pluginVersionId)) return;
    for (const [key, pool] of [...this.pools]) {
      if (pool.pluginVersionId !== pluginVersionId) continue;
      for (const s of pool.sandboxes) s.dispose();
      this.pools.delete(key);
    }
  }

  /** Pools in use right now (one per tenant and version); for tests and diagnostics. */
  get poolCount(): number {
    return this.pools.size;
  }

  /** Isolates alive or being built across all pools. */
  get isolateCount(): number {
    let n = 0;
    for (const pool of this.pools.values()) n += pool.sandboxes.length + pool.creating;
    return n;
  }

  // Phase 53.4: the config tenant is part of the key, so a sandbox that ran with the root tenant's plugin config never serves a
  // call with the tenant's own (or the reverse) after a setting level changes: whatever it kept in memory stays with its config.
  private static poolKey(tenantId: string, configTenantId: string | undefined, pluginVersionId: string): string {
    return `${tenantId}\n${configTenantId ?? tenantId}\n${pluginVersionId}`;
  }

  /** The pool of this tenant (and config tenant) on this version, created on first use and marked most recently used. */
  private poolFor(tenantId: string, configTenantId: string | undefined, pluginVersionId: string): PoolEntry {
    const key = SandboxManager.poolKey(tenantId, configTenantId, pluginVersionId);
    const pool = this.pools.get(key) ?? { key, pluginVersionId, sandboxes: [], creating: 0, waiters: [] };
    this.pools.delete(key);
    this.pools.set(key, pool);
    return pool;
  }

  private isLive(pool: PoolEntry): boolean {
    return this.pools.get(pool.key) === pool;
  }

  /** A pool with nothing in it and nobody waiting is forgotten, so tenants that came and went leave no entry. */
  private dropIfEmpty(pool: PoolEntry): void {
    if (this.isLive(pool) && !pool.sandboxes.length && !pool.creating && !pool.waiters.length) this.pools.delete(pool.key);
  }

  /**
   * Make room for one more isolate under the cap: dispose idle sandboxes, least recently used pool first, and drop a pool
   * left empty (never `keep`, the pool asking). False when every isolate is busy (or being built), so the caller must
   * not create one.
   */
  private makeRoom(keep: PoolEntry): boolean {
    const max = this.opts.maxIsolates ?? MAX_POOLED_ISOLATES;
    let total = this.isolateCount;
    if (total < max) return true;
    for (const [key, pool] of [...this.pools]) {
      for (const s of [...pool.sandboxes]) {
        if (s.busy) continue;
        s.dispose();
        pool.sandboxes = pool.sandboxes.filter((x) => x !== s);
        total--;
        if (total < max) break;
      }
      if (pool !== keep && !pool.sandboxes.length && !pool.creating && !pool.waiters.length) this.pools.delete(key);
      if (total < max) return true;
    }
    return false;
  }

  private create(pool: PoolEntry): Promise<Sandbox> {
    const version = this.versions.get(pool.pluginVersionId)!;
    return Sandbox.create(version.pluginId, version.capabilities, version.bundleCode, this.dispatch, version.limits);
  }

  private async borrow(pool: PoolEntry): Promise<Sandbox> {
    const pluginVersionId = pool.pluginVersionId;
    const free = pool.sandboxes.find((s) => !s.busy);
    if (free) { free.busy = true; this.waited(0); return free; }
    // Reserve the slot before the async create: otherwise concurrent cold calls
    // all saw an empty pool and each built a sandbox, overshooting poolSize.
    if (pool.sandboxes.length + pool.creating < this.poolSize && this.makeRoom(pool)) {
      // creating a sandbox is a cold start, not queueing: it counts as no wait
      this.waited(0);
      pool.creating++;
      let s: Sandbox;
      try {
        s = await this.create(pool);
      } catch (error) {
        pool.creating--;
        // The slot this call reserved is free again, and it is the next waiter's.
        this.replaceForNextWaiter(pool);
        throw error;
      }
      pool.creating--;
      s.busy = true;
      pool.sandboxes.push(s);
      return s;
    }
    // The isolate cap is reached and every isolate is busy: with nothing of its own to wait for, the call is
    // back-pressure at once (503, retry), reported to the scaling signal like a call that gave up.
    if (pool.sandboxes.length + pool.creating === 0) {
      this.waited(this.borrowTimeoutMs);
      throw new SandboxBusyError(pluginVersionId, 0);
    }
    const now = this.opts.now ?? (() => performance.now());
    const since = now();
    return new Promise<Sandbox>((resolve, reject) => {
      let settled = false;
      const waiter: Waiter = {
        give: (s) => {
          if (settled) return false;
          settled = true;
          clearTimeout(timer);
          this.waited(now() - since);
          resolve(s);
          return true;
        },
        fail: (e) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(e);
        },
      };
      const timer = setTimeout(() => {
        // Leave the queue first, so a sandbox released later is never handed to
        // a call that has already given up (it would stay busy forever).
        const at = pool.waiters.indexOf(waiter);
        if (at !== -1) pool.waiters.splice(at, 1);
        if (!settled) this.waited(this.borrowTimeoutMs);
        waiter.fail(new SandboxBusyError(pluginVersionId, this.borrowTimeoutMs));
      }, this.borrowTimeoutMs);
      pool.waiters.push(waiter);
    });
  }

  private release(pool: PoolEntry, sandbox: Sandbox, broken: boolean): void {
    // A pool dropped meanwhile (its version unregistered) keeps nothing.
    if (!this.isLive(pool)) { sandbox.dispose(); return; }
    if (broken) {
      sandbox.dispose();
      pool.sandboxes = pool.sandboxes.filter((s) => s !== sandbox);
      // The freed slot is the next waiter's. Returning without serving it left every queued call to fail with
      // SandboxBusyError after the borrow timeout although the pool had room (plugin_runtime CHECKLIST).
      this.replaceForNextWaiter(pool);
      return;
    }
    // Stays busy, handed to the next waiter that still wants it.
    for (let waiter = pool.waiters.shift(); waiter; waiter = pool.waiters.shift()) {
      if (waiter.give(sandbox)) return;
    }
    sandbox.busy = false;
  }

  /** Build a fresh sandbox in a freed slot for the first waiter; one that cannot be built fails that waiter with its error. */
  private replaceForNextWaiter(pool: PoolEntry): void {
    if (!this.isLive(pool) || !pool.waiters.length || pool.sandboxes.length + pool.creating >= this.poolSize) return;
    const waiter = pool.waiters.shift()!;
    if (!this.makeRoom(pool)) {
      waiter.fail(new SandboxBusyError(pool.pluginVersionId, 0));
      return;
    }
    pool.creating++;
    this.create(pool).then(
      (s) => {
        pool.creating--;
        if (!this.isLive(pool)) {
          // Evicted while it was being built.
          s.dispose();
          waiter.fail(new Error(`plugin version not registered: ${pool.pluginVersionId}`));
          return;
        }
        s.busy = true;
        pool.sandboxes.push(s);
        // A waiter that gave up meanwhile leaves the new sandbox to the next one, or free.
        if (!waiter.give(s)) this.release(pool, s, false);
      },
      (error: unknown) => {
        pool.creating--;
        waiter.fail(error);
      },
    );
  }

  /** Borrow → run → release, disposing the sandbox on fault (timeout/OOM/isolate). */
  private async withSandbox<T>(pluginVersionId: string, ctx: CallCtx, run: (s: Sandbox, limits: SandboxLimits) => Promise<T>): Promise<T> {
    const version = this.versions.get(pluginVersionId);
    if (!version) throw new Error(`plugin version not registered: ${pluginVersionId}`);
    // The run's own tenant picks the pool: a sandbox only ever serves the tenant it was built for.
    const pool = this.poolFor(ctx.tenantId, ctx.configTenantId, pluginVersionId);
    this.inflightCalls++;
    try {
      const sandbox = await this.borrow(pool);
      let broken = false;
      try {
        return await run(sandbox, version.limits);
      } catch (e) {
        broken = true;
        throw e;
      } finally {
        this.release(pool, sandbox, broken);
      }
    } finally {
      this.inflightCalls--;
      this.dropIfEmpty(pool);
    }
  }

  runHttp(pluginVersionId: string, ctx: CallCtx, routeKey: string, reqJson: string): Promise<string> {
    return this.withSandbox(pluginVersionId, ctx, (s, l) => s.runHttp(ctx, routeKey, reqJson, l.timeoutMs));
  }

  runProvider(pluginVersionId: string, ctx: CallCtx, point: string, op: string, payloadJson: string): Promise<string> {
    return this.withSandbox(pluginVersionId, ctx, (s, l) => s.runProvider(ctx, point, op, payloadJson, l.timeoutMs));
  }

  runEvent(pluginVersionId: string, ctx: CallCtx, name: string, payloadJson: string): Promise<void> {
    return this.withSandbox(pluginVersionId, ctx, (s, l) => s.runEvent(ctx, name, payloadJson, l.timeoutMs));
  }

  disposeAll(): void {
    for (const id of [...this.versions.keys()]) this.unregister(id);
  }
}
