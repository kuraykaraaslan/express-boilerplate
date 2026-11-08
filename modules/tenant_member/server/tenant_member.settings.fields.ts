import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for the Members settings page. Pure data — safe to import into a
// 'use client' page. defaultMemberRole is the role of an invitation or an
// admin-added member that names none; self-registration is always USER
// (05-tenant-member 3.1).
export const TENANT_MEMBER_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'defaultMemberRole',
    label: 'Default Member Role',
    description: 'Role given to invited members and to members an admin adds, when no role is chosen. People who sign up themselves always join as User.',
    group: 'Membership',
    type: 'select',
    // OWNER is intentionally excluded — defaulting new members to owner is unsafe.
    options: [
      { value: 'USER', label: 'User' },
      { value: 'ADMIN', label: 'Admin' },
    ],
    defaultValue: 'USER',
  },
  {
    key: 'tenantMemberDualControl',
    label: 'Require approval for sensitive member changes',
    description:
      'When on, granting owner/admin or removing an owner/admin is held in the approval queue until a second reviewer approves it (dual-control). Off applies these changes immediately.',
    group: 'Security',
    type: 'boolean',
    defaultValue: 'false',
  },
];
