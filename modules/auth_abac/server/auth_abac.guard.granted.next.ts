import type { NextRequest } from 'next/server';
import { runWithRequestMemo } from '@kuraykaraaslan-labs/common/server/request-memo';
import type { PermissionFloor } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';
import AbacSettingsService from './auth_abac.settings.service';
import { evaluatePermissionsFromRequest } from './auth_abac.pdp.service.next';
import { installVerdictOf } from './auth_abac.install-verdict';
import type { SubjectSource } from './auth_abac.attributes';
import { FLOOR_RANK, decisionBlocks, minRoleOf } from './auth_abac.guard.core.next';
import { groupLiftApplies, groupPermissionsOf } from './auth_abac.guard.group-floor.next';
import { keyGrantsOf } from './auth_abac.key-requests';

// ── Bulk permission resolution (UI gating) ───────────────────────────────────

/**
 * Which of `permissionIds` the ALREADY-AUTHENTICATED caller actually holds.
 *
 * This exists because asking "may this person see this thing?" for a LIST is a
 * different question from guarding one route, and until now the repo could only
 * answer the second. Anything that renders a permission-gated collection —
 * dashboard widgets, and the sidebar menu next — was shipping its declared
 * `permissions[]` unenforced, because there is no client-side permission context
 * and no "my effective permissions" endpoint to build one from.
 *
 * It applies BOTH gates a guarded route applies, in the same order, because
 * neither alone is the answer:
 *
 *  1. The catalog's coarse role floor (`minRole`). `can()` deliberately skips
 *     this — its `onNotApplicable: 'permission'` mode permits an unseeded
 *     permission so that adding one cannot lock an existing tenant out. Correct
 *     for migration safety, wrong for "should this widget be in the payload":
 *     without the floor, a USER would be handed an ADMIN-only widget in every
 *     tenant that has not customised its role matrix.
 *  2. The PDP, on the session already resolved upstream — no second auth.
 *
 * Shadow mode is honoured the way `enforcePermission` honours it: a policy deny
 * that would not actually block a request does not hide the thing either, so the
 * UI keeps matching what the API would allow.
 *
 * Distinct ids are evaluated once each, in ONE bulk PDP call: the subject, the
 * policy set and the role set are read once for the whole list rather than once
 * per permission (an admin shell load asks for ~73). The decision cache stays
 * OFF: its key includes the environment's millisecond `now`, so it can never hit.
 * Every decision is still audited as a single check would be.
 */
export async function grantedPermissions(args: {
  request: NextRequest;
  tenantId: string;
  permissionIds: string[];
  /** The session the caller already authenticated (avoids re-authenticating). */
  session: SubjectSource;
  /**
   * Permissions a custom group must not lift over the role floor here: the ones whose route is not a tenant route
   * (see `permissionsExemptFromGroupLift`). A plain role check still applies to them.
   */
  noGroupLift?: ReadonlySet<string> | string[];
}): Promise<Set<string>> {
  // Every evaluation below reads the same role and policy sets; one memo scope for the whole list reads each once.
  return runWithRequestMemo(() => resolveGranted(args));
}

async function resolveGranted(args: Parameters<typeof grantedPermissions>[0]): Promise<Set<string>> {
  const granted = new Set<string>();
  // A request an API key made answers within the key's own permissions (docs/phases/48-api-key-scopes D48-4): the session
  // passed here is the key's holder, who may hold more.
  const keyGrants = args.request ? keyGrantsOf(args.request) : undefined;
  const ids = [...new Set(args.permissionIds)].filter((id) => !keyGrants || keyGrants.has(id));
  if (ids.length === 0) return granted;

  const settings = await AbacSettingsService.getRuntimeSettings(args.tenantId);
  const role = args.session.tenantMember?.memberRole as PermissionFloor | undefined;

  // The floor runs first, so the PDP is never asked (or audited) about a
  // permission the caller's role cannot hold. No resolvable member role (global
  // admin, impersonation edge) → defer wholly to the PDP, matching
  // resolvePermissionGrant's own treatment of that case.
  // A custom group the member holds lifts an ADMIN-floor permission over the floor, as it does on the route
  // (group-floor.next.ts), so the menu and the API agree. The PDP is still asked and still decides. A grant of the
  // installation's config/access.ts lifts the same floor, the same way (docs/phases/45-install-config D45-4).
  const exempt = new Set(args.noGroupLift ?? []);
  const liftable = (id: string) => groupLiftApplies(minRoleOf(id)) && !exempt.has(id);
  const installGrants = installVerdictOf(args.tenantId, args.session).granted;
  const groupGrants = role !== undefined && ids.some((id) => FLOOR_RANK[role] < FLOOR_RANK[minRoleOf(id)] && liftable(id))
    ? await groupPermissionsOf(args.tenantId, args.session.tenantMember)
    : new Set<string>();
  const asked = ids.filter((permissionId) =>
    role === undefined
    || FLOOR_RANK[role] >= FLOOR_RANK[minRoleOf(permissionId)]
    || (liftable(permissionId) && (groupGrants.has(permissionId) || installGrants.has(permissionId))));
  if (asked.length === 0) return granted;

  const decisions = await evaluatePermissionsFromRequest({
    request: args.request,
    tenantId: args.tenantId,
    permissionIds: asked,
    settings,
    session: args.session,
  });
  for (const permissionId of asked) {
    const decision = decisions.get(permissionId);
    if (!decision) continue;
    if (decisionBlocks(decision, settings)) continue;
    granted.add(permissionId);
  }
  return granted;
}
