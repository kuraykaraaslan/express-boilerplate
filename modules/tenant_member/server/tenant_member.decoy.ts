import { canaryRecordId, noteCanaryRecordTouch, type CanaryCaller } from '@kuraykaraaslan-labs/common/server/common.firewall-decoys';

/**
 * tenant_member's decoy for the AI firewall (docs/phases/55-ai-firewall/02 §2.5, contributed in tenant_member.firewall-honeytokens.ts):
 * one canary member id per tenant (`canaryRecordId('tenant_member.decoy_record', tenant)`, derived from the server's field key, never
 * stored). No membership row has it, so no member list, report, export, search or count ever shows it; `/api/members/<id>` answers it
 * exactly as it answers any missing member. Any member may read member records by id (`members.view`), which makes the member records the
 * first thing an insider walking ids reaches: asking for the canary id is never a page's doing (every page asks only for ids a list gave
 * it), so it is a critical signal about the signed-in caller.
 */

export const DECOY_MEMBER_PURPOSE = 'tenant_member.decoy_record';
export const DECOY_MEMBER_SIGNAL = 'tenant_member.decoy_record_touched';

/** The tenant's canary member id, or null without a field key. */
export function decoyMemberIdFor(tenantId: string): string | null {
  return canaryRecordId(DECOY_MEMBER_PURPOSE, tenantId.toLowerCase());
}

/** `/api/members/<id>` (read, change, remove) asked for the canary id: one bounded critical signal. A no-op for every other id; never throws. */
export function noteDecoyMemberTouch(
  request: { method?: string; headers: { get(name: string): string | null } },
  tenantId: string,
  memberId: string,
  caller: CanaryCaller | null | undefined,
): boolean {
  return noteCanaryRecordTouch({
    purpose: DECOY_MEMBER_PURPOSE, kind: DECOY_MEMBER_SIGNAL, source: 'tenant_member', subjectType: 'TenantMember', request, tenantId, id: memberId, caller,
  });
}
