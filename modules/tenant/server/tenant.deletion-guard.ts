import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { tenantDeletionGuardLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant.deletion_guard';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { isReservedTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';

export const TENANT_DELETION_GUARD_POINT = 'tenant:deletion_guard';

/** `(tenantId) => Promise<void>` — throws to object. */
export type TenantDeletionGuard = (tenantId: string) => Promise<void>;

const MALFORMED = 'the contribution is not a function';

/**
 * "Is anyone objecting to this tenant being deleted?"
 *
 * ## Why it is a seam and not a call
 *
 * A tenancy primitive must never import the domains built on top of it. The
 * only thing `tenant` needs to know before an irreversible write is whether
 * ANYBODY objects — "documents are under legal hold", "payments are still in
 * flight" are all the same question from a different module, answered
 * through this seam instead of a direct call into `tenant`. Who objects, and
 * who deliberately does not: docs/phases/37-extensions/11-guards-that-object.md.
 * The purge asks again (`TenantDeletionService.purgeRefusal`): an objection
 * raised during the grace period defers it.
 *
 * ## It fails CLOSED, and that is the opposite of most seams here
 *
 * Nearly every other extension point in this repo degrades open: a contributor
 * that throws is logged and skipped, because a broken satellite must not take
 * down the host. Here it must be the other way round. A guard that cannot
 * answer is not saying "no objection" — and a silently skipped guard permits a
 * deletion that cannot be undone. The cost of being wrong is asymmetric, so the
 * failure is too.
 *
 * ## Sequential, not `Promise.all`
 *
 * The first objection stops the rest. There is nothing to gain from asking the
 * remaining guards once the answer is already no, and an operator reading a
 * 409 wants the first real reason rather than whichever rejection won a race.
 *
 * A data-gate point (docs/phases/37-extensions EXT-1): a module that is switched
 * off still objects, because its rows are still there and come back with it.
 */
export async function assertDeletionAllowed(tenantId: string): Promise<void> {
  // Built-in, not a contribution: the root and fleet tenants are never deletable
  // (docs/phases/02-fleet/05), and this must hold even when no module is loaded.
  if (isReservedTenant(tenantId)) {
    throw new AppError('Reserved platform tenants (root, fleet) cannot be deleted', 409, ErrorCode.CONFLICT);
  }
  // A guard objects by throwing a business AppError (4xx, 409 recommended); that throw is
  // its answer, carried as a value so the runtime does not count it as a guard that could
  // not answer. Anything else it throws (its own query failed, a 5xx) is NOT an objection:
  // it propagates, the runtime records the guard as unable to answer, and the deletion is
  // refused below with a 503 and generic text, so an internal message never reaches the
  // self-service caller as `details.reason`. Once one objects, the later guards are not asked.
  let objected = false;
  const { results, unverifiable, blocked } = await ext.guard<TenantDeletionGuard, { objection: AppError } | null>(
    TENANT_DELETION_GUARD_POINT, tenantCtx(tenantId), tenantDeletionGuardLoaders,
    async (guard) => {
      if (typeof guard !== 'function') throw new Error(MALFORMED);
      if (objected) return null;
      try {
        await guard(tenantId);
        return null;
      } catch (err) {
        if (!(err instanceof AppError) || err.statusCode >= 500) throw err;
        objected = true;
        return { objection: err };
      }
    },
    { sequential: true },
  );
  // A guard's own AppError travels untouched: it knows why it objected and
  // says so better than anything this function could substitute.
  const objection = results.find((r) => r.value)?.value;
  if (objection) throw objection.objection;
  if (blocked) {
    // Could not even load (or reach) the guard. Refusing here is the whole point:
    // the alternative is deleting a tenant because the module that would have
    // objected failed to start.
    const f = unverifiable[0]!;
    throw new AppError(
      `Cannot verify deletion is safe — the '${f.contributionId}' guard is ${f.message === MALFORMED ? 'malformed' : 'unavailable'} (could not verify ${f.moduleId})`,
      503,
      ErrorCode.INTERNAL_ERROR,
    );
  }
}
