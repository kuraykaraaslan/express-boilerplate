/**
 * What the request cascade reads about an actor, held in the web process (docs/phases/55-ai-firewall/04-tree-models.md 4.8; D55-116).
 *
 * The rule of D55-21 holds in the request path: no awaited Redis call beyond the limiter's own. The limiter's call is its bucket check
 * (a GCRA script per bucket), which cannot carry the 25 reads of an actor's windows without turning the limiter into the feature store,
 * so the cascade reads from this bounded in-process cache instead, refreshed OFF the request path:
 *
 *   - a request looks its actor up (`lookup`, synchronous); a fresh entry (read within FRESH_MS, the feature store's own flush interval)
 *     is used as it is; an older one up to MAX_AGE_MS is used and queued for a refresh; an older one still, or none, is a miss: the
 *     request is allowed and counted (FWA-7) and the actor is queued;
 *   - a timer takes at most PER_REFRESH queued actors every REFRESH_MS and reads them as the worker does (`actorFeatures`: one bounded
 *     pipeline each, the cached baseline), CONCURRENCY at a time; a read that fails leaves the entry as it was (it ages out) and is
 *     counted, never retried at once;
 *   - an entry keeps the models' rows ready (`rowsOf`, Float64Array in the models' order), so a request allocates nothing to score.
 *
 * Bounded: at most MAX_ENTRIES actors (the oldest refreshed goes first), at most QUEUE_MAX waiting (a new one beyond is dropped and
 * counted). Raw ids (an address, a user id) live in this process's memory only, as in the request fold; nothing here is written.
 */
import type { ActorRef, SignalLane } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import type { ActorFeatureRequest, ActorFeatures } from '../features/ai_firewall.feature-store';

export const FRESH_MS = 5_000;
export const MAX_AGE_MS = 60_000;
export const REFRESH_MS = 1_000;
export const PER_REFRESH = 250;
export const CONCURRENCY = 16;
export const MAX_ENTRIES = 20_000;
export const QUEUE_MAX = 5_000;

/** One actor as the cascade scores it. */
export interface ActorSnapshot {
  /** The behaviour model's row (its features, in its order), or null: the model is not loaded or the vector is another catalogue's. */
  behaviour: Float64Array | null;
  attack: Float64Array | null;
  coldStart: boolean;
  /** The windows could be read when the entry was refreshed (else every window feature is missing and the entry is not scored). */
  windowsRead: boolean;
  /**
   * The sessions of this person that proved a second factor lately (the keyed session tags of the fold's `sup:<tag>` counters, D55-125):
   * no further step-up is asked of THOSE sessions; another session of the same person is asked as before. Null: none.
   */
  stepUpSessions: ReadonlySet<string> | null;
  readAtMs: number;
}

export type LookupState = 'fresh' | 'stale' | 'miss';

export interface SnapshotTarget {
  tenantId: string | null;
  actor: ActorRef;
  lane: SignalLane;
}

export interface CacheStats {
  fresh: number;
  stale: number;
  miss: number;
  refreshed: number;
  refreshFailed: number;
  queueDropped: number;
  evicted: number;
}

export interface SnapshotCacheOptions {
  /** Reads an actor's vectors (default: the feature store's `actorFeatures`). */
  read?: (req: ActorFeatureRequest) => Promise<ActorFeatures>;
  /** Turns the vectors into the loaded models' rows (the runtime's `rowsOf`). */
  rowsOf: (features: ActorFeatures) => { behaviour: Float64Array | null; attack: Float64Array | null };
  now?: () => number;
  freshMs?: number;
  maxAgeMs?: number;
  perRefresh?: number;
  concurrency?: number;
  maxEntries?: number;
  queueMax?: number;
}

/** The cache key of an actor: its scope (tenant or platform), kind and raw id; memory only. */
export const snapshotKey = (target: Pick<SnapshotTarget, 'tenantId' | 'actor'>): string =>
  `${target.actor.kind === 'ip' || target.actor.kind === 'anon' ? '-' : (target.tenantId ?? '-')}|${target.actor.kind}|${target.actor.id}`;

export class SnapshotCache {
  readonly stats: CacheStats = { fresh: 0, stale: 0, miss: 0, refreshed: 0, refreshFailed: 0, queueDropped: 0, evicted: 0 };
  private readonly entries = new Map<string, ActorSnapshot>();
  private readonly queue = new Map<string, SnapshotTarget>();
  /** Step-ups this process saw before the next refresh brings the fold's counter (`<actor key>#<session tag>` -> until, ms). */
  private readonly provedUntil = new Map<string, number>();
  private refreshing: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly o: SnapshotCacheOptions) {}

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  get size(): number {
    return this.entries.size;
  }

  get waiting(): number {
    return this.queue.size;
  }

  /** Queues an actor for a refresh (deduplicated; dropped and counted when the queue is full). Synchronous. */
  want(key: string, target: SnapshotTarget): void {
    if (this.queue.has(key)) return;
    if (this.queue.size >= (this.o.queueMax ?? QUEUE_MAX)) { this.stats.queueDropped += 1; return; }
    this.queue.set(key, target);
  }

  /**
   * The actor's snapshot as the request path reads it (synchronous; never throws). `target` is only built when the actor has to be
   * queued, so a fresh hit costs one map lookup.
   */
  lookup(key: string, target: () => SnapshotTarget, nowMs: number = this.now()): { state: LookupState; snapshot: ActorSnapshot | null } {
    try {
      const e = this.entries.get(key);
      const age = e ? nowMs - e.readAtMs : Number.POSITIVE_INFINITY;
      if (e && age <= (this.o.freshMs ?? FRESH_MS)) {
        this.stats.fresh += 1;
        return { state: 'fresh', snapshot: e };
      }
      this.want(key, target());
      if (e && age <= (this.o.maxAgeMs ?? MAX_AGE_MS)) {
        this.stats.stale += 1;
        return { state: 'stale', snapshot: e };
      }
      this.stats.miss += 1;
      return { state: 'miss', snapshot: null };
    } catch {
      this.stats.miss += 1;
      return { state: 'miss', snapshot: null };
    }
  }

  /**
   * Whether the session tagged `sessionTag` of the actor `key` proved a second factor lately: its tag is in the snapshot (the fold's
   * counter) or this process saw the proof (`markStepUpProved`). Synchronous; never throws.
   */
  sessionProved(key: string, snapshot: ActorSnapshot | null, sessionTag: string, nowMs: number = this.now()): boolean {
    try {
      if (snapshot?.stepUpSessions?.has(sessionTag)) return true;
      const k = `${key}#${sessionTag}`;
      const until = this.provedUntil.get(k);
      if (until === undefined) return false;
      if (until < nowMs) { this.provedUntil.delete(k); return false; }
      return true;
    } catch {
      return false;
    }
  }

  /** This process saw the session `sessionTag` of the actor prove a second factor: no step-up is asked of THAT session until `untilMs`. */
  markStepUpProved(key: string, sessionTag: string, untilMs: number): void {
    if (this.provedUntil.size >= (this.o.maxEntries ?? MAX_ENTRIES)) this.provedUntil.clear();
    this.provedUntil.set(`${key}#${sessionTag}`, untilMs);
  }

  /** Puts a snapshot in (the refresh, and the tests). The oldest entry goes when the cache is full. */
  put(key: string, snapshot: ActorSnapshot): void {
    if (this.entries.has(key)) this.entries.delete(key);
    else if (this.entries.size >= (this.o.maxEntries ?? MAX_ENTRIES)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) { this.entries.delete(oldest); this.stats.evicted += 1; }
    }
    this.entries.set(key, snapshot);
  }

  private async read(req: ActorFeatureRequest): Promise<ActorFeatures> {
    if (this.o.read) return this.o.read(req);
    const { actorFeatures } = await import('../features/ai_firewall.feature-store');
    return actorFeatures(req);
  }

  private async refreshOne(key: string, target: SnapshotTarget): Promise<void> {
    try {
      const nowMs = this.now();
      const f = await this.read({ tenantId: target.tenantId, actor: target.actor, lane: target.lane, nowMs });
      const rows = this.o.rowsOf(f);
      this.put(key, {
        behaviour: rows.behaviour, attack: rows.attack, coldStart: f.coldStart, windowsRead: f.windowsRead,
        stepUpSessions: f.stepUpSessions && f.stepUpSessions.length > 0 ? new Set(f.stepUpSessions) : null, readAtMs: nowMs,
      });
      this.stats.refreshed += 1;
    } catch {
      this.stats.refreshFailed += 1;
    }
  }

  /** One refresh round: at most PER_REFRESH queued actors, CONCURRENCY at a time. One round at a time; never rejects. */
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const batch: Array<[string, SnapshotTarget]> = [];
        for (const item of this.queue) {
          if (batch.length >= (this.o.perRefresh ?? PER_REFRESH)) break;
          batch.push(item);
        }
        for (const [key] of batch) this.queue.delete(key);
        const width = Math.max(1, this.o.concurrency ?? CONCURRENCY);
        for (let i = 0; i < batch.length; i += width) {
          await Promise.all(batch.slice(i, i + width).map(([key, target]) => this.refreshOne(key, target)));
        }
      } catch {
        // a round that fails leaves the entries to age out
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  start(intervalMs: number = REFRESH_MS): this {
    if (this.timer) return this;
    this.timer = setInterval(() => { void this.refresh(); }, intervalMs);
    this.timer.unref?.();
    return this;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.refreshing;
  }
}
