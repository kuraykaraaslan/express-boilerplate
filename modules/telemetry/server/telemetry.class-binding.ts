import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import type { RetentionClass } from './telemetry.contract';
import { BINDINGS_TABLE, isRetentionClass } from './telemetry.classes';

/**
 * The retention class a tenant writes a KIND into (docs/phases/42-telemetry/00 §0.5): the current row of
 * `telemetry_class_bindings` for `(tenantId, entityType)`, recorded at the tenant's first write of that kind. The class comes
 * from the kind (`fixedClass`, or its `resolveClass` for plan-driven kinds). A plan change that moves a tenant to another class
 * (close the row, open the next, reads covering both) is the generic switch of `42/02` §2.8. Cached a minute per tenant AND
 * kind (verification F8: a cache keyed by tenant alone would let two kinds of one tenant overwrite each other's class); only a
 * row that was already committed is cached.
 */
export const CLASS_TTL_MS = 60_000;

export interface ClassBindingOptions {
  now?: () => number;
  ttlMs?: number;
}

const keyOf = (tenantId: string, kind: string): string => `${tenantId}\u0000${kind}`;

export class ClassBindingResolver {
  private readonly cache = new Map<string, { at: number; d: RetentionClass }>();
  private readonly now: () => number;

  constructor(private readonly o: ClassBindingOptions = {}) {
    this.now = o.now ?? Date.now;
  }

  /** Caches a class the caller's transaction has committed (`resolve` caches only a row it found already there). */
  remember(tenantId: string, kind: string, d: RetentionClass): void {
    this.cache.set(keyOf(tenantId, kind), { at: this.now(), d });
  }

  cached(tenantId: string, kind: string): RetentionClass | undefined {
    const hit = this.cache.get(keyOf(tenantId, kind));
    return hit && this.now() - hit.at < (this.o.ttlMs ?? CLASS_TTL_MS) ? hit.d : undefined;
  }

  private async current(db: SqlRunner, tenantId: string, kind: string): Promise<RetentionClass | null> {
    const d = Number(rowsOf<{ classDays: number }>(await db.query(
      `SELECT "classDays" FROM "${BINDINGS_TABLE}" WHERE "tenantId" = $1 AND "entityType" = $2 AND "validTo" IS NULL`, [tenantId, kind],
    ))[0]?.classDays);
    return isRetentionClass(d) ? d : null;
  }

  /**
   * The tenant's current class for the kind in `db` (a transaction scoped to the tenant), recording `want()`'s answer when the
   * tenant has none yet. A concurrent first write may have recorded another class first: that row wins.
   */
  async resolve(db: SqlRunner, tenantId: string, kind: string, want: () => Promise<RetentionClass>): Promise<RetentionClass> {
    const hit = this.cached(tenantId, kind);
    if (hit) return hit;
    const existing = await this.current(db, tenantId, kind);
    if (existing) {
      this.cache.set(keyOf(tenantId, kind), { at: this.now(), d: existing });
      return existing;
    }
    const d = await want();
    await db.query(
      `INSERT INTO "${BINDINGS_TABLE}" ("tenantId", "entityType", "classDays") VALUES ($1, $2, $3)
       ON CONFLICT ("tenantId", "entityType") WHERE "validTo" IS NULL DO NOTHING`,
      [tenantId, kind, d],
    );
    return (await this.current(db, tenantId, kind)) ?? d;
  }

  /**
   * Moves the tenant's current class for the kind to `want` (the plan changed, `42/02` §2.8): closes the current binding at `now()`
   * and opens the next; a tenant without a binding gets one; the same class is a no-op. Reads cover both bindings by validity.
   */
  async switchTo(db: SqlRunner, tenantId: string, kind: string, want: RetentionClass): Promise<{ changed: boolean; from: RetentionClass | null }> {
    const from = await this.current(db, tenantId, kind);
    if (from === want) {
      this.cache.set(keyOf(tenantId, kind), { at: this.now(), d: want });
      return { changed: false, from };
    }
    if (from !== null) {
      await db.query(`UPDATE "${BINDINGS_TABLE}" SET "validTo" = now() WHERE "tenantId" = $1 AND "entityType" = $2 AND "validTo" IS NULL`, [tenantId, kind]);
    }
    // validFrom must be strictly after the closed row's (one row per instant in the key): now() is the same inside one
    // transaction, so the new row starts a millisecond later
    await db.query(
      `INSERT INTO "${BINDINGS_TABLE}" ("tenantId", "entityType", "classDays", "validFrom") VALUES ($1, $2, $3, now() + interval '1 millisecond')`,
      [tenantId, kind, want],
    );
    this.cache.set(keyOf(tenantId, kind), { at: this.now(), d: want });
    return { changed: true, from };
  }

  /** The tenant's class history for the kind, oldest first (a read covers each class over its validity); empty when it never wrote. */
  async history(db: SqlRunner, tenantId: string, kind: string): Promise<Array<{ d: RetentionClass; from: number; to: number | null }>> {
    const rows = rowsOf<{ classDays: number; validFrom: Date | string; validTo: Date | string | null }>(await db.query(
      `SELECT "classDays", "validFrom", "validTo" FROM "${BINDINGS_TABLE}" WHERE "tenantId" = $1 AND "entityType" = $2 ORDER BY "validFrom"`, [tenantId, kind],
    ));
    return rows
      .filter((r) => isRetentionClass(Number(r.classDays)))
      .map((r) => ({ d: Number(r.classDays) as RetentionClass, from: new Date(r.validFrom).getTime(), to: r.validTo === null ? null : new Date(r.validTo).getTime() }));
  }

  /** Every class the tenant ever wrote into, for the given kinds (a lane's) or every kind (`null`). */
  async classesOf(db: SqlRunner, tenantId: string, kinds: readonly string[] | null): Promise<RetentionClass[]> {
    const rows = rowsOf<{ classDays: number }>(await db.query(
      kinds
        ? `SELECT DISTINCT "classDays" FROM "${BINDINGS_TABLE}" WHERE "tenantId" = $1 AND "entityType" = ANY($2::text[])`
        : `SELECT DISTINCT "classDays" FROM "${BINDINGS_TABLE}" WHERE "tenantId" = $1`,
      kinds ? [tenantId, [...kinds]] : [tenantId],
    ));
    return rows.map((r) => Number(r.classDays)).filter(isRetentionClass);
  }
}
