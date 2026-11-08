import Logger from '@kuraykaraaslan-labs/logger';
import {
  parseSecuritySignal, SIGNAL_SCHEMA_VERSION, SIGNAL_STREAM_KEY,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import type { MetricSource } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { signalToEventRow, type EventRow } from './ai_firewall.store';
import { knownTenantsCache, lookupTenantsLazily, type KnownTenants } from './ai_firewall.known-tenants';

/**
 * The consumer of `fw:signals` (docs/phases/55-ai-firewall/01 §1.4, §1.7): in the platform worker it reads the stream the intake
 * writes (`emitSecuritySignal`, common.firewall-contracts.ts) and stores every signal in `ai_firewall_events`.
 *
 *   - a consumer group (`ai-firewall-store`, made at the start of the stream); each turn (every second, `XREADGROUP` without blocking,
 *     so the shared connection is never held) reads up to `batch` entries, and reads again at once while full batches come, at most
 *     `maxRounds` times;
 *   - **normalise**: every entry is checked again as data (`parseSecuritySignal`: the version, every bound of the contract) and its
 *     tenant must be a uuid; an entry that is not a signal is **malformed**: acknowledged at once and counted, never retried, so it can
 *     never block the stream;
 *   - **only existing tenants** (D55-71): the tenants of a read are checked against the tenants table (`knownTenants`, a cache in
 *     process); the entries of a tenant that does not exist (an anonymous producer stamps the URL's tenant segment, which may name no
 *     tenant) are acknowledged unwritten and counted (`unknown_tenant`), so no row is kept that no tenant's retention reaches. A check
 *     that fails leaves the read's entries pending, as a failed write does;
 *   - **deduplicate** by the signal's id: twice in one batch is stored once, and a redelivered entry is skipped by the table's key
 *     (`ON CONFLICT DO NOTHING`, ai_firewall.event-store.ts);
 *   - **store in batches**: one transaction per tenant per round, on the tenant's own DataSource (platform signals under the ROOT tenant);
 *   - **acknowledge** a tenant's entries after its write. A write that throws leaves them pending: claimed again after `claimIdleMs` by
 *     any worker, at most `maxDeliveries` times, then acknowledged unwritten and counted as dropped. Nothing is deleted from the stream:
 *     it is capped by the writer (`MAXLEN ~ 100000`), and the feature store of 02 reads it with a group of its own.
 *
 * **Labels** (03 §3.1, D55-76): after a tenant's write, its stored rows go to the label producer (`labels`, the boot task passes
 * `labels/ai_firewall.label-producer.ts`): decoy touches and bans an operator placed or lifted become labels, in a transaction of their
 * own. A label write that fails is counted (`ai_firewall_labels_produced_total{result="failed"}`) and logged, never retried, and never
 * holds the acknowledgement: the events are stored already.
 *
 * Fail open (FWA-7): the consumer is the only reader; a slow or broken database only grows the stream's backlog (capped), it never
 * reaches a request or an audit write. Counts reach `/metrics` as `ai_firewall_store_*` (the worker's, through process_host).
 */
export const SIGNAL_GROUP = 'ai-firewall-store';
export const SIGNAL_FIELD = 's';
export const VERSION_FIELD = 'v';

export interface ConsumerRedis {
  call(command: string, ...args: Array<string | number>): Promise<unknown>;
}

export type StoreEvents = (tenantId: string, rows: readonly EventRow[]) => Promise<number>;
/** Labels a tenant's stored rows (03 §3.1); answers the labels newly written. */
export type ProduceLabels = (tenantId: string, rows: readonly EventRow[]) => Promise<number>;

/** The real store, loaded on first use (the database stays out of this file's import graph). */
const insertEventsLazily: StoreEvents = async (tenantId, rows) => (await import('./ai_firewall.event-store')).insertEvents(tenantId, rows);

/** The real label producer, loaded on first use. */
export const produceLabelsLazily: ProduceLabels = async (tenantId, rows) =>
  (await import('../labels/ai_firewall.label-producer')).produceEventLabels(tenantId, rows);

export interface SignalConsumerOptions {
  redis: ConsumerRedis;
  consumer?: string;
  store?: StoreEvents;
  /** The label producer run after each tenant's write (absent: no labels, as in the store's own tests). */
  labels?: ProduceLabels;
  stream?: string;
  group?: string;
  pollMs?: number;
  batch?: number;
  /** Reads per turn while every read comes back full (catching up after an outage without waiting a second per batch). */
  maxRounds?: number;
  claimIdleMs?: number;
  maxDeliveries?: number;
  /** Which tenants of a read exist (D55-71). Absent: every tenant is taken as existing (tests of the store alone). */
  knownTenants?: KnownTenants;
  now?: () => number;
  warn?: (text: string) => void;
}

export const STORE_RESULTS = ['stored', 'duplicate', 'malformed', 'dropped', 'unknown_tenant'] as const;
export type StoreResult = (typeof STORE_RESULTS)[number];

export interface SignalConsumerStats {
  /** Entries handed to this consumer (fresh and claimed). */
  read: number;
  /**
   * Signals by what became of them: stored, already stored (or twice in a batch), not a signal, dropped after `maxDeliveries`, dropped
   * because their tenant does not exist (D55-71).
   */
  results: Record<StoreResult, number>;
  /** Tenant writes that threw (their entries stayed pending). */
  writeFailures: number;
  /** The label producer's work (03 §3.1): labels written, and tenant batches whose label write failed (dropped, never retried). */
  labels: { written: number; failed: number };
}

const WARN_EVERY_MS = 60_000;

type Entry = [string, unknown];
const entriesOf = (v: unknown): Entry[] => (Array.isArray(v) ? v.filter((e): e is Entry => Array.isArray(e) && typeof e[0] === 'string') : []);
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function fieldOf(fields: unknown, name: string): unknown {
  if (!Array.isArray(fields)) return undefined;
  for (let i = 0; i + 1 < fields.length; i += 2) if (fields[i] === name) return fields[i + 1];
  return undefined;
}

/** One stream entry as an event row; null when it is not a signal of this version (malformed). Never throws. */
export function entryToRow(fields: unknown): EventRow | null {
  try {
    const version = fieldOf(fields, VERSION_FIELD);
    if (version !== undefined && String(version) !== String(SIGNAL_SCHEMA_VERSION)) return null;
    const raw = fieldOf(fields, SIGNAL_FIELD);
    if (typeof raw !== 'string') return null;
    const signal = parseSecuritySignal(raw);
    return signal ? signalToEventRow(signal) : null;
  } catch {
    return null;
  }
}

/** The entries of one read grouped by tenant, each signal once (the first entry of an id wins); the ids of every entry kept for the ack. */
export interface Grouped {
  malformed: string[];
  tenants: Map<string, { ids: string[]; rows: EventRow[]; duplicates: number }>;
}

export function groupEntries(entries: readonly Entry[]): Grouped {
  const out: Grouped = { malformed: [], tenants: new Map() };
  const seen = new Map<string, Set<string>>();
  for (const [id, fields] of entries) {
    const row = entryToRow(fields);
    if (!row) { out.malformed.push(id); continue; }
    let t = out.tenants.get(row.tenantId);
    if (!t) { t = { ids: [], rows: [], duplicates: 0 }; out.tenants.set(row.tenantId, t); }
    t.ids.push(id);
    const ids = seen.get(row.tenantId) ?? seen.set(row.tenantId, new Set()).get(row.tenantId)!;
    if (ids.has(row.signalId)) { t.duplicates += 1; continue; }
    ids.add(row.signalId);
    t.rows.push(row);
  }
  return out;
}

const freshStats = (): SignalConsumerStats => ({
  read: 0, results: { stored: 0, duplicate: 0, malformed: 0, dropped: 0, unknown_tenant: 0 }, writeFailures: 0, labels: { written: 0, failed: 0 },
});

export class SignalConsumer {
  readonly stats: SignalConsumerStats = freshStats();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<number> | null = null;
  private groupReady = false;
  private stopped = false;
  private lastWarn: number | null = null;
  private readonly stream: string;
  private readonly group: string;
  private readonly consumer: string;

  constructor(private readonly o: SignalConsumerOptions) {
    this.stream = o.stream ?? SIGNAL_STREAM_KEY;
    this.group = o.group ?? SIGNAL_GROUP;
    this.consumer = o.consumer ?? String(process.pid);
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  start(): this {
    if (this.timer || this.stopped) return this;
    this.timer = setInterval(() => { void this.runOnce(); }, this.o.pollMs ?? 1_000);
    this.timer.unref?.();
    return this;
  }

  /** Stops the loop and waits for the turn in progress (what it did not acknowledge is claimed by another worker later). */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => 0);
  }

  /** One turn; resolves with the signals newly stored. Never throws. One turn at a time: a second call shares the running one. */
  runOnce(): Promise<number> {
    if (this.running) return this.running;
    this.running = this.turn().catch((e) => {
      if (/NOGROUP/i.test(errText(e))) this.groupReady = false;
      this.warn(`${this.stream} unreadable: ${errText(e)}`, true);
      return 0;
    }).finally(() => { this.running = null; });
    return this.running;
  }

  private warn(text: string, always = false): void {
    const now = this.now();
    if (!always && this.lastWarn !== null && now - this.lastWarn < WARN_EVERY_MS) return;
    this.lastWarn = now;
    this.o.warn?.(`signal store: ${text}`);
  }

  private async ensureGroup(): Promise<void> {
    if (this.groupReady) return;
    try {
      await this.o.redis.call('XGROUP', 'CREATE', this.stream, this.group, '0', 'MKSTREAM');
    } catch (e) {
      if (!/BUSYGROUP/i.test(errText(e))) throw e;
    }
    this.groupReady = true;
  }

  private async ack(ids: readonly string[]): Promise<void> {
    if (ids.length) await this.o.redis.call('XACK', this.stream, this.group, ...ids);
  }

  private async turn(): Promise<number> {
    await this.ensureGroup();
    const batch = this.o.batch ?? 500;
    const idle = this.o.claimIdleMs ?? 60_000;
    const maxDeliveries = this.o.maxDeliveries ?? 5;
    let stored = 0;

    // 1. entries a failed write or a dead worker left pending, once idle long enough
    const pending = await this.o.redis.call('XPENDING', this.stream, this.group, 'IDLE', idle, '-', '+', batch);
    const retry: string[] = [];
    const exhausted: string[] = [];
    for (const p of Array.isArray(pending) ? pending : []) {
      if (!Array.isArray(p) || typeof p[0] !== 'string') continue;
      if (Number(p[3]) >= maxDeliveries) exhausted.push(p[0]);
      else retry.push(p[0]);
    }
    if (exhausted.length) {
      await this.ack(exhausted);
      this.stats.results.dropped += exhausted.length;
      this.warn(`${exhausted.length} signals dropped unstored after ${maxDeliveries} failed writes`, true);
    }
    if (retry.length) {
      const claimed = entriesOf(await this.o.redis.call('XCLAIM', this.stream, this.group, this.consumer, idle, ...retry));
      if (claimed.length) stored += await this.handle(claimed);
    }

    // 2. new entries, again at once while full batches come
    for (let round = 0; round < (this.o.maxRounds ?? 10) && !this.stopped; round += 1) {
      const fresh = await this.o.redis.call('XREADGROUP', 'GROUP', this.group, this.consumer, 'COUNT', batch, 'STREAMS', this.stream, '>');
      const entries: Entry[] = [];
      for (const s of Array.isArray(fresh) ? fresh : []) if (Array.isArray(s)) entries.push(...entriesOf(s[1]));
      if (!entries.length) break;
      stored += await this.handle(entries);
      if (entries.length < batch) break;
    }
    return stored;
  }

  /** The label producer on a tenant's stored rows, after their acknowledgement; never throws (03 §3.1, FWA-7). */
  private async label(tenantId: string, rows: readonly EventRow[]): Promise<void> {
    if (!this.o.labels || rows.length === 0) return;
    try {
      this.stats.labels.written += Math.max(0, Number(await this.o.labels(tenantId, rows)) || 0);
    } catch (e) {
      this.stats.labels.failed += 1;
      this.warn(`tenant ${tenantId}'s labels not written (dropped): ${errText(e)}`);
    }
  }

  /** Stores the entries tenant by tenant; acknowledges the malformed ones at once and each tenant's after its write. */
  private async handle(entries: readonly Entry[]): Promise<number> {
    this.stats.read += entries.length;
    const { malformed, tenants } = groupEntries(entries);
    if (malformed.length) {
      await this.ack(malformed);
      this.stats.results.malformed += malformed.length;
      this.warn(`${malformed.length} stream entries were not signals (dropped); ${this.stats.results.malformed} so far`);
    }
    const store = this.o.store ?? insertEventsLazily;
    let stored = 0;
    let known: ReadonlySet<string> | null = null;
    if (this.o.knownTenants && tenants.size) {
      try {
        known = await this.o.knownTenants([...tenants.keys()]);
      } catch (e) {
        // the tenants cannot be checked now: every tenant's entries stay pending and are claimed again, as after a failed write
        this.stats.writeFailures += tenants.size;
        this.warn(`the tenants of ${entries.length} signals could not be checked, retried later: ${errText(e)}`);
        return stored;
      }
    }
    for (const [tenantId, t] of tenants) {
      if (known && !known.has(tenantId)) {
        await this.ack(t.ids);
        this.stats.results.unknown_tenant += t.ids.length;
        this.warn(`${t.ids.length} signals for a tenant that does not exist were dropped; ${this.stats.results.unknown_tenant} so far`);
        continue;
      }
      try {
        const inserted = t.rows.length ? await store(tenantId, t.rows) : 0;
        const fresh = Math.max(0, Math.min(t.rows.length, inserted));
        stored += fresh;
        this.stats.results.stored += fresh;
        this.stats.results.duplicate += t.duplicates + (t.rows.length - fresh);
        await this.ack(t.ids);
      } catch (e) {
        this.stats.writeFailures += 1;
        this.warn(`tenant ${tenantId}'s signals not stored, retried later: ${errText(e)}`);
        continue;
      }
      await this.label(tenantId, t.rows);
    }
    return stored;
  }
}

/* ──────────────────────────────── The worker's boot task ──────────────────────────────── */


const CURRENT_KEY = Symbol.for('kuraykaraaslan-labs.ai_firewall.signalConsumer');
const holder = globalThis as unknown as Record<symbol, SignalConsumer | undefined>;

/** The series of the running consumer, read at scrape time (zeros before it starts). Counters as growing gauges, like the intake's. */
export function signalStoreMetricSources(read: () => SignalConsumerStats | undefined = () => holder[CURRENT_KEY]?.stats): MetricSource[] {
  return [
    {
      name: 'ai_firewall_store_signals_total',
      help: 'Security signals the fw:signals consumer handled, by result: stored, duplicate (already stored), malformed (not a signal, dropped), dropped (unstored after the last retry), unknown_tenant (their tenant does not exist, dropped).',
      labelNames: ['result'],
      read: async () => STORE_RESULTS.map((result) => ({ labels: { result }, value: read()?.results[result] ?? 0 })),
    },
    {
      name: 'ai_firewall_store_write_failures_total',
      help: 'Tenant writes of the fw:signals consumer that failed (their signals stayed pending and are retried).',
      labelNames: [],
      read: async () => [{ labels: {}, value: read()?.writeFailures ?? 0 }],
    },
    {
      name: 'ai_firewall_labels_produced_total',
      help: 'The label producer after the fw:signals consumer\'s writes (phase 55 03 §3.1): labels written (decoy touches, bans an operator placed or lifted), and tenant batches whose label write failed (dropped, never retried).',
      labelNames: ['result'],
      read: async () => [
        { labels: { result: 'written' }, value: read()?.labels.written ?? 0 },
        { labels: { result: 'failed' }, value: read()?.labels.failed ?? 0 },
      ],
    },
  ];
}

/**
 * Boot task of the platform worker (`common:boot_task`, phase `scheduler`, `parallel`: every worker process, the group shares the
 * entries): starts the consumer on the shared Redis connection, puts its series on the worker's `/metrics` and stops it with the drain.
 * Idempotent per process.
 */
export async function startSignalConsumer(): Promise<{ stop(): Promise<void> }> {
  const running = holder[CURRENT_KEY];
  if (running) return { stop: () => running.stop() };
  const [{ default: redis }, { registerDrainHook, registerMetricSource }, { hostname }, { probeLabelMetricSources }] = await Promise.all([
    import('@kuraykaraaslan-labs/redis'),
    import('@kuraykaraaslan-labs/common/server/process-hooks'),
    import('node:os'),
    import('../labels/ai_firewall.probe-labels'),
  ]);
  const consumer = new SignalConsumer({
    redis: redis as unknown as ConsumerRedis,
    consumer: `${hostname()}:${process.pid}`,
    knownTenants: knownTenantsCache(lookupTenantsLazily),
    labels: produceLabelsLazily,
    warn: (text) => Logger.warn(`[ai_firewall] ${text}`),
  }).start();
  holder[CURRENT_KEY] = consumer;
  for (const source of [...signalStoreMetricSources(), ...probeLabelMetricSources()]) registerMetricSource(source);
  const stop = async () => {
    await consumer.stop();
    if (holder[CURRENT_KEY] === consumer) holder[CURRENT_KEY] = undefined;
  };
  registerDrainHook('ai-firewall-signal-store', stop);
  return { stop };
}
