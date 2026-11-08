import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for Invitations → Settings (/admin/invitations/settings). Keys in tenant_invitation.setting.keys.ts; both
// settings can only make invitations stricter (tenant_invitation.settings-policy.ts).
export const TENANT_INVITATION_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'invitationTtlDays',
    label: 'Invitation lifetime (days)',
    description: 'How many days a new or resent invitation link stays valid. It can only be shorter than the installation default (7 days unless the installation sets another); a longer value uses the default.',
    group: 'Invitations',
    type: 'number',
    defaultValue: '7',
    placeholder: '7',
  },
  {
    key: 'invitationAllowedRoles',
    label: 'Roles an invitation may grant',
    description: 'Limits the role a new member can be invited with. The owner role is never granted by invitation, and nobody can invite someone to a role at or above their own.',
    group: 'Invitations',
    type: 'select',
    options: [
      { value: '', label: 'Any role the inviter may grant' },
      { value: 'USER', label: 'Members only (no admins by invitation)' },
    ],
    defaultValue: '',
  },
];
