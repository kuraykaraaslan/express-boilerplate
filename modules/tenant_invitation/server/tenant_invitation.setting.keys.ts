import { z } from 'zod';

/**
 * Per-tenant setting keys of tenant_invitation (Invitations → Settings, `/admin/invitations/settings`). Read by
 * tenant_invitation.helpers.ts; the values are checked as tenant_invitation.settings-policy.ts describes.
 *
 * - `invitationTtlDays`: how long a new or resent invitation stays valid, in days, never longer than the installation's
 *   default (`INVITATION_TTL_SECONDS`, 7 days).
 * - `invitationAllowedRoles`: a comma-separated list of the roles an invitation may grant (empty = any role the inviter
 *   may grant). It only narrows: OWNER is never grantable and an inviter never grants a role at or above their own.
 */
export const TenantInvitationSettingKeySchema = z.enum([
  'invitationTtlDays',
  'invitationAllowedRoles',
]);
export type TenantInvitationSettingKey = z.infer<typeof TenantInvitationSettingKeySchema>;
export const TENANT_INVITATION_KEYS = TenantInvitationSettingKeySchema.options;
