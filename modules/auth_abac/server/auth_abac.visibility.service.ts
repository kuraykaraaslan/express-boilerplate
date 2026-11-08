import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import redis from '@kuraykaraaslan-labs/redis';
import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { authAbacRecordScopeLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/auth_abac.record_scope';
import TenantRoleService from '@kuraykaraaslan-labs/tenant_member/server/tenant_role.service';
import { installAccessVerdict } from '@kuraykaraaslan-labs/common/server/install-config/install-config.access';
import { installRoleLabels } from '@kuraykaraaslan-labs/common/server/install-config/install-config.roles';
import { TenantMember } from '@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity';
import type { EntityManager } from 'typeorm';
import { AbacScopeVersion } from './entities/auth_abac_scope_version.entity';
import {
  RECORD_SCOPE_POINT, narrower, readAllTwin,
  type RecordScope, type RecordScopeProvider,
} from './auth_abac.record-scope';

/**
 * 60 s, matching `OrganizationTeamService.teamIdsForUser`'s own horizon and the
 * same order of magnitude as the ABAC decision cache (30 s). Longer produces
 * "I removed them from the team and they can still see it"; shorter means a
 * membership query on every list request.
 */
const SCOPE_TTL_SECONDS = 60;

const OWN: RecordScope = { mode: 'OWN' };
const ALL: RecordScope = { mode: 'ALL' };

/**
 * organization.34: the tenant's scope version (database-held, bumped in a membership change's own transaction) is part of
 * the key, so a purge Redis swallowed cannot serve the old scope: after the bump every read looks under a new key.
 */
function cacheKey(tenantId: string, userId: string, permissionId: string, version: number): string {
  return `abac:scope:${tenantId}:${userId}:${permissionId}#v${version}`;
}

/**
 * Record-level visibility: not "may you read leads" but "WHICH leads".
 *
 * A permission decision that says yes without saying to what is only half an
 * authorization decision, and the missing half is the one that leaks a tenant's
 * entire customer list.
 *
 * **This point is FAIL-CLOSED, and it is the only provider point in the system
 * that is.** Every other one fails open, because a dropped form submission is a
 * lost lead — visible, annoying, recoverable. A dropped scope resolver is the
 * opposite: the failure mode of "no predicate" is not less data, it is ALL
 * data, silently. The asymmetry is real, so the contract points the other way.
 *
 * Nothing here throws. A caller cannot be made to handle an exception from the
 * function that decides what they are allowed to see, because the obvious
 * handler — carry on — is exactly the wrong one.
 */
export default class VisibilityService {
  /**
   * Resolve one user's scope on one permission.
   *
   * Order, first match wins:
   *   1. holds the `_all` twin of the permission            → ALL
   *   2. registered resolvers (fail-closed, budgeted)       → the NARROWEST non-null
   *   3. nothing                                            → OWN
   *
   * Resolvers of modules not active for the tenant are not asked; that can only
   * narrow the answer, since a resolver never widens past OWN by being absent.
   */
  static async resolve(tenantId: string, userId: string, permissionId: string): Promise<RecordScope> {
    if (!userId) return OWN;

    // An unreadable version means the cache cannot be trusted to be current: compute, and do not cache.
    const version = await VisibilityService.scopeVersion(tenantId);
    if (version === null) return VisibilityService.compute(tenantId, userId, permissionId);

    const key = cacheKey(tenantId, userId, permissionId, version);
    try {
      const cached = await redis.get(key);
      if (cached) return JSON.parse(cached) as RecordScope;
    } catch {
      // A cache miss and a cache outage are the same thing to us: recompute.
    }

    const scope = await VisibilityService.compute(tenantId, userId, permissionId);

    try {
      await redis.set(key, JSON.stringify(scope), 'EX', SCOPE_TTL_SECONDS);
    } catch {
      // Not caching is slower, never wrong.
    }
    return scope;
  }

  /** organization.34: the tenant's current scope version (0 before the first bump), or null when it cannot be read. */
  private static async scopeVersion(tenantId: string): Promise<number | null> {
    try {
      const row = await withTenantRepositoryFor(tenantId, AbacScopeVersion, (repo) => repo.findOne({ where: { tenantId } }));
      const v = (row as { version?: unknown } | null)?.version;
      return typeof v === 'number' && Number.isSafeInteger(v) ? v : 0;
    } catch (err) {
      Logger.warn(`[abac] scope version unreadable, the scope is computed uncached: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * organization.34: bump the tenant's scope version. Call it INSIDE the transaction of the change that alters a scope
   * (a team membership, a role matrix), with that transaction's manager, so the change and the bump commit together; a
   * failure throws and rolls the change back. Without a manager it runs in a transaction of its own.
   */
  static async bumpScopeVersion(tenantId: string, manager?: EntityManager): Promise<void> {
    const bump = async (repo: { findOne: (o: unknown) => Promise<unknown>; save: (r: unknown) => Promise<unknown> }) => {
      const row = (await repo.findOne({ where: { tenantId }, lock: { mode: 'pessimistic_write' } })) as { version?: number } | null;
      await repo.save({ tenantId, version: (typeof row?.version === 'number' ? row.version : 0) + 1 });
    };
    if (manager) await bump(manager.getRepository(AbacScopeVersion) as never);
    else await withTenantRepositoryFor(tenantId, AbacScopeVersion, (repo) => bump(repo as never));
  }

  private static async compute(tenantId: string, userId: string, permissionId: string): Promise<RecordScope> {
    // ALL is granted by HOLDING a permission, never by a resolver returning it.
    // A resolver can only ever narrow — that is what keeps the failure direction
    // safe, because a broken resolver cannot widen anybody's read.
    if (await VisibilityService.holds(tenantId, userId, readAllTwin(permissionId))) return ALL;

    // Each resolver gets the point's `timeoutMs` (250 ms, auth_abac/module.json): a slow
    // resolver must not hold a list request open, so past it we assume the worst.
    let verdicts;
    try {
      verdicts = await ext.guard<RecordScopeProvider, RecordScope | null>(
        RECORD_SCOPE_POINT, tenantCtx(tenantId), authAbacRecordScopeLoaders,
        (provider) => provider(tenantId, userId, permissionId),
      );
    } catch (err) {
      Logger.error(`[abac] record_scope resolution failed for '${permissionId}': ${err instanceof Error ? err.message : String(err)} — falling back to OWN`);
      return OWN;
    }
    if (verdicts.blocked) {
      Logger.error(
        `[abac] record_scope could not verify ${verdicts.unverifiable.map((f) => `'${f.contributionId}' (${f.reason}: ${f.message})`).join(', ')} ` +
        `for '${permissionId}' — falling back to OWN`,
      );
      // One broken resolver collapses the whole answer, deliberately. Ignoring
      // it and trusting the others would mean a resolver can widen a read by
      // crashing, which is the one thing that must never be true.
      return OWN;
    }

    let winner: RecordScope | null = null;
    for (const { value: result, contribution } of verdicts.results) {
      // `null` is a resolver saying "not my permission" — the cheap, normal case.
      if (!result) continue;
      // organization.15: a resolver may only narrow. ALL comes from holding the read_all twin (checked above), never from a
      // resolver's answer, so a resolver returning ALL is ignored (logged): it neither widens nor counts as a verdict.
      if (result.mode === 'ALL') {
        Logger.warn(`[abac] record_scope resolver '${contribution?.id ?? 'unknown'}' answered ALL for '${permissionId}': ignored (only read_all grants ALL)`);
        continue;
      }
      winner = winner ? narrower(winner, result) : result;
    }
    return winner ?? OWN;
  }

  private static async holds(tenantId: string, userId: string, permissionId: string): Promise<boolean> {
    try {
      const member = await withTenantRepositoryFor(tenantId, TenantMember, (repo) => repo.findOne({
        where: { tenantId, userId },
      }));
      if (!member) return false;
      // The installation's config/access.ts (docs/phases/45-install-config D45-4) removes a read_all twin as it removes
      // any id: no route asks for these, so this is the only place the removal can take effect. Its grants do not widen
      // a scope here, as a custom group's do not: ALL comes from the role matrix alone. An invalid file throws, and the
      // catch below refuses ALL.
      const labels = installRoleLabels({ tenantId, memberRole: member.memberRole, roleKeys: member.roleKeys });
      if (installAccessVerdict(labels).removed.has(permissionId)) return false;
      // `undefined` means the tenant has not seeded its matrix and therefore has
      // not granted the twin — absence of a grant is not a grant.
      return (await TenantRoleService.hasPermission(tenantId, member.memberRole, permissionId)) === true;
    } catch (err) {
      Logger.error(`[abac] read_all lookup failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * The scope as a TypeORM `where` fragment the caller ANDs into its own query.
   *
   * Column names come from the caller because auth_abac knows no table names —
   * the moment it does, every new module has to be added here.
   *
   * Returns `null` for ALL, meaning "add nothing".
   */
  static wherePredicate(
    scope: RecordScope,
    userId: string,
    cols: { ownerColumn: string; teamColumn?: string },
  ): { sql: string; params: Record<string, unknown> } | null {
    if (scope.mode === 'ALL') return null;

    const scopeIds = scope.mode === 'TEAM' ? (scope.scopeIds ?? []) : [];
    // An empty TEAM list is OWN. Left as an empty `IN ()` it would match nothing
    // at all, which reads to the user as "my data disappeared".
    if (!scopeIds.length) {
      return { sql: `${cols.ownerColumn} = :vsUser`, params: { vsUser: userId } };
    }

    const parts = [`${cols.ownerColumn} = :vsUser`, `${cols.ownerColumn} IN (:...vsScope)`];
    if (cols.teamColumn) parts.push(`${cols.teamColumn} IN (:...vsScope)`);

    // `vs` prefixes keep these from colliding with the caller's own :search/:status.
    return { sql: `(${parts.join(' OR ')})`, params: { vsUser: userId, vsScope: scopeIds } };
  }

  /**
   * The scope as a plain id list, for callers using `find`/`findAndCount`.
   *
   * Most services here build a `where` OBJECT rather than a QueryBuilder, and
   * bolting a raw SQL fragment onto one of those means rewriting the query.
   * This returns the acceptable owner ids so the caller can write
   * `ownerId: In(ids)` and keep the shape it already has — including the
   * OR-array form, where the filter has to appear in every branch.
   *
   * `null` means ALL: add nothing.
   *
   * Note what falls out for free: `In([...])` never matches NULL, so unowned
   * rows stay invisible without a second predicate — the same rule `canSee`
   * states explicitly, arrived at by the same reasoning rather than by
   * coincidence.
   */
  static ownerFilter(scope: RecordScope, userId: string): string[] | null {
    if (scope.mode === 'ALL') return null;
    if (scope.mode !== 'TEAM') return [userId];
    const scopeIds = scope.scopeIds ?? [];
    return scopeIds.length ? [...new Set([userId, ...scopeIds])] : [userId];
  }

  /**
   * `resolve` + `ownerFilter` in one call — the shape every list site wants.
   *
   * Two steps is two chances to do one of them: resolve and then forget to
   * apply, which produces an unrestricted query that looks like it was checked.
   * There is no partial result to misuse here.
   */
  static async ownerFilterFor(
    tenantId: string,
    viewerId: string,
    permissionId: string,
  ): Promise<string[] | null> {
    const scope = await VisibilityService.resolve(tenantId, viewerId, permissionId);
    return VisibilityService.ownerFilter(scope, viewerId);
  }

  /**
   * One-row check, for after a `getById`.
   *
   * A caller that fails this should answer 404, not 403: "there are 40 records
   * you may not see" is itself a disclosure.
   *
   * An UNOWNED row is visible to nobody but `read_all`. An ownerless lead is not
   * everyone's lead, it is no one's — otherwise clearing `ownerId` would be a
   * way to publish a record to the whole tenant.
   */
  static canSee(
    scope: RecordScope,
    userId: string,
    row: { ownerId?: string | null; teamId?: string | null },
  ): boolean {
    if (scope.mode === 'ALL') return true;
    if (!row.ownerId && !row.teamId) return false;
    if (row.ownerId && row.ownerId === userId) return true;
    if (scope.mode !== 'TEAM') return false;

    const scopeIds = scope.scopeIds ?? [];
    if (!scopeIds.length) return false;
    return (
      (!!row.ownerId && scopeIds.includes(row.ownerId)) ||
      (!!row.teamId && scopeIds.includes(row.teamId))
    );
  }

  /**
   * Drop cached scopes. Called by team-membership writes and role-matrix writes.
   *
   * Omitting `userId` clears the tenant — the right thing after a matrix change,
   * which can alter everybody's answer at once.
   */
  static async invalidate(tenantId: string, userId?: string): Promise<void> {
    const pattern = userId ? `abac:scope:${tenantId}:${userId}:*` : `abac:scope:${tenantId}:*`;
    try {
      // SCAN, not KEYS: KEYS blocks the whole server, and this runs on an
      // ordinary membership edit.
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length) await redis.del(...keys);
      } while (cursor !== '0');
    } catch (err) {
      // A stale scope expires in 60 s on its own. Failing the membership write
      // that triggered this would be a worse outcome than a minute of staleness.
      Logger.warn(`[abac] scope invalidation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
