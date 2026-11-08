/**
 * The tenant_invitation settings (Invitations → Settings; keys in tenant_invitation.setting.keys.ts). Both were read
 * before this page existed (tenant_invitation.helpers.ts) and no page wrote them.
 *
 * - `invitationTtlDays`: the lifetime of a new or resent invitation, in whole days. Unset, unreadable, not a positive
 *   integer: the installation's default (`INVITATION_TTL_SECONDS`, 7 days), as before. Since 2026-10-27 it is capped
 *   at that default: a tenant may shorten how long an invitation link works, never lengthen it (before, any positive
 *   number of days applied, so a stored 3650 kept a link usable for ten years).
 * - `invitationAllowedRoles`: parsed where it is enforced (`assertRoleAllowed`), unchanged: a comma-separated list of
 *   roles, empty = no extra restriction. It can only narrow what an invitation grants; a value that cannot be read as a
 *   string fails closed there (the invitation is refused).
 */

export const DAY_MS = 86_400_000;

/** The invitation lifetime in milliseconds: the tenant's days when valid, never above the installation's default. */
export function sanitizeInvitationTtlMs(raw: unknown, defaultMs: number): number {
  if (typeof raw !== 'string' || !/^\s*\d+\s*$/.test(raw)) return defaultMs;
  const days = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(days) || days <= 0) return defaultMs;
  return Math.min(days * DAY_MS, defaultMs);
}
