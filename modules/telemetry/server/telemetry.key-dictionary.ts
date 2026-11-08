import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';

/**
 * The per-tenant key dictionary (00 P0-T-02): `(tenantId, key) → keyId` through three layers, an in-process LRU of 100 000 entries,
 * the Redis hash `telemetry:key:{<tenantId>}` (hash-tagged, no TTL, deleted by the tenant purge) and the database (`telemetry_keys`).
 * Keys are never renamed or reused, so a cached id never goes stale and a worker restart costs Redis reads, not database reads.
 * A new key is inserted with `ON CONFLICT DO NOTHING` and read back, so two writers racing for one key agree on its id.
 *
 * The cap `iot_max_telemetry_keys` (P0-T-18) is checked only when a key is new: the tenant's key count is read at most once a
 * minute; a new key over the cap is not created, and the caller drops it (counted, never a stream entry). Without a cap function
 * (P1: the plan mapping is owner item 3) there is no cap.
 *
 * Redis is a cache: a Redis that fails is skipped (the database answers), never an error of the write. An id the database answered
 * is cached only after the caller's transaction committed (`publish`): an id of a key whose insert rolled back must never be served.
 */
export const KEY_LRU_MAX = 100_000;
export const KEY_COUNT_TTL_MS = 60_000;
export const keyHashOf = (tenantId: string): string => `telemetry:key:{${tenantId}}`;

/** The few Redis commands the dictionary uses. */
export interface KeyCacheRedis {
  hmget(key: string, ...fields: string[]): Promise<Array<string | null>>;
  hset(key: string, values: Record<string, string>): Promise<unknown>;
}

export interface KeyDictionaryOptions {
  redis?: KeyCacheRedis | null;
  /** The tenant's key cap (`iot_max_telemetry_keys`); absent or non-finite: no cap. */
  keyCap?: (tenantId: string) => Promise<number>;
  lruMax?: number;
  now?: () => number;
  /** Hears a cache failure (a log line); the write goes on. */
  warn?: (text: string) => void;
}

export interface KeyLookup {
  ids: Map<string, number>;
  /** Keys the dictionary could not create because the tenant is at its cap (`key_limit`). */
  refused: string[];
  /** Ids read from (or created in) the database by this lookup: `publish` them once the transaction committed. */
  fromDb: Map<string, number>;
}

export class TelemetryKeyDictionary {
  private readonly lru = new Map<string, number>();
  private readonly names = new Map<number, string>();
  private readonly counts = new Map<string, { at: number; n: number }>();
  private readonly now: () => number;

  constructor(private readonly o: KeyDictionaryOptions = {}) {
    this.now = o.now ?? Date.now;
  }

  private remember(tenantId: string, key: string, id: number): void {
    const k = `${tenantId}\u0000${key}`;
    this.lru.delete(k);
    this.lru.set(k, id);
    this.names.set(id, key);
    const max = this.o.lruMax ?? KEY_LRU_MAX;
    while (this.lru.size > max) {
      const [oldest, oldId] = this.lru.entries().next().value as [string, number];
      this.lru.delete(oldest);
      this.names.delete(oldId);
    }
  }

  /** The ids the in-process cache holds; no I/O. */
  cached(tenantId: string, keys: readonly string[]): { ids: Map<string, number>; missing: string[] } {
    const ids = new Map<string, number>();
    const missing: string[] = [];
    for (const key of new Set(keys)) {
      const k = `${tenantId}\u0000${key}`;
      const id = this.lru.get(k);
      if (id === undefined) missing.push(key);
      else {
        // most recently used
        this.lru.delete(k);
        this.lru.set(k, id);
        ids.set(key, id);
      }
    }
    return { ids, missing };
  }

  /**
   * The ids of `keys` for the tenant, creating the missing ones (in `db`, a transaction scoped to the tenant). Keys refused by the
   * cap are listed in `refused` and have no id. `cap` is the caller's kind's cap (`maxKeysPerTenant`); without it the dictionary's
   * own `keyCap` option applies, and without either there is no cap.
   */
  async idsOf(db: SqlRunner, tenantId: string, keys: readonly string[], cap?: () => Promise<number | null>): Promise<KeyLookup> {
    const { ids, missing } = this.cached(tenantId, keys);
    if (!missing.length) return { ids, refused: [], fromDb: new Map() };
    let rest = missing;
    if (this.o.redis) {
      try {
        const found = await this.o.redis.hmget(keyHashOf(tenantId), ...rest);
        const left: string[] = [];
        rest.forEach((key, i) => {
          const id = Number(found[i]);
          if (found[i] !== null && Number.isInteger(id) && id > 0) {
            ids.set(key, id);
            this.remember(tenantId, key, id);
          } else left.push(key);
        });
        rest = left;
      } catch (e) {
        this.o.warn?.(`telemetry key cache unavailable, reading the database: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!rest.length) return { ids, refused: [], fromDb: new Map() };
    let stored = await this.select(db, tenantId, rest);
    const absent = rest.filter((key) => !stored.has(key));
    let refused: string[] = [];
    if (absent.length) {
      const allowed = await this.allowNew(db, tenantId, absent, cap);
      refused = absent.slice(allowed.length);
      if (allowed.length) {
        await db.query(
          `INSERT INTO "telemetry_keys" ("tenantId", "key") SELECT $1::uuid, k FROM unnest($2::text[]) AS u(k) ON CONFLICT ("tenantId", "key") DO NOTHING`,
          // sorted: two writers creating the same new keys take their index locks in one order (no deadlock)
          [tenantId, [...allowed].sort()],
        );
        stored = new Map([...stored, ...(await this.select(db, tenantId, allowed))]);
        const c = this.counts.get(tenantId);
        if (c) c.n += allowed.length;
      }
    }
    for (const [key, id] of stored) ids.set(key, id);
    return { ids, refused, fromDb: stored };
  }

  /** Caches the ids a lookup read from the database, after the transaction that read or created them committed. Never throws. */
  async publish(tenantId: string, lookup: Pick<KeyLookup, 'fromDb'>): Promise<void> {
    if (!lookup.fromDb.size) return;
    const fresh: Record<string, string> = {};
    for (const [key, id] of lookup.fromDb) {
      this.remember(tenantId, key, id);
      fresh[key] = String(id);
    }
    if (this.o.redis) {
      await this.o.redis.hset(keyHashOf(tenantId), fresh).catch((e: unknown) => this.o.warn?.(`telemetry key cache write failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  /** Key names of ids (reads: the query service); unknown ids are left out. */
  async namesOf(db: SqlRunner, tenantId: string, ids: readonly number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    const missing: number[] = [];
    for (const id of new Set(ids)) {
      const name = this.names.get(id);
      if (name !== undefined) out.set(id, name);
      else missing.push(id);
    }
    if (missing.length) {
      const rows = rowsOf<{ keyId: number; key: string }>(await db.query(
        `SELECT "keyId", "key" FROM "telemetry_keys" WHERE "tenantId" = $1 AND "keyId" = ANY($2::int4[])`, [tenantId, missing],
      ));
      for (const r of rows) {
        out.set(Number(r.keyId), r.key);
        this.remember(tenantId, r.key, Number(r.keyId));
      }
    }
    return out;
  }

  private async select(db: SqlRunner, tenantId: string, keys: readonly string[]): Promise<Map<string, number>> {
    const rows = rowsOf<{ keyId: number; key: string }>(await db.query(
      `SELECT "keyId", "key" FROM "telemetry_keys" WHERE "tenantId" = $1 AND "key" = ANY($2::text[])`, [tenantId, keys],
    ));
    return new Map(rows.map((r) => [r.key, Number(r.keyId)]));
  }

  /** The prefix of `absent` the cap allows to be created (all of it without a cap). */
  private async allowNew(db: SqlRunner, tenantId: string, absent: readonly string[], capOf?: () => Promise<number | null>): Promise<readonly string[]> {
    const ask = capOf ?? (this.o.keyCap ? () => this.o.keyCap!(tenantId) : null);
    if (!ask) return absent;
    const cap = await ask();
    if (cap === null || !Number.isFinite(cap)) return absent;
    let c = this.counts.get(tenantId);
    if (!c || this.now() - c.at > KEY_COUNT_TTL_MS) {
      const n = Number(rowsOf<{ n: number | string }>(await db.query(`SELECT count(*)::int AS n FROM "telemetry_keys" WHERE "tenantId" = $1`, [tenantId]))[0]?.n ?? 0);
      c = { at: this.now(), n };
      this.counts.set(tenantId, c);
    }
    return absent.slice(0, Math.max(0, cap - c.n));
  }
}
