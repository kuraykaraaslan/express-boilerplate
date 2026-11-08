import Logger from '@kuraykaraaslan-labs/logger';
import { isUntrustedText } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import type { MetricSource } from '@kuraykaraaslan-labs/common/server/process-hooks';
import type { EventRow } from '../store/ai_firewall.store';
import { featureIdKey, featureIdOf, featureTagOf } from './ai_firewall.feature-id';
import { PLATFORM_SCOPE, tenantScope, isPlatformActorKind } from './ai_firewall.feature-windows';
import { writeFeatureUpdates, type FeatureRedis, type FeatureUpdate } from './ai_firewall.feature-writer';
import { enqueueDetectionRows } from '../detect/ai_firewall.detection-queue';

/**
 * The signal half of the feature store (docs/phases/55-ai-firewall/02 §2.1): the `fw:signals` stream of 01, read by its own consumer
 * group (`ai-firewall-features`, every worker process; the store's group `ai-firewall-store` is untouched) with the same consumer code
 * as the store (`SignalConsumer`), and folded into the actors' windows:
 *
 *   - the signal's actor: `s`, `k:<kind>`, `o:<outcome>`, `ko:<kind>:<outcome>`, `sv:high|critical`; the subject touched (distinct);
 *   - the address in the signal (`attrs.ip`) as a second actor with the same counts (failures per address across accounts), which
 *     learns the account (distinct accounts per address; a failed sign-in for an address nobody holds names the e-mail as the account);
 *     the account learns the address (distinct addresses per account);
 *   - a person or a key's day profile: the hour, the country (`m.country`) and ASN (`m.asn`) when the signal carries them, the device
 *     (a keyed tag of the user agent), the subject and the address (distinct per day).
 *
 * Kinds are the registered ones (`ai_firewall:signal`); any other kind counts as `other`, so the counter fields stay a bounded set.
 * Every id is the keyed hash of `ai_firewall.feature-id.ts`. A batch that cannot be written is counted and acknowledged, never retried:
 * features are estimates, and a retry would count twice. Fail open: nothing here reaches a request or an audit write (FWA-7).
 */
export const FEATURE_GROUP = 'ai-firewall-features';
const MEMBERS_MAX = 64;
const COUNTRY = /^[A-Za-z]{2}$/;
const ASN = /^(?:AS)?(\d{1,10})$/i;

const textOf = (v: unknown): string | null => (typeof v === 'string' ? v : isUntrustedText(v) ? v.text : null);
const add = (c: Record<string, number>, field: string, n = 1): void => { c[field] = (c[field] ?? 0) + n; };

interface Pending {
  update: FeatureUpdate & { counters: Record<string, number> };
  distinct: { acct: Set<string>; addr: Set<string>; subj: Set<string> };
  profile: { counters: Record<string, number>; subj: Set<string>; addr: Set<string> } | null;
}

/**
 * The updates a batch of stored-signal rows makes: one per actor and minute (the bucket a signal belongs to is its own time). Pure but
 * for the keyed hash. `kinds`: the registered kinds (null = registry unavailable: every kind is `other`).
 */
export function signalRowsToUpdates(rows: readonly EventRow[], kinds: ReadonlySet<string> | null, key: Buffer | null = featureIdKey()): FeatureUpdate[] {
  if (!key) return [];
  const pending = new Map<string, Pending>();
  const get = (scope: string, kind: string, hash: string, atMs: number, baseline: boolean): Pending => {
    const minute = Math.floor(atMs / 60_000);
    const id = `${scope}|${kind}|${hash}|${minute}`;
    let p = pending.get(id);
    if (!p) {
      p = {
        update: { scope, kind, hash, atMs: minute * 60_000, counters: {} },
        distinct: { acct: new Set(), addr: new Set(), subj: new Set() },
        profile: baseline ? { counters: {}, subj: new Set(), addr: new Set() } : null,
      };
      pending.set(id, p);
    }
    return p;
  };
  const member = (set: Set<string>, value: string | null) => { if (value && set.size < MEMBERS_MAX) set.add(value); };

  for (const row of rows) {
    const atMs = Date.parse(row.at);
    if (!Number.isFinite(atMs)) continue;
    const scope = isPlatformActorKind(row.actorKind) ? PLATFORM_SCOPE : tenantScope(row.tenantId);
    const actorHash = featureIdOf(row.actorKind, row.actorId, key);
    if (!actorHash) continue;
    const kind = kinds?.has(row.kind) ? row.kind : 'other';
    const baseline = row.actorKind === 'user' || row.actorKind === 'apiKey';
    const subject = row.subjectType && row.subjectId ? featureIdOf('subject', `${row.subjectType}:${row.subjectId}`, key) : null;
    const address = row.actorKind === 'ip' ? row.actorId : textOf(row.attrs?.ip);
    const addressHash = address ? featureIdOf('ip', address, key) : null;

    const counts = (c: Record<string, number>) => {
      add(c, 's');
      add(c, `k:${kind}`);
      add(c, `o:${row.outcome}`);
      add(c, `ko:${kind}:${row.outcome}`);
      if (row.severity === 'high' || row.severity === 'critical') add(c, `sv:${row.severity}`);
    };

    const actor = get(scope, row.actorKind, actorHash, atMs, baseline);
    counts(actor.update.counters);
    member(actor.distinct.subj, subject);

    if (addressHash && row.actorKind !== 'ip') {
      const at = get(PLATFORM_SCOPE, 'ip', addressHash, atMs, false);
      counts(at.update.counters);
      member(at.distinct.subj, subject);
      if (row.actorKind === 'user' || row.actorKind === 'apiKey') member(at.distinct.acct, actorHash);
      member(actor.distinct.addr, addressHash);
    } else if (row.actorKind === 'ip') {
      const email = textOf(row.attrs?.['m.email']);
      if (email) member(actor.distinct.acct, featureIdOf('email', email.trim(), key));
    }

    if (actor.profile) {
      const p = actor.profile;
      add(p.counters, `h${String(new Date(atMs).getUTCHours()).padStart(2, '0')}`);
      const country = textOf(row.attrs?.['m.country']);
      if (country && COUNTRY.test(country)) add(p.counters, `c:${country.toUpperCase()}`);
      const asnRaw = row.attrs?.['m.asn'];
      const asn = typeof asnRaw === 'number' && Number.isInteger(asnRaw) && asnRaw > 0 ? String(asnRaw) : ASN.exec(textOf(asnRaw) ?? '')?.[1] ?? null;
      if (asn) add(p.counters, `a:${asn}`);
      const ua = textOf(row.attrs?.userAgent);
      const device = ua ? featureTagOf('device', ua, key) : null;
      if (device) add(p.counters, `d:${device}`);
      member(p.subj, subject);
      member(p.addr, addressHash);
    }
  }

  const out: FeatureUpdate[] = [];
  for (const p of pending.values()) {
    const distinct: NonNullable<FeatureUpdate['distinct']> = {};
    if (p.distinct.acct.size) distinct.acct = [...p.distinct.acct];
    if (p.distinct.addr.size) distinct.addr = [...p.distinct.addr];
    if (p.distinct.subj.size) distinct.subj = [...p.distinct.subj];
    out.push({
      ...p.update,
      distinct,
      ...(p.profile ? {
        profile: {
          counters: p.profile.counters,
          distinct: { ...(p.profile.subj.size ? { subj: [...p.profile.subj] } : {}), ...(p.profile.addr.size ? { addr: [...p.profile.addr] } : {}) },
        },
      } : {}),
    });
  }
  return out;
}

export interface SignalFoldStats {
  rows: number;
  updates: number;
  /** Rows of batches that could not be written (counted, acknowledged, never retried). */
  failedRows: number;
}

export interface SignalFoldOptions {
  redis: FeatureRedis;
  kinds: () => Promise<ReadonlySet<string> | null>;
  now?: () => number;
  key?: () => Buffer | null;
  warn?: (text: string) => void;
  /** Names the batch's actors to the detectors (02 §2.3) once it is folded; default the process's queue (a no-op without one). */
  detect?: (rows: readonly EventRow[], nowMs: number) => void;
}

/**
 * The consumer's `store` for the feature group: folds a tenant's rows, names their actors to the detectors' queue, and answers them all
 * as handled (so they are acknowledged).
 */
export function signalFeatureStore(o: SignalFoldOptions, stats: SignalFoldStats) {
  return async (_tenantId: string, rows: readonly EventRow[]): Promise<number> => {
    stats.rows += rows.length;
    try {
      const updates = signalRowsToUpdates(rows, await o.kinds().catch(() => null), (o.key ?? featureIdKey)());
      const result = await writeFeatureUpdates(o.redis, updates, (o.now ?? Date.now)());
      stats.updates += result.written;
    } catch (e) {
      stats.failedRows += rows.length;
      o.warn?.(`signal features: ${rows.length} signals not folded: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      (o.detect ?? enqueueDetectionRows)(rows, (o.now ?? Date.now)());
    } catch {
      // the detectors are best effort (FWA-7)
    }
    return rows.length;
  };
}

/* ──────────────────────────────── The worker's boot task ──────────────────────────────── */

const CURRENT_KEY = Symbol.for('kuraykaraaslan-labs.ai_firewall.signalFeatures');
const holder = globalThis as unknown as Record<symbol, { stats: SignalFoldStats; stop(): Promise<void> } | undefined>;

export function signalFeatureMetricSources(read: () => SignalFoldStats | undefined = () => holder[CURRENT_KEY]?.stats): MetricSource[] {
  return [
    {
      name: 'ai_firewall_feature_signals_total',
      help: 'Security signals the feature store\'s fw:signals consumer handled, by result: folded into the windows, or failed (counted, not retried).',
      labelNames: ['result'],
      read: async () => {
        const s = read();
        return [
          { labels: { result: 'folded' }, value: (s?.rows ?? 0) - (s?.failedRows ?? 0) },
          { labels: { result: 'failed' }, value: s?.failedRows ?? 0 },
        ];
      },
    },
  ];
}

/**
 * Boot task of the platform worker (`common:boot_task`, phase `scheduler`, `parallel`: every worker process, the group shares the
 * entries): the feature group's consumer on the shared Redis connection. Idempotent per process.
 */
export async function startSignalFeatures(): Promise<{ stop(): Promise<void> }> {
  const running = holder[CURRENT_KEY];
  if (running) return { stop: () => running.stop() };
  const [{ default: redis }, { registerDrainHook, registerMetricSource }, { hostname }, { SignalConsumer }, { firewallRegistry }] = await Promise.all([
    import('@kuraykaraaslan-labs/redis'),
    import('@kuraykaraaslan-labs/common/server/process-hooks'),
    import('node:os'),
    import('../store/ai_firewall.signal-consumer'),
    import('../registry/ai_firewall.registry'),
  ]);
  const stats: SignalFoldStats = { rows: 0, updates: 0, failedRows: 0 };
  let kinds: Promise<ReadonlySet<string> | null> | null = null;
  const warn = (text: string) => Logger.warn(`[ai_firewall] ${text}`);
  const consumer = new SignalConsumer({
    redis: redis as unknown as import('../store/ai_firewall.signal-consumer').ConsumerRedis,
    consumer: `${hostname()}:${process.pid}`,
    group: FEATURE_GROUP,
    store: signalFeatureStore({
      redis: redis as unknown as FeatureRedis,
      kinds: () => (kinds ??= firewallRegistry().then((v) => new Set(v.catalog.signals.keys())).catch(() => { kinds = null; return null; })),
      warn,
    }, stats),
    warn,
  }).start();
  const stop = async () => {
    await consumer.stop();
    if (holder[CURRENT_KEY]?.stats === stats) holder[CURRENT_KEY] = undefined;
  };
  holder[CURRENT_KEY] = { stats, stop };
  for (const source of signalFeatureMetricSources()) registerMetricSource(source);
  registerDrainHook('ai-firewall-signal-features', stop);
  return { stop };
}
