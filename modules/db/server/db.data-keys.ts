import { randomBytes } from 'node:crypto';
import { In, IsNull, Not, type DataSource, type EntityManager, type FindOptionsWhere, type Repository } from 'typeorm';
import {
  FieldDecryptError, blindIndexWithKey, configureFieldKeyResolver, decryptField, encryptFieldWithKey, envelopeKid, fieldDecryptFailure, isEncryptedField,
  nodeFieldKid, type FieldDecryptReason,
} from '@kuraykaraaslan-labs/common/server/field-encryption';
import { TenantKeySlotGoneError, type TenantKeyProvider } from './db.key-provider';
import type { TenantKeyProviderKind, TenantKeyState } from './entities/tenant_key.entity';

/**
 * The data-key engine shared by the per-tenant keys (TDEK, `tdek-<tenantId>-<generation>`, db.tenant-keys.service.ts; decision F16) and the per-user
 * keys (UDEK, `udek-<userId>-<generation>`, db.user-keys.service.ts; decision F27): generate, wrap, unwrap, rotate, destroy (crypto-shredding) and
 * escrow under a legal hold, with the SAME provider machinery (db.key-provider.ts) and the same v2 envelopes (common field-encryption: the kid bound
 * as GCM additional data). What differs per scope is only where the rows live (`tenant_keys`, `user_keys`), the column naming the owner, the kid
 * prefix and the destroy reason after which an owner never gets a key again (a tenant purge, a user erasure).
 *
 *  - Storage: the scope's table in the node's control database holds the WRAPPED key only; the raw key lives in this process's memory, cached for
 *    `ttlMs` (default 5 min) after an unwrap, so a request does not unwrap on every value.
 *  - Synchronous reads: every scope's cache is registered with common's field-key resolver (`registerDataKeyScope`, dispatched by kid prefix), so
 *    `decryptField` opens an envelope synchronously once its key is loaded (`keyFor`, `warm`).
 *  - Owner binding: the kid names its owner, and `openFor(ownerId, value)` refuses an envelope under another owner's key (counted, with the scope's
 *    reason: WRONG_TENANT, WRONG_USER), so a value copied between owners' rows is never opened in the wrong owner's context.
 *  - Dual read (F17): `openFor` also opens v1 and node-key v2 envelopes and passes a legacy plaintext through, so the online backfill can move a
 *    column under the owner's key while it is being read. An envelope under ANOTHER scope's key (a tenant key met by the user reader, or the
 *    reverse) is refused the same way: no reader opens a key it does not own.
 *  - Destroy: the rows first (DESTROYED, wrapped key cleared, committed), then the provider slots (irreversible; for the `file` provider that is
 *    outside the database). A run that stops between the two is visible in the rows and in its report (`pendingSlots`), and a rerun finishes it.
 *    A key whose owner was finally destroyed (`finalReasons`, or the scope's own final record: `isFinal`) is never re-created: a straggling write
 *    afterwards fails instead of starting n+1, also for an owner who never had a key. `retryPendingSlots` finishes the slots a destroy left.
 *  - Legal hold: `escrow` re-wraps every live key under its hold slot until the hold's end; a key destroyed while escrowed still opens from the
 *    escrow until the hold ends. An escrow whose hold has ended is never extended (it is released instead), so an ended hold cannot revive a key.
 *  - Other processes: a process that cached a key keeps READING with it for up to `ttlMs` after another process destroyed it. Writes do not
 *    trust the cache: `encrypt` re-checks that its memoised key is still the owner's ACTIVE key (one primary-key read) before sealing.
 *  - Faults: only a real key state (unknown, destroyed, purged, wrapped by another provider, does not unwrap) is a counted `KEY_UNAVAILABLE`; a
 *    database, pool, key-store or KEK fault propagates as itself, so a lenient read never mistakes an outage for a missing value.
 *  - Never logs, returns or reports key material: kids, states and counts only.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const holdSlotOf = (kid: string): string => `hold-${kid}`;

export type TenantKeyUnavailableReason = 'UNKNOWN' | 'DESTROYED' | 'PURGED' | 'PROVIDER_MISMATCH' | 'UNWRAP_FAILED';

/** A data key (tenant or user) that cannot be used. Never carries key material. The name is historical: the tenant keys came first. */
export class TenantKeyUnavailableError extends Error {
  constructor(readonly reason: TenantKeyUnavailableReason, readonly kid: string | null, message: string) {
    super(message);
    this.name = 'TenantKeyUnavailableError';
  }
}

/** The columns every data-key table has (`tenant_keys`, `user_keys`), whatever column names the owner. */
export interface DataKeyRow {
  kid: string;
  generation: number;
  state: TenantKeyState;
  provider: TenantKeyProviderKind;
  wrappedDek: string | null;
  escrowWrappedDek: string | null;
  escrowUntil: Date | null;
  createdAt: Date;
  retiredAt: Date | null;
  destroyedAt: Date | null;
  destroyReason: string | null;
  /** When a destroy last failed to reach one of the key's provider slots; null once every slot it could reach is gone (a rerun clears it). */
  slotsPendingAt: Date | null;
}

/** What makes a scope: its table, its owner column, its kid shape and its final destroy reason. */
export interface DataKeyScope {
  /** `tenant` or `user`: the wording of errors (`tenant key …`, `user keys: userId must …`). */
  label: 'tenant' | 'user';
  /** The entity of the scope's table. */
  entity: new () => DataKeyRow;
  /** The table name: the advisory-lock namespace (`<table>:<ownerId>`). */
  table: string;
  /** The column naming the owner. */
  ownerColumn: 'tenantId' | 'userId';
  kidOf(ownerId: string, generation: number): string;
  parseKid(kid: string): { ownerId: string; generation: number } | null;
  /** The reason counted when an envelope under another owner's key is read in this owner's context. */
  wrongOwnerReason: FieldDecryptReason;
  /** The destroy reasons after which no key is ever created for the owner again (see also `isFinal`), and the refusal's message. */
  finalReasons: readonly string[];
  finalMessage: string;
}

export interface DataKeyDestroyReportBase {
  /** The keys destroyed by this call (already destroyed ones are not repeated). */
  destroyed: string[];
  /** Of those, the ones still restorable from their legal-hold escrow until it is released. */
  escrowed: string[];
  provider: TenantKeyProvider['kind'];
  /**
   * Whether the destruction reaches database backups taken before it: true only when this node's provider keeps its slots outside the database,
   * every destroyed key of the owner was wrapped by it, and every slot was destroyed (`unshredded` and `pendingSlots` are empty).
   */
  shredsBackups: boolean;
  /** The owner's destroyed keys wrapped by ANOTHER provider (the node switched providers): their slots were not reached, a backup still opens them. */
  unshredded: string[];
  /** The provider slots this call could not destroy (the rows are DESTROYED regardless); a rerun of `destroy` retries them. */
  pendingSlots: string[];
}

/** An error of the file system (a key store or KEK file that cannot be read), never a key state. */
const isIoError = (e: unknown): boolean => typeof (e as { code?: unknown } | null)?.code === 'string' && /^E[A-Z0-9]+$/.test((e as { code: string }).code);

export interface DataKeyServiceDeps {
  /** The node's control database (where the scope's table lives), never a tenant's dedicated database. */
  dataSource: () => Promise<DataSource>;
  provider: () => Promise<TenantKeyProvider>;
  now?: () => number;
  ttlMs?: number;
}

interface CachedKey { key: Buffer; expires: number }

export class DataKeyService {
  private readonly keys = new Map<string, CachedKey>();
  private readonly activeKid = new Map<string, { kid: string; expires: number }>();
  protected readonly ttlMs: number;
  protected readonly now: () => number;

  constructor(protected readonly deps: DataKeyServiceDeps, protected readonly scope: DataKeyScope) {
    this.ttlMs = deps.ttlMs ?? 5 * 60_000;
    this.now = deps.now ?? Date.now;
  }

  protected checkOwner(ownerId: string): void {
    if (!UUID_RE.test(ownerId)) throw new Error(`${this.scope.label} keys: ${this.scope.ownerColumn} must be a lower-case uuid`);
  }

  protected repo(m: EntityManager | DataSource): Repository<DataKeyRow> {
    return m.getRepository(this.scope.entity) as Repository<DataKeyRow>;
  }

  protected ownerWhere(ownerId: string, extra: Partial<DataKeyRow> = {}): FindOptionsWhere<DataKeyRow> {
    return { [this.scope.ownerColumn]: ownerId, ...extra } as FindOptionsWhere<DataKeyRow>;
  }

  protected lock(m: EntityManager, ownerId: string): Promise<unknown> {
    return m.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${this.scope.table}:${ownerId}`]);
  }

  /** The cached raw key of `kid`, or undefined (not loaded, or expired). Synchronous: common's field-key resolver. */
  cachedKey(kid: string): Buffer | undefined {
    const hit = this.keys.get(kid);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) { this.keys.delete(kid); return undefined; }
    return hit.key;
  }

  /** Forgets every cached key of an owner (after a destroy, a rotation, or a hold release). */
  evictOwner(ownerId: string): void {
    for (const kid of [...this.keys.keys()]) if (this.scope.parseKid(kid)?.ownerId === ownerId) this.keys.delete(kid);
    this.activeKid.delete(ownerId);
  }

  /** Test seam and shutdown hook. */
  evictAll(): void {
    this.keys.clear();
    this.activeKid.clear();
  }

  protected remember(kid: string, key: Buffer): Buffer {
    this.keys.set(kid, { key, expires: this.now() + this.ttlMs });
    return key;
  }

  protected async rows(m: EntityManager | DataSource, ownerId: string): Promise<DataKeyRow[]> {
    return this.repo(m).find({ where: this.ownerWhere(ownerId), order: { generation: 'ASC' } });
  }

  /** Opens a row's key: the live wrap first, the legal-hold escrow when the key is destroyed (or its slot gone) and the hold still runs. */
  protected async unwrapRow(row: DataKeyRow, provider: TenantKeyProvider): Promise<Buffer> {
    const label = this.scope.label;
    if (row.provider !== provider.kind) {
      throw new TenantKeyUnavailableError('PROVIDER_MISMATCH', row.kid, `${label} key ${row.kid} was wrapped by provider ${row.provider}, this node uses ${provider.kind}`);
    }
    let gone = row.state === 'DESTROYED' || !row.wrappedDek;
    if (!gone) {
      try {
        return await provider.unwrap(row.kid, row.wrappedDek as string);
      } catch (e) {
        if (isIoError(e)) throw e;   // a fault of the key store, not of the key
        if (!(e instanceof TenantKeySlotGoneError)) throw new TenantKeyUnavailableError('UNWRAP_FAILED', row.kid, `${label} key ${row.kid} did not unwrap`);
        gone = true;
      }
    }
    if (row.escrowWrappedDek && row.escrowUntil && row.escrowUntil.getTime() > this.now()) {
      try {
        return await provider.unwrap(holdSlotOf(row.kid), row.escrowWrappedDek);
      } catch (e) {
        if (isIoError(e)) throw e;
        throw new TenantKeyUnavailableError('UNWRAP_FAILED', row.kid, `${label} key ${row.kid} did not unwrap from its escrow`);
      }
    }
    throw new TenantKeyUnavailableError('DESTROYED', row.kid, `${label} key ${row.kid} has been destroyed`);
  }

  /** The raw key of `kid` (cached). Throws `TenantKeyUnavailableError` for an unknown, destroyed or unopenable key. */
  async keyFor(kid: string): Promise<Buffer> {
    const hit = this.cachedKey(kid);
    if (hit) return hit;
    if (!this.scope.parseKid(kid)) throw new TenantKeyUnavailableError('UNKNOWN', null, `not a ${this.scope.label} key id`);
    const [ds, provider] = await Promise.all([this.deps.dataSource(), this.deps.provider()]);
    const row = await this.repo(ds).findOne({ where: { kid } });
    if (!row) throw new TenantKeyUnavailableError('UNKNOWN', kid, `${this.scope.label} key ${kid} does not exist on this node`);
    return this.remember(kid, await this.unwrapRow(row, provider));
  }

  /**
   * The owner's ACTIVE key, created (generation 1, or the next one) when it has none. Serialised per owner by an advisory lock; the partial unique
   * index keeps one ACTIVE key per owner whatever happens. Refused for an owner whose keys were finally destroyed (`isFinal`).
   */
  async activeKey(ownerId: string, opts: { verify?: boolean } = {}): Promise<{ kid: string; key: Buffer }> {
    this.checkOwner(ownerId);
    const memo = this.activeKid.get(ownerId);
    if (memo && memo.expires > this.now()) {
      const key = this.cachedKey(memo.kid);
      if (key && !opts.verify) return { kid: memo.kid, key };
      if (key) {
        // A write: another process may have destroyed or rotated this generation since it was memoised.
        const current = await this.repo(await this.deps.dataSource()).findOne({ where: { kid: memo.kid }, select: { kid: true, state: true } });
        if (current?.state === 'ACTIVE') return { kid: memo.kid, key };
        this.evictOwner(ownerId);
      }
    }
    const [ds, provider] = await Promise.all([this.deps.dataSource(), this.deps.provider()]);
    const found = await this.repo(ds).findOne({ where: this.ownerWhere(ownerId, { state: 'ACTIVE' }) });
    const row = found ?? await this.createKey(ds, provider, ownerId, false);
    const key = this.cachedKey(row.kid) ?? this.remember(row.kid, await this.unwrapRow(row, provider));
    this.activeKid.set(ownerId, { kid: row.kid, expires: this.now() + this.ttlMs });
    return { kid: row.kid, key };
  }

  /** Inserts the owner's next key (retiring the ACTIVE one when `rotate`); returns the new ACTIVE row. */
  private async createKey(ds: DataSource, provider: TenantKeyProvider, ownerId: string, rotate: boolean): Promise<DataKeyRow> {
    const created: { kid?: string; dek?: Buffer } = {};
    try {
      const row = await ds.transaction(async (m) => {
        await this.lock(m, ownerId);
        const rows = await this.rows(m, ownerId);
        if (await this.isFinal(m, ownerId, rows)) {
          throw new TenantKeyUnavailableError('PURGED', null, this.scope.finalMessage);
        }
        const active = rows.find((r) => r.state === 'ACTIVE');
        if (active && !rotate) return active;   // created meanwhile by another request
        const generation = rows.reduce((max, r) => Math.max(max, r.generation), 0) + 1;
        const kid = this.scope.kidOf(ownerId, generation);
        const dek = randomBytes(32);
        const wrappedDek = await provider.wrap(kid, dek);
        created.kid = kid; created.dek = dek;
        if (active) await this.repo(m).update({ kid: active.kid }, { state: 'RETIRED', retiredAt: new Date(this.now()) });
        const fresh = this.repo(m).create({
          kid, [this.scope.ownerColumn]: ownerId, generation, state: 'ACTIVE', provider: provider.kind, wrappedDek, createdAt: new Date(this.now()),
        } as Partial<DataKeyRow>);
        await this.repo(m).insert(fresh);
        return fresh;
      });
      // Cached only once the row is committed: a key whose row was rolled back must never encrypt anything.
      if (created.kid && created.dek) this.remember(created.kid, created.dek);
      return row;
    } catch (e) {
      if (created.kid) await provider.destroy(created.kid).catch(() => undefined);   // no orphan slot for a row never committed
      throw e;
    }
  }

  /**
   * Whether the owner was finally destroyed, read inside the owner's advisory lock: by default a key destroyed with a final reason. A scope with a
   * durable final record of its own (the user scope: `user_key_erasures`) also answers true for an owner who never had a key.
   */
  protected async isFinal(_m: EntityManager, _ownerId: string, rows: DataKeyRow[]): Promise<boolean> {
    return rows.some((r) => r.destroyReason !== null && this.scope.finalReasons.includes(r.destroyReason));
  }

  /** Called inside a destroy's transaction (owner locked, rows marked DESTROYED) when its reason is final: a scope records it durably. */
  protected async onFinalDestroy(_m: EntityManager, _ownerId: string, _reason: string): Promise<void> { /* rows carry it */ }

  /** Compromise rotation (04 section 3: rotation only on compromise): a new ACTIVE key; the old one is RETIRED and still decrypts. */
  async rotate(ownerId: string): Promise<string> {
    this.checkOwner(ownerId);
    const [ds, provider] = await Promise.all([this.deps.dataSource(), this.deps.provider()]);
    const row = await this.createKey(ds, provider, ownerId, true);
    this.activeKid.set(ownerId, { kid: row.kid, expires: this.now() + this.ttlMs });
    return row.kid;
  }

  /** Loads every openable key of the owner into the cache (before synchronous reads); returns their kids. */
  async warm(ownerId: string): Promise<string[]> {
    const [ds, provider] = await Promise.all([this.deps.dataSource(), this.deps.provider()]);
    const loaded: string[] = [];
    for (const row of await this.rows(ds, ownerId)) {
      try {
        if (!this.cachedKey(row.kid)) this.remember(row.kid, await this.unwrapRow(row, provider));
        loaded.push(row.kid);
      } catch { /* a destroyed or unopenable key stays unloaded: its values fail as KEY_UNAVAILABLE */ }
    }
    return loaded;
  }

  /** A v2 envelope of `plaintext` under the owner's ACTIVE key (re-checked against the database: see the class doc). */
  async encrypt(ownerId: string, plaintext: string): Promise<string> {
    const { kid, key } = await this.activeKey(ownerId, { verify: true });
    return encryptFieldWithKey(kid, key, plaintext);
  }

  /**
   * Reads a declared column's value in the context of `ownerId` (dual read): a legacy plaintext passes through, a v1 or node-key envelope opens
   * under the node key, an envelope of this scope opens under this owner's key. Throws a counted `FieldDecryptError`: the scope's wrong-owner reason
   * for another owner's key or another scope's key, KEY_UNAVAILABLE for a destroyed or unknown key, AUTH_FAILED for a damaged value. A database or
   * key-store fault is not a key state: it propagates as itself.
   */
  protected async openFor(ownerId: string, value: string): Promise<string> {
    if (!isEncryptedField(value)) return value;
    const kid = envelopeKid(value);
    if (kid && kid !== 'v1' && !kid.startsWith('ndek-')) {
      const owner = this.scope.parseKid(kid);
      if (!owner || owner.ownerId !== ownerId) {
        throw fieldDecryptFailure(this.scope.wrongOwnerReason, kid, `field envelope under key ${kid} read in another ${this.scope.label}'s context`);
      }
      try {
        await this.keyFor(kid);
      } catch (e) {
        if (!(e instanceof TenantKeyUnavailableError)) throw e;
        throw fieldDecryptFailure('KEY_UNAVAILABLE', kid, e.message);
      }
    }
    return decryptField(value);
  }

  /**
   * Whether this node can hold data keys at all. False only for the `node-key` provider without a node field key (SETTINGS_ENCRYPTION_KEY):
   * a `single` deployment that never configured one. Every other provider wraps without the node key.
   */
  async canEncrypt(): Promise<boolean> {
    const provider = await this.deps.provider();
    return provider.kind !== 'node-key' || nodeFieldKid() !== null;
  }

  /** The configured provider's kind and whether destroying its slots reaches database backups. */
  async providerInfo(): Promise<{ kind: TenantKeyProvider['kind']; shredsBackups: boolean }> {
    const provider = await this.deps.provider();
    return { kind: provider.kind, shredsBackups: provider.shredsBackups };
  }

  /**
   * `encrypt` for the deployments that may run without a key (the legacy `encryptFieldOpt` contract): the plaintext passes through when the
   * node cannot hold data keys (`canEncrypt` is false), and only then. A configured node never stores a declared column in clear.
   */
  async encryptOpt(ownerId: string, plaintext: string): Promise<string> {
    return (await this.canEncrypt()) ? this.encrypt(ownerId, plaintext) : plaintext;
  }

  /** `encrypt` for a nullable column: null and undefined pass through. */
  async encryptNullable<T extends string | null | undefined>(ownerId: string, value: T): Promise<T | string> {
    return typeof value === 'string' ? this.encryptOpt(ownerId, value) : value;
  }

  /**
   * The reader with the legacy lenient contract of `decryptFieldOpt`, for display paths: null and undefined pass through, a value that does not
   * open answers null (the failure is still counted with its reason). Never use it where a wrong answer would be acted on.
   */
  async decryptOpt(ownerId: string, value: string | null | undefined): Promise<string | null | undefined> {
    if (typeof value !== 'string') return value;
    try {
      return await this.openFor(ownerId, value);
    } catch (e) {
      if (e instanceof FieldDecryptError) return null;
      throw e;
    }
  }

  /**
   * The blind index of `value` for `purpose` under the owner's ACTIVE key (re-checked like `encrypt`), for the column a sealed value is looked up
   * by; null when the node cannot hold data keys (`canEncrypt` false: the value is stored in clear and found by itself).
   */
  async blindIndex(ownerId: string, purpose: string, value: string): Promise<string | null> {
    if (!(await this.canEncrypt())) return null;
    const { key } = await this.activeKey(ownerId, { verify: true });
    return blindIndexWithKey(key, purpose, value);
  }

  /**
   * The blind indexes of `value` under every key of the owner this node can still open (ACTIVE, RETIRED, escrowed), for a lookup. Never creates a
   * key; a destroyed key contributes nothing (crypto-shredding). A key-store or database fault propagates.
   */
  async blindIndexes(ownerId: string, purpose: string, value: string): Promise<string[]> {
    this.checkOwner(ownerId);
    const [ds, provider] = await Promise.all([this.deps.dataSource(), this.deps.provider()]);
    const out: string[] = [];
    for (const row of await this.rows(ds, ownerId)) {
      let key = this.cachedKey(row.kid);
      if (!key) {
        try { key = this.remember(row.kid, await this.unwrapRow(row, provider)); } catch (e) {
          if (e instanceof TenantKeyUnavailableError) continue;
          throw e;
        }
      }
      out.push(blindIndexWithKey(key, purpose, value));
    }
    return out;
  }

  /**
   * Destroys every live key of the owner (crypto-shredding). The rows first, in one committed transaction (DESTROYED, `wrappedDek` cleared,
   * reason): from then on no process opens or writes under them. Then the provider slots, outside the transaction: a slot that fails is listed in
   * `pendingSlots` (the receipt then says the backups are not shredded) and a rerun retries the slots of the owner's DESTROYED rows. A key under
   * an unexpired legal-hold escrow keeps its escrow (restorable until the hold ends); an expired escrow is destroyed with it. A key wrapped by
   * another provider than this node's is marked DESTROYED but its slot is out of reach: it is listed in `unshredded`. Idempotent: already
   * destroyed keys are not repeated in `destroyed`. The caller audits the report (a destroy is irreversible and audited).
   */
  protected async destroyKeys(ownerId: string, reason: string): Promise<DataKeyDestroyReportBase> {
    this.checkOwner(ownerId);
    const [ds, provider] = await Promise.all([this.deps.dataSource(), this.deps.provider()]);
    const report: DataKeyDestroyReportBase = { destroyed: [], escrowed: [], provider: provider.kind, shredsBackups: false, unshredded: [], pendingSlots: [] };
    const slots: Array<{ kid: string; slot: string }> = [];
    await ds.transaction(async (m) => {
      await this.lock(m, ownerId);
      const now = new Date(this.now());
      for (const row of await this.rows(m, ownerId)) {
        const held = !!row.escrowWrappedDek && !!row.escrowUntil && row.escrowUntil.getTime() > now.getTime();
        if (row.state !== 'DESTROYED') {
          await this.repo(m).update({ kid: row.kid }, {
            state: 'DESTROYED', wrappedDek: null, destroyedAt: now, destroyReason: reason,
            ...(held ? {} : { escrowWrappedDek: null, escrowUntil: null }),
          });
          report.destroyed.push(row.kid);
          if (held) report.escrowed.push(row.kid);
        } else if (!held && row.escrowWrappedDek) {
          // destroyed earlier, its hold has ended since: the escrow goes with this run
          await this.repo(m).update({ kid: row.kid }, { escrowWrappedDek: null, escrowUntil: null });
        }
        if (row.provider !== provider.kind) { report.unshredded.push(row.kid); continue; }
        slots.push({ kid: row.kid, slot: row.kid });
        if (!held) slots.push({ kid: row.kid, slot: holdSlotOf(row.kid) });
      }
      if (this.scope.finalReasons.includes(reason)) await this.onFinalDestroy(m, ownerId, reason);
    });
    this.evictOwner(ownerId);
    const pendingKids = new Set<string>();
    for (const { kid, slot } of slots) {
      try { await provider.destroy(slot); } catch { report.pendingSlots.push(slot); pendingKids.add(kid); }
    }
    // Durable trace of a slot that is still there (`slotsPendingAt`): a rerun of the destroy or `retryPendingSlots` (the tenant key-shredding
    // sweep, the user-key retry, an operator) reaches it, and a run that reached every slot clears it. Best effort: when even this write fails,
    // the report still says so.
    await this.traceSlots(ds, slots.map((s) => s.kid), pendingKids);
    report.shredsBackups = provider.shredsBackups && report.unshredded.length === 0 && report.pendingSlots.length === 0;
    return report;
  }

  private async traceSlots(ds: DataSource, kids: string[], pendingKids: Set<string>): Promise<void> {
    const reached = [...new Set(kids)].filter((k) => !pendingKids.has(k));
    try {
      const repo = this.repo(ds);
      if (pendingKids.size) await repo.update({ kid: In([...pendingKids]), slotsPendingAt: IsNull() }, { slotsPendingAt: new Date(this.now()) });
      if (reached.length) await repo.update({ kid: In(reached), slotsPendingAt: Not(IsNull()) }, { slotsPendingAt: null });
    } catch { /* the caller's report carries it */ }
  }

  /**
   * Retries the provider slots a destroy could not reach (`slotsPendingAt` on a DESTROYED key) WITHOUT destroying anything else: unlike a rerun of
   * `destroy`, a live key the owner holds meanwhile (a key created after a non-final destroy such as a compromise) is never touched. The hold slot
   * of a key whose escrow still runs is kept. Returns the slots still pending (the column stays stamped for them).
   */
  async retryPendingSlots(ownerId: string): Promise<string[]> {
    this.checkOwner(ownerId);
    const [ds, provider] = await Promise.all([this.deps.dataSource(), this.deps.provider()]);
    const rows = await this.repo(ds).find({
      where: { ...this.ownerWhere(ownerId), state: 'DESTROYED', slotsPendingAt: Not(IsNull()) } as FindOptionsWhere<DataKeyRow>,
    });
    const nowMs = this.now();
    const kids: string[] = [];
    const pendingKids = new Set<string>();
    const pending: string[] = [];
    for (const row of rows) {
      if (row.provider !== provider.kind) continue;   // out of reach of this node's provider: stays stamped
      kids.push(row.kid);
      const held = !!row.escrowWrappedDek && !!row.escrowUntil && row.escrowUntil.getTime() > nowMs;
      for (const slot of held ? [row.kid] : [row.kid, holdSlotOf(row.kid)]) {
        try { await provider.destroy(slot); } catch { pending.push(slot); pendingKids.add(row.kid); }
      }
    }
    await this.traceSlots(ds, kids, pendingKids);
    return pending;
  }

  /**
   * Legal hold (06 section 6): re-wraps every live key of the owner under its hold slot, kept until `until`. A running escrow is extended (never
   * shortened), also on a key destroyed meanwhile. An escrow whose hold has already ended is never extended: a live key is escrowed afresh, a
   * destroyed one has its ended escrow released here (the hold slot destroyed after the commit), because an ended hold must not bring a destroyed
   * key back. Refused as a whole (PROVIDER_MISMATCH) when a live key was wrapped by another provider: a hold never silently misses a key.
   * Returns the number of keys escrowed or extended.
   */
  async escrow(ownerId: string, until: Date): Promise<number> {
    this.checkOwner(ownerId);
    if (!(until instanceof Date) || Number.isNaN(until.getTime()) || until.getTime() <= this.now()) throw new Error(`${this.scope.label} keys: a hold ends in the future`);
    const [ds, provider] = await Promise.all([this.deps.dataSource(), this.deps.provider()]);
    let n = 0;
    const released: string[] = [];
    await ds.transaction(async (m) => {
      await this.lock(m, ownerId);
      const nowMs = this.now();
      for (const row of await this.rows(m, ownerId)) {
        if (row.escrowWrappedDek && row.escrowUntil && row.escrowUntil.getTime() > nowMs) {
          if (row.escrowUntil.getTime() < until.getTime()) await this.repo(m).update({ kid: row.kid }, { escrowUntil: until });
          n++;
          continue;
        }
        if (row.state === 'DESTROYED') {
          if (row.escrowWrappedDek) {
            await this.repo(m).update({ kid: row.kid }, { escrowWrappedDek: null, escrowUntil: null });
            if (row.provider === provider.kind) released.push(holdSlotOf(row.kid));
          }
          continue;   // nothing left to escrow
        }
        const dek = await this.unwrapRow(row, provider);
        const escrowWrappedDek = await provider.wrap(holdSlotOf(row.kid), dek);
        await this.repo(m).update({ kid: row.kid }, { escrowWrappedDek, escrowUntil: until });
        n++;
      }
    });
    if (released.length) this.evictOwner(ownerId);
    // after the commit, best effort: the rows no longer name these slots, and destroy() retries a hold slot its rows no longer hold
    for (const slot of released) await provider.destroy(slot).catch(() => undefined);
    return n;
  }

  /**
   * Ends the escrow of the owner's keys: the hold slot is destroyed and the escrow columns cleared. `onlyExpired` (the sweep) releases only the
   * escrows whose hold has ended. A destroyed key whose escrow is released is gone for good. Returns the number released.
   */
  async releaseEscrow(ownerId: string, opts: { onlyExpired?: boolean } = {}): Promise<number> {
    this.checkOwner(ownerId);
    const [ds, provider] = await Promise.all([this.deps.dataSource(), this.deps.provider()]);
    let n = 0;
    await ds.transaction(async (m) => {
      await this.lock(m, ownerId);
      for (const row of await this.rows(m, ownerId)) {
        if (!row.escrowWrappedDek || !row.escrowUntil) continue;
        if (opts.onlyExpired && row.escrowUntil.getTime() > this.now()) continue;
        if (row.provider === provider.kind) await provider.destroy(holdSlotOf(row.kid));
        await this.repo(m).update({ kid: row.kid }, { escrowWrappedDek: null, escrowUntil: null });
        n++;
      }
    });
    this.evictOwner(ownerId);
    return n;
  }
}

/**
 * common's field-key resolver for every data-key scope of this process: a kid is answered from the cache of the service registered for its prefix
 * (`tdek-` tenant keys, `udek-` user keys). One resolver per process (common's contract); each process-wide service registers itself.
 */
const scopes = new Map<string, { cachedKey(kid: string): Buffer | undefined }>();

/** Registers the key cache answering `kidPrefix` kids (a later registration of the same prefix replaces it; other prefixes are kept). */
export function registerDataKeyScope(kidPrefix: string, service: { cachedKey(kid: string): Buffer | undefined }): void {
  scopes.set(kidPrefix, service);
  configureFieldKeyResolver((kid) => {
    for (const [prefix, s] of scopes) if (kid.startsWith(prefix)) return s.cachedKey(kid);
    return undefined;
  });
}

/** The process-wide provider (`TENANT_KEY_PROVIDER`, default `node-key`), shared by every scope: one key store, one KEK. */
let providerPromise: Promise<TenantKeyProvider> | null = null;
export function nodeDataKeyProvider(): Promise<TenantKeyProvider> {
  providerPromise ??= Promise.all([import('@kuraykaraaslan-labs/env'), import('./db.key-provider')]).then(([{ env }, { createTenantKeyProvider }]) => createTenantKeyProvider({
    provider: env.TENANT_KEY_PROVIDER, keystoreDir: env.TENANT_KEYSTORE_DIR, kekFile: env.TENANT_KEYSTORE_KEK_FILE,
    kekAgeIdentityFile: env.TENANT_KEYSTORE_KEK_AGE_IDENTITY_FILE,
  }));
  providerPromise.catch(() => { providerPromise = null; });
  return providerPromise;
}
