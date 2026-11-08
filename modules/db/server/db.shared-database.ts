import { getMetadataArgsStorage } from 'typeorm';

/**
 * Entities pinned to the shared (control) database (docs/phases/02-fleet F8, P9-7).
 *
 * Most tenant tables follow their tenant: `tenantDataSourceFor(tenantId)` hands back the tenant's own database when
 * it has a `tenant_databases` row. A few cannot, because they are read BEFORE the tenant is known. `api_keys` is the
 * case in point: `verify()` finds the key by its hash, and the row it finds is what names the tenant, so the lookup
 * can only ever ask one database (the shared one). A key written into a tenant's own database would never verify.
 *
 * Such an entity carries `@SharedDatabaseOnly()` on its class. The db routing then refuses to place it anywhere else:
 *
 *  - a dedicated tenant DataSource is built WITHOUT the pinned entities, so `getRepository(ApiKey)` on it throws
 *    (TypeORM has no metadata for it there) and its dev schema sync never creates the table;
 *  - `withTenantRepository` / `withTenantRepositoryFor` refuse a pinned entity outright, whatever database the tenant
 *    lives in, so a wrong call fails in every test rather than only for a dedicated tenant;
 *  - `withSharedTenantRepositoryFor` / `withSharedTenantTransactionFor` (db.context.ts) are the tenant-scoped path for
 *    them: the shared DataSource, with the same transaction-local tenant (RLS), write fence and async context.
 *
 * Deliberately a leaf file (typeorm only): entity files import it, and the generated entity list imports the entity
 * files, so anything heavier here would be an import cycle through the DataSource.
 */

// Class identity is the primary key; the name sets answer TypeORM's string entity targets ('ApiKey' or 'api_keys').
const pinnedClasses = new Set<unknown>();

/** Class decorator: this entity lives on the shared database only, never in a tenant's own database. */
export function SharedDatabaseOnly(): ClassDecorator {
  return (target) => {
    pinnedClasses.add(target);
  };
}

function classIsPinned(target: unknown): boolean {
  for (let proto: unknown = target; typeof proto === 'function' && proto !== Function.prototype; proto = Object.getPrototypeOf(proto)) {
    if (pinnedClasses.has(proto)) return true;
  }
  return false;
}

function nameIsPinned(name: string): boolean {
  for (const cls of pinnedClasses) {
    if ((cls as { name?: string }).name === name) return true;
  }
  return getMetadataArgsStorage().tables.some((t) => t.name === name && classIsPinned(t.target));
}

/** True when `entity` (a class, an entity name or a table name) is pinned to the shared database. */
export function isPinnedToSharedDatabase(entity: unknown): boolean {
  if (typeof entity === 'function') return classIsPinned(entity);
  if (typeof entity === 'string') return nameIsPinned(entity);
  // An EntitySchema (or `{ type, name }` target) is matched by its name.
  const name = (entity as { options?: { name?: unknown }; name?: unknown } | null)?.options?.name
    ?? (entity as { name?: unknown } | null)?.name;
  return typeof name === 'string' && nameIsPinned(name);
}

/** The entity list a tenant's OWN DataSource is built with: everything except the pinned entities. */
export function withoutSharedDatabaseEntities<T>(entities: readonly T[]): T[] {
  return entities.filter((e) => !isPinnedToSharedDatabase(e));
}

function entityLabel(entity: unknown): string {
  if (typeof entity === 'function') return entity.name || 'entity';
  if (typeof entity === 'string') return entity;
  return String((entity as { options?: { name?: unknown } } | null)?.options?.name ?? 'entity');
}

/** Thrown when a pinned entity is sent down the per-tenant routing path. A bug in the caller, never a user error. */
export class SharedDatabaseRoutingError extends Error {
  readonly code = 'SHARED_DATABASE_ONLY';
  constructor(readonly entity: string) {
    super(
      `[db] ${entity} is pinned to the shared database (@SharedDatabaseOnly) and must not be placed in a tenant's own `
      + 'database: use withSharedTenantRepositoryFor / withSharedTenantTransactionFor',
    );
    this.name = 'SharedDatabaseRoutingError';
  }
}

/** Refuse a pinned entity on the per-tenant routing path (`withTenantRepository*`). */
export function assertTenantRoutable(entity: unknown): void {
  if (isPinnedToSharedDatabase(entity)) throw new SharedDatabaseRoutingError(entityLabel(entity));
}
