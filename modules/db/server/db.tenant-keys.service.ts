import { decryptFieldWithKeys, envelopeKid } from '@kuraykaraaslan-labs/common/server/field-encryption';
import { TenantKey } from './entities/tenant_key.entity';
import {
  DataKeyService, TenantKeyUnavailableError, UUID_RE, nodeDataKeyProvider, registerDataKeyScope, type DataKeyDestroyReportBase, type DataKeyScope,
  type DataKeyServiceDeps,
} from './db.data-keys';
import type { FieldCodec } from './db.tenant-bundle.fields';

export { TenantKeyUnavailableError, holdSlotOf, type TenantKeyUnavailableReason } from './db.data-keys';

/**
 * The per-tenant data keys (TDEK) of field-encryption v2 (P7-TDEK; docs/phases/02-fleet/04 section 3 level L3, decisions F16 and F17): generate,
 * wrap, unwrap, rotate, destroy (crypto-shredding) and escrow under a legal hold. A tenant's declared sensitive columns (`db:tenant_key_columns`) are
 * encrypted as `v2.tdek-<tenantId>-<generation>.<iv>.<ct>.<tag>` under its ACTIVE key.
 *
 *  - Storage: `tenant_keys` in the node's control database holds the WRAPPED key only (db.key-provider.ts); the raw key lives in this process's
 *    memory, cached for `ttlMs` (default 5 min) after an unwrap, so a request does not unwrap on every value.
 *  - The engine (cache, provider, rotate, destroy, escrow) is shared with the per-user keys of decision F27 (db.data-keys.ts,
 *    db.user-keys.service.ts); this file is the tenant scope: `tenant_keys`, the `tdek-` kid, `TENANT_PURGE`, and the migration export's codec.
 *  - Synchronous reads: the cache is registered with common's field-key resolver, so `decryptField` (and the column transformer) opens a tenant
 *    envelope synchronously once the key is loaded (`keyFor`, `warm`).
 *  - Tenant binding: the kid names its tenant, and `decrypt(tenantId, value)` refuses an envelope under another tenant's key (`WRONG_TENANT`,
 *    counted), so a value copied between tenants' rows is never opened in the wrong tenant's context.
 *  - Dual read (F17): `decrypt` also opens v1 and node-key v2 envelopes and passes a legacy plaintext through, so the online backfill can move a
 *    column under tenant keys while it is being read.
 *  - Destroy: the rows first (DESTROYED, wrapped key cleared, committed), then the provider slots (irreversible; for the `file` provider that is
 *    outside the database). A run that stops between the two is visible in the rows and in its report (`pendingSlots`), and a rerun finishes it.
 *    A key whose tenant was PURGED is never re-created: a straggling write after the purge fails instead of starting generation n+1.
 *  - Legal hold: `escrow` re-wraps every live key under its hold slot until the hold's end; a key destroyed while escrowed still opens from the
 *    escrow until the hold ends. An escrow whose hold has ended is never extended (it is released instead), so an ended hold cannot revive a key.
 *  - Other processes: a process that cached a key keeps READING with it for up to `ttlMs` after another process destroyed it. Writes do not
 *    trust the cache: `encrypt` re-checks that its memoised key is still the tenant's ACTIVE key (one primary-key read) before sealing, so a
 *    destroyed or retired generation stops receiving values as soon as its new state is committed (only a write already past that check races).
 *  - Faults: only a real key state (unknown, destroyed, purged, wrapped by another provider, does not unwrap) is a counted `KEY_UNAVAILABLE`; a
 *    database, pool, key-store or KEK fault propagates as itself, so a lenient read never mistakes an outage for a missing value.
 */

export const TENANT_KID_RE = /^tdek-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([1-9][0-9]{0,8})$/;

export function tenantKidOf(tenantId: string, generation: number): string {
  if (!UUID_RE.test(tenantId)) throw new Error('tenant keys: tenantId must be a lower-case uuid');
  if (!Number.isInteger(generation) || generation < 1) throw new Error('tenant keys: generation must be a positive integer');
  return `tdek-${tenantId}-${generation}`;
}

export function parseTenantKid(kid: string): { tenantId: string; generation: number } | null {
  const m = TENANT_KID_RE.exec(kid);
  return m ? { tenantId: m[1], generation: Number(m[2]) } : null;
}

/** Why a key was destroyed (`tenant_keys.destroyReason`). */
/**
 * `TENANT_PURGE` is final (no key is ever created for the tenant again); `MIGRATED_AWAY` is the migration source purge: the tenant lives on another
 * node now, and should it ever move back, its import starts the next generation here.
 */
export type TenantKeyDestroyReason = 'TENANT_PURGE' | 'MIGRATED_AWAY' | 'COMPROMISE' | 'OPERATOR';

export interface TenantKeyDestroyReport extends DataKeyDestroyReportBase {
  tenantId: string;
}

export type TenantKeyServiceDeps = DataKeyServiceDeps;

const TENANT_SCOPE: DataKeyScope = {
  label: 'tenant',
  entity: TenantKey,
  table: 'tenant_keys',
  ownerColumn: 'tenantId',
  kidOf: (tenantId, generation) => tenantKidOf(tenantId, generation),
  parseKid: (kid) => { const p = parseTenantKid(kid); return p ? { ownerId: p.tenantId, generation: p.generation } : null; },
  wrongOwnerReason: 'WRONG_TENANT',
  finalReasons: ['TENANT_PURGE'],
  finalMessage: 'the tenant was purged: no new key is created for it',
};

export class TenantKeyService extends DataKeyService {
  constructor(deps: TenantKeyServiceDeps) {
    super(deps, TENANT_SCOPE);
  }

  /** Forgets every cached key of a tenant (after a destroy, a rotation, or a hold release). */
  evictTenant(tenantId: string): void {
    this.evictOwner(tenantId);
  }

  /**
   * Every key of the tenant, held by the caller for a long synchronous read (the migration export): the openable keys, and the kids that are
   * destroyed for good (their values are unreadable everywhere). Throws when any other key cannot be opened (another provider's, one that does not
   * unwrap, a key-store fault): an export must never carry a value as unreadable that this node could have read.
   */
  async exportKeys(tenantId: string): Promise<{ keys: Map<string, Buffer>; destroyed: Set<string> }> {
    this.checkOwner(tenantId);
    const [ds, provider] = await Promise.all([this.deps.dataSource(), this.deps.provider()]);
    const keys = new Map<string, Buffer>();
    const destroyed = new Set<string>();
    const nowMs = this.now();
    for (const row of await this.rows(ds, tenantId)) {
      const held = !!row.escrowWrappedDek && !!row.escrowUntil && row.escrowUntil.getTime() > nowMs;
      if (row.state === 'DESTROYED' && !held) { destroyed.add(row.kid); continue; }
      keys.set(row.kid, this.cachedKey(row.kid) ?? await this.unwrapRow(row, provider));
    }
    return { keys, destroyed };
  }

  /**
   * The migration export's codec for `tenantId` (05 section 6.3): the tenant's own envelopes open under the keys held for the whole export
   * (`exportKeys`), anything else goes to `base` (the node key). An envelope under a key destroyed for good, under another tenant's key, or damaged
   * is unreadable (null, counted by the bundle); an envelope of this tenant under a key the node does not know refuses the export (throws), so a
   * readable value never travels as an envelope the target cannot open.
   */
  async exportCodec(tenantId: string, base: FieldCodec): Promise<FieldCodec> {
    const { keys, destroyed } = await this.exportKeys(tenantId);
    return {
      decrypt: (envelope) => {
        const kid = envelopeKid(envelope);
        const owner = kid ? parseTenantKid(kid) : null;
        if (!kid || !owner) return base.decrypt(envelope);
        if (owner.tenantId !== tenantId || destroyed.has(kid)) return null;
        const key = keys.get(kid);
        if (!key) throw new TenantKeyUnavailableError('UNKNOWN', kid, `the export met an envelope under ${kid}, which is no key of this tenant on this node`);
        try { return decryptFieldWithKeys(envelope, (k) => (k === kid ? key : undefined)); } catch { return null; }
      },
      encrypt: (plaintext) => base.encrypt(plaintext),
    };
  }

  /**
   * Reads a declared column's value in the context of `tenantId` (dual read): a legacy plaintext passes through, a v1 or node-key envelope opens
   * under the node key, a tenant envelope opens under this tenant's key. Throws a counted `FieldDecryptError`: WRONG_TENANT for another tenant's
   * key (or any key that is not a tenant key, such as a user's), KEY_UNAVAILABLE for a destroyed or unknown key, AUTH_FAILED for a damaged value.
   * A database or key-store fault is not a key state: it propagates as itself (never a counted failure that a lenient read would turn into "no value").
   */
  async decrypt(tenantId: string, value: string): Promise<string> {
    return this.openFor(tenantId, value);
  }

  /** Destroys every live key of the tenant (crypto-shredding); see `DataKeyService.destroyKeys`. */
  async destroy(tenantId: string, reason: TenantKeyDestroyReason): Promise<TenantKeyDestroyReport> {
    return { tenantId, ...(await this.destroyKeys(tenantId, reason)) };
  }
}

/** The process-wide service on the node's control database and the configured provider (`TENANT_KEY_PROVIDER`, default `node-key`). */
export const tenantKeys = new TenantKeyService({
  dataSource: async () => (await import('./db.datasource')).getSystemDataSource(),
  provider: nodeDataKeyProvider,
});

registerDataKeyScope('tdek-', tenantKeys);
