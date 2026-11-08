import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import ApiKeyMessages from './api_key.messages';

/**
 * The tenant membership an API key depends on (api_key.03, fixed 2026-10-20).
 *
 * A key is a person's credential: it used to outlive the member who minted it, so a removed or suspended admin kept working access
 * through every key they had made. Now a key verifies only while its creator is an ACTIVE member of the key's tenant, unless an
 * OWNER marked it a service key (an integration the workspace owns). Marking or clearing that flag is itself OWNER-only.
 *
 * `tenant_member` is reached by a dynamic import only: it transitively requires `tenant`, which requires `api_key` (the same reason
 * `api_key.notifications.service` keeps it off the static graph). The status is checked here, not in the `where`, so a row of any
 * status is judged by its status.
 */
async function membershipOf(tenantId: string, userId: string): Promise<{ memberStatus: string; memberRole: string } | null> {
  const { TenantMember } = await import('@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity');
  const row = await withTenantRepositoryFor(tenantId, TenantMember, (repo) => repo.findOne({ where: { tenantId, userId } }));
  if (!row || (row as { deletedAt?: Date | null }).deletedAt) return null;
  return { memberStatus: String(row.memberStatus), memberRole: String(row.memberRole) };
}

/**
 * True when the key's creator is still an ACTIVE member of its tenant. A membership that cannot be read fails CLOSED (503): an
 * outage never turns a removed member's key back on.
 */
export async function creatorIsActiveMember(tenantId: string, createdByUserId: string): Promise<boolean> {
  try {
    const m = await membershipOf(tenantId, createdByUserId);
    return !!m && m.memberStatus === 'ACTIVE';
  } catch {
    throw new AppError(ApiKeyMessages.VERIFY_UNAVAILABLE, 503, ErrorCode.INTERNAL_ERROR);
  }
}

/** The service-key flag is the OWNER's decision: an ACTIVE OWNER of the tenant, else 403. */
export async function assertOwnerMayMarkServiceKey(tenantId: string, actorId: string | undefined): Promise<void> {
  const m = actorId ? await membershipOf(tenantId, actorId) : null;
  if (!m || m.memberStatus !== 'ACTIVE' || m.memberRole !== 'OWNER') {
    throw new AppError(ApiKeyMessages.SERVICE_KEY_OWNER_ONLY, 403, ErrorCode.FORBIDDEN);
  }
}

/**
 * The standing a verified key needs beyond its own row: its tenant is ACTIVE (S15: a key of a suspended or deleted workspace is
 * refused), and its creator is still an ACTIVE member unless the key is an OWNER-marked service key (api_key.03). Answers the reason
 * a key is refused, or null. A lookup that cannot answer is a 503 (fail closed).
 */
export async function keyStandingRefusal(row: { tenantId: string; createdByUserId: string; isServiceKey?: boolean | null }): Promise<'tenant_inactive' | 'creator_not_member' | null> {
  let tenantStatus: string | null;
  try {
    const { getById } = await import('@kuraykaraaslan-labs/tenant/server/tenant.read.service');
    tenantStatus = String((await getById(row.tenantId)).tenantStatus ?? '');
  } catch (err) {
    if ((err as { statusCode?: number } | null)?.statusCode === 404) tenantStatus = null;
    else throw new AppError(ApiKeyMessages.VERIFY_UNAVAILABLE, 503, ErrorCode.INTERNAL_ERROR);
  }
  if (tenantStatus !== 'ACTIVE') return 'tenant_inactive';
  if (row.isServiceKey) return null;
  return (await creatorIsActiveMember(row.tenantId, row.createdByUserId)) ? null : 'creator_not_member';
}
